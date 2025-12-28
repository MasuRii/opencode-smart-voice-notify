import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTTS, getTTSConfig } from './util/tts.js';

/**
 * OpenCode Smart Voice Notify Plugin
 * 
 * A smart notification plugin with multiple TTS engines (auto-fallback):
 * 1. ElevenLabs (Online, High Quality, Anime-like voices)
 * 2. Edge TTS (Free, Neural voices)
 * 3. Windows SAPI (Offline, Built-in)
 * 4. Local Sound Files (Fallback)
 * 
 * Features:
 * - Smart notification mode (sound-first, tts-first, both, sound-only)
 * - Delayed TTS reminders if user doesn't respond
 * - Follow-up reminders with exponential backoff
 * - Monitor wake and volume boost
 * - Cross-platform support (Windows, macOS, Linux)
 * 
 * @type {import("@opencode-ai/plugin").Plugin}
 */
export default async function SmartVoiceNotifyPlugin({ project, client, $, directory, worktree }) {
  const config = getTTSConfig();
  const tts = createTTS({ $, client });

  const platform = os.platform();
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const logFile = path.join(configDir, 'smart-voice-notify-debug.log');

  // Track pending TTS reminders (can be cancelled if user responds)
  const pendingReminders = new Map();
  
  // Track last user activity time
  let lastUserActivityTime = Date.now();
  
  // Track seen user message IDs to avoid treating message UPDATES as new user activity
  // Key insight: message.updated fires for EVERY modification to a message, not just new messages
  // We only want to treat the FIRST occurrence of each user message as "user activity"
  const seenUserMessageIds = new Set();
  
  // Track the timestamp of when session went idle, to detect post-idle user messages
  let lastSessionIdleTime = 0;
  
  // Track active permission request to prevent race condition where user responds
  // before async notification code runs. Set on permission.updated, cleared on permission.replied.
  let activePermissionId = null;

  /**
   * Write debug message to log file
   */
  const debugLog = (message) => {
    if (!config.debugLog) return;
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (e) {}
  };

  /**
   * Get a random message from an array of messages
   */
  const getRandomMessage = (messages) => {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 'Notification';
    }
    return messages[Math.floor(Math.random() * messages.length)];
  };

  /**
   * Show a TUI toast notification
   */
  const showToast = async (message, variant = 'info', duration = 5000) => {
    if (!config.enableToast) return;
    try {
      if (typeof client?.tui?.showToast === 'function') {
        await client.tui.showToast({
          body: {
            message: message,
            variant: variant,
            duration: duration
          }
        });
      }
    } catch (e) {}
  };

  /**
   * Play a sound file from assets
   */
  const playSound = async (soundFile, loops = 1) => {
    if (!config.enableSound) return;
    try {
      const soundPath = path.isAbsolute(soundFile) 
        ? soundFile 
        : path.join(configDir, soundFile);
      
      if (!fs.existsSync(soundPath)) {
        debugLog(`playSound: file not found: ${soundPath}`);
        return;
      }
      
      await tts.wakeMonitor();
      await tts.forceVolume();
      await tts.playAudioFile(soundPath, loops);
      debugLog(`playSound: played ${soundPath} (${loops}x)`);
    } catch (e) {
      debugLog(`playSound error: ${e.message}`);
    }
  };

  /**
   * Cancel any pending TTS reminder for a given type
   */
  const cancelPendingReminder = (type) => {
    const existing = pendingReminders.get(type);
    if (existing) {
      clearTimeout(existing.timeoutId);
      pendingReminders.delete(type);
      debugLog(`cancelPendingReminder: cancelled ${type}`);
    }
  };

  /**
   * Cancel all pending TTS reminders (called on user activity)
   */
  const cancelAllPendingReminders = () => {
    for (const [type, reminder] of pendingReminders.entries()) {
      clearTimeout(reminder.timeoutId);
      debugLog(`cancelAllPendingReminders: cancelled ${type}`);
    }
    pendingReminders.clear();
  };

  /**
   * Schedule a TTS reminder if user doesn't respond within configured delay.
   * The reminder uses a personalized TTS message.
   * @param {string} type - 'idle' or 'permission'
   * @param {string} message - The TTS message to speak
   * @param {object} options - Additional options
   */
  const scheduleTTSReminder = (type, message, options = {}) => {
    // Check if TTS reminders are enabled
    if (!config.enableTTSReminder) {
      debugLog(`scheduleTTSReminder: TTS reminders disabled`);
      return;
    }

    // Get delay from config (in seconds, convert to ms)
    const delaySeconds = type === 'permission' 
      ? (config.permissionReminderDelaySeconds || config.ttsReminderDelaySeconds || 30)
      : (config.idleReminderDelaySeconds || config.ttsReminderDelaySeconds || 30);
    const delayMs = delaySeconds * 1000;

    // Cancel any existing reminder of this type
    cancelPendingReminder(type);

    debugLog(`scheduleTTSReminder: scheduling ${type} TTS in ${delaySeconds}s`);

    const timeoutId = setTimeout(async () => {
      try {
        // Check if reminder was cancelled (user responded)
        if (!pendingReminders.has(type)) {
          debugLog(`scheduleTTSReminder: ${type} was cancelled before firing`);
          return;
        }

        // Check if user has been active since notification
        const reminder = pendingReminders.get(type);
        if (reminder && lastUserActivityTime > reminder.scheduledAt) {
          debugLog(`scheduleTTSReminder: ${type} skipped - user active since notification`);
          pendingReminders.delete(type);
          return;
        }

        debugLog(`scheduleTTSReminder: firing ${type} TTS reminder`);
        
        // Get the appropriate reminder messages (more personalized/urgent)
        const reminderMessages = type === 'permission' 
          ? config.permissionReminderTTSMessages
          : config.idleReminderTTSMessages;
        
        const reminderMessage = getRandomMessage(reminderMessages);

        // Check for ElevenLabs API key configuration issues
        // If user hasn't responded (reminder firing) and config is missing, warn about fallback
        if (config.ttsEngine === 'elevenlabs' && (!config.elevenLabsApiKey || config.elevenLabsApiKey.trim() === '')) {
          debugLog('ElevenLabs API key missing during reminder - showing fallback toast');
          await showToast("⚠️ ElevenLabs API Key missing! Falling back to Edge TTS.", "warning", 6000);
        }
        
        // Speak the reminder using TTS
        await tts.wakeMonitor();
        await tts.forceVolume();
        await tts.speak(reminderMessage, {
          enableTTS: true,
          fallbackSound: options.fallbackSound
        });

        // CRITICAL FIX: Check if cancelled during playback (user responded while TTS was speaking)
        if (!pendingReminders.has(type)) {
          debugLog(`scheduleTTSReminder: ${type} cancelled during playback - aborting follow-up`);
          return;
        }

        // Clean up
        pendingReminders.delete(type);
        
        // Schedule follow-up reminder if configured (exponential backoff or fixed)
        if (config.enableFollowUpReminders) {
          const followUpCount = (reminder?.followUpCount || 0) + 1;
          const maxFollowUps = config.maxFollowUpReminders || 3;
          
          if (followUpCount < maxFollowUps) {
            // Schedule another reminder with optional backoff
            const backoffMultiplier = config.reminderBackoffMultiplier || 1.5;
            const nextDelay = delaySeconds * Math.pow(backoffMultiplier, followUpCount);
            
            debugLog(`scheduleTTSReminder: scheduling follow-up ${followUpCount + 1}/${maxFollowUps} in ${nextDelay}s`);
            
            const followUpTimeoutId = setTimeout(async () => {
              const followUpReminder = pendingReminders.get(type);
              if (!followUpReminder || lastUserActivityTime > followUpReminder.scheduledAt) {
                pendingReminders.delete(type);
                return;
              }
              
              const followUpMessage = getRandomMessage(reminderMessages);
              await tts.wakeMonitor();
              await tts.forceVolume();
              await tts.speak(followUpMessage, {
                enableTTS: true,
                fallbackSound: options.fallbackSound
              });
              
              pendingReminders.delete(type);
            }, nextDelay * 1000);

            pendingReminders.set(type, {
              timeoutId: followUpTimeoutId,
              scheduledAt: Date.now(),
              followUpCount
            });
          }
        }
      } catch (e) {
        debugLog(`scheduleTTSReminder error: ${e.message}`);
        pendingReminders.delete(type);
      }
    }, delayMs);

    // Store the pending reminder
    pendingReminders.set(type, {
      timeoutId,
      scheduledAt: Date.now(),
      followUpCount: 0
    });
  };

  /**
   * Smart notification: play sound first, then schedule TTS reminder
   * @param {string} type - 'idle' or 'permission'
   * @param {object} options - Notification options
   */
  const smartNotify = async (type, options = {}) => {
    const {
      soundFile,
      soundLoops = 1,
      ttsMessage,
      fallbackSound
    } = options;

    // Step 1: Play the immediate sound notification
    if (soundFile) {
      await playSound(soundFile, soundLoops);
    }

    // CRITICAL FIX: Check if user responded during sound playback
    // For idle notifications: check if there was new activity after the idle start
    if (type === 'idle' && lastUserActivityTime > lastSessionIdleTime) {
      debugLog(`smartNotify: user active during sound - aborting idle reminder`);
      return;
    }
    // For permission notifications: check if the permission was already handled
    if (type === 'permission' && !activePermissionId) {
      debugLog(`smartNotify: permission handled during sound - aborting reminder`);
      return;
    }

    // Step 2: Schedule TTS reminder if user doesn't respond
    if (config.enableTTSReminder && ttsMessage) {
      scheduleTTSReminder(type, ttsMessage, { fallbackSound });
    }
    
    // Step 3: If TTS-first mode is enabled, also speak immediately
    if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
      const immediateMessage = type === 'permission'
        ? getRandomMessage(config.permissionTTSMessages)
        : getRandomMessage(config.idleTTSMessages);
      
      await tts.speak(immediateMessage, {
        enableTTS: true,
        fallbackSound
      });
    }
  };

  return {
    event: async ({ event }) => {
      try {
        // ========================================
        // USER ACTIVITY DETECTION
        // Cancels pending TTS reminders when user responds
        // ========================================
        // NOTE: OpenCode event types (as of SDK v1.0.203):
        //   - message.updated: fires when a message is added/updated (use properties.info.role to check user vs assistant)
        //   - permission.replied: fires when user responds to a permission request
        //   - session.created: fires when a new session starts
        //
        // CRITICAL: message.updated fires for EVERY modification to a message (not just creation).
        // Context-injector and other plugins can trigger multiple updates for the same message.
        // We must only treat NEW user messages (after session.idle) as actual user activity.
        
        if (event.type === "message.updated") {
          const messageInfo = event.properties?.info;
          const messageId = messageInfo?.id;
          const isUserMessage = messageInfo?.role === 'user';
          
          if (isUserMessage && messageId) {
            // Check if this is a NEW user message we haven't seen before
            const isNewMessage = !seenUserMessageIds.has(messageId);
            
            // Check if this message arrived AFTER the last session.idle
            // This is the key: only a message sent AFTER idle indicates user responded
            const messageTime = messageInfo?.time?.created;
            const isAfterIdle = lastSessionIdleTime > 0 && messageTime && (messageTime * 1000) > lastSessionIdleTime;
            
            if (isNewMessage) {
              seenUserMessageIds.add(messageId);
              
              // Only cancel reminders if this is a NEW message AFTER session went idle
              // OR if there are no pending reminders (initial message before any notifications)
              if (isAfterIdle || pendingReminders.size === 0) {
                if (isAfterIdle) {
                  lastUserActivityTime = Date.now();
                  cancelAllPendingReminders();
                  debugLog(`NEW user message AFTER idle: ${messageId} - cancelled pending reminders`);
                } else {
                  debugLog(`Initial user message (before any idle): ${messageId} - no reminders to cancel`);
                }
              } else {
                debugLog(`Ignored: user message ${messageId} created BEFORE session.idle (time=${messageTime}, idleTime=${lastSessionIdleTime})`);
              }
            } else {
              // This is an UPDATE to an existing message (e.g., context injection)
              debugLog(`Ignored: update to existing user message ${messageId} (not new activity)`);
            }
          }
        }
        
        if (event.type === "permission.replied") {
          // User responded to a permission request (granted or denied)
          // Structure: event.properties.{ sessionID, permissionID, response }
          // CRITICAL: Clear activePermissionId FIRST to prevent race condition
          // where permission.updated handler is still running async operations
          const repliedPermissionId = event.properties?.permissionID;
          
          // Match if IDs are equal, or if we have an active permission with unknown ID (undefined)
          // (This happens if permission.updated received an event without permissionID)
          if (activePermissionId === repliedPermissionId || activePermissionId === undefined) {
            activePermissionId = null;
            debugLog(`Permission replied: cleared activePermissionId ${repliedPermissionId || '(unknown)'}`);
          }
          lastUserActivityTime = Date.now();
          cancelPendingReminder('permission'); // Cancel permission-specific reminder
          debugLog(`Permission replied: ${event.type} (response=${event.properties?.response}) - cancelled permission reminder`);
        }
        
        if (event.type === "session.created") {
          // New session started - reset tracking state
          lastUserActivityTime = Date.now();
          lastSessionIdleTime = 0;
          activePermissionId = null;
          seenUserMessageIds.clear();
          cancelAllPendingReminders();
          debugLog(`Session created: ${event.type} - reset all tracking state`);
        }

        // ========================================
        // NOTIFICATION 1: Session Idle (Agent Finished)
        // ========================================
        if (event.type === "session.idle") {
          const sessionID = event.properties?.sessionID;
          if (!sessionID) return;

          try {
            const session = await client.session.get({ path: { id: sessionID } });
            if (session?.data?.parentID) {
              debugLog(`session.idle: skipped (sub-session ${sessionID})`);
              return;
            }
          } catch (e) {}

          // Record the time session went idle - used to filter out pre-idle messages
          lastSessionIdleTime = Date.now();
          
          debugLog(`session.idle: notifying for session ${sessionID} (idleTime=${lastSessionIdleTime})`);
          await showToast("✅ Agent has finished working", "success", 5000);

          // Smart notification: sound first, TTS reminder later
          await smartNotify('idle', {
            soundFile: config.idleSound,
            soundLoops: 1,
            ttsMessage: getRandomMessage(config.idleTTSMessages),
            fallbackSound: config.idleSound
          });
        }

        // ========================================
        // NOTIFICATION 2: Permission Request
        // ========================================
        if (event.type === "permission.updated") {
          // CRITICAL: Capture permissionID IMMEDIATELY (before any async work)
          // This prevents race condition where user responds before we finish notifying
          // NOTE: In permission.updated, the property is 'id', but in permission.replied it is 'permissionID'
          const permissionId = event.properties?.id;
          
          if (!permissionId) {
             debugLog('permission.updated: permission ID missing. properties keys: ' + Object.keys(event.properties || {}).join(', '));
          }

          activePermissionId = permissionId;
          
          debugLog(`permission.updated: notifying (permissionId=${permissionId})`);
          await showToast("⚠️ Permission request requires your attention", "warning", 8000);

          // CHECK: Did user already respond while we were showing toast?
          if (activePermissionId !== permissionId) {
            debugLog(`permission.updated: aborted - user already responded (activePermissionId cleared)`);
            return;
          }

          // Smart notification: sound first, TTS reminder later
          await smartNotify('permission', {
            soundFile: config.permissionSound,
            soundLoops: 2,
            ttsMessage: getRandomMessage(config.permissionTTSMessages),
            fallbackSound: config.permissionSound
          });
          
          // Final check after smartNotify: if user responded during sound playback, cancel the scheduled reminder
          if (activePermissionId !== permissionId) {
            debugLog(`permission.updated: user responded during notification - cancelling any scheduled reminder`);
            cancelPendingReminder('permission');
          }
        }
      } catch (e) {
        debugLog(`event handler error: ${e.message}`);
      }
    },
  };
}
