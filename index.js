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
  const logsDir = path.join(configDir, 'logs');
  const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
  
  // Ensure logs directory exists if debug logging is enabled
  if (config.debugLog && !fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (e) {
      // Silently fail - logging is optional
    }
  }

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

  // ========================================
  // PERMISSION BATCHING STATE
  // Batches multiple simultaneous permission requests into a single notification
  // ========================================
  
  // Array of permission IDs waiting to be notified (collected during batch window)
  let pendingPermissionBatch = [];
  
  // Timeout ID for the batch window (debounce timer)
  let permissionBatchTimeout = null;
  
  // Batch window duration in milliseconds (how long to wait for more permissions)
  const PERMISSION_BATCH_WINDOW_MS = config.permissionBatchWindowMs || 800;

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
   * @param {string} message - The TTS message to speak (used directly, supports count-aware messages)
   * @param {object} options - Additional options (fallbackSound, permissionCount)
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

    // Store permission count for generating count-aware messages in reminders
    const permissionCount = options.permissionCount || 1;

    debugLog(`scheduleTTSReminder: scheduling ${type} TTS in ${delaySeconds}s (count=${permissionCount})`);

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

        debugLog(`scheduleTTSReminder: firing ${type} TTS reminder (count=${reminder?.permissionCount || 1})`);
        
        // Get the appropriate reminder message
        // For permissions with count > 1, use the count-aware message generator
        const storedCount = reminder?.permissionCount || 1;
        let reminderMessage;
        if (type === 'permission') {
          reminderMessage = getPermissionMessage(storedCount, true);
        } else {
          reminderMessage = getRandomMessage(config.idleReminderTTSMessages);
        }

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
              
              // Use count-aware message for follow-ups too
              const followUpStoredCount = followUpReminder?.permissionCount || 1;
              let followUpMessage;
              if (type === 'permission') {
                followUpMessage = getPermissionMessage(followUpStoredCount, true);
              } else {
                followUpMessage = getRandomMessage(config.idleReminderTTSMessages);
              }
              
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
              followUpCount,
              permissionCount: storedCount  // Preserve the count for follow-ups
            });
          }
        }
      } catch (e) {
        debugLog(`scheduleTTSReminder error: ${e.message}`);
        pendingReminders.delete(type);
      }
    }, delayMs);

    // Store the pending reminder with permission count
    pendingReminders.set(type, {
      timeoutId,
      scheduledAt: Date.now(),
      followUpCount: 0,
      permissionCount  // Store count for later use
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
      fallbackSound,
      permissionCount = 1  // Support permission count for batched notifications
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
      scheduleTTSReminder(type, ttsMessage, { fallbackSound, permissionCount });
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

  /**
   * Get a count-aware TTS message for permission requests
   * @param {number} count - Number of permission requests
   * @param {boolean} isReminder - Whether this is a reminder message
   * @returns {string} The formatted message
   */
  const getPermissionMessage = (count, isReminder = false) => {
    const messages = isReminder 
      ? config.permissionReminderTTSMessages 
      : config.permissionTTSMessages;
    
    if (count === 1) {
      // Single permission - use regular message
      return getRandomMessage(messages);
    } else {
      // Multiple permissions - use count-aware messages if available, or format dynamically
      const countMessages = isReminder
        ? config.permissionReminderTTSMessagesMultiple
        : config.permissionTTSMessagesMultiple;
      
      if (countMessages && countMessages.length > 0) {
        // Use configured multi-permission messages (replace {count} placeholder)
        const template = getRandomMessage(countMessages);
        return template.replace('{count}', count.toString());
      } else {
        // Fallback: generate a dynamic message
        return `Attention! There are ${count} permission requests waiting for your approval.`;
      }
    }
  };

  /**
   * Process the batched permission requests as a single notification
   * Called after the batch window expires
   */
  const processPermissionBatch = async () => {
    // Capture and clear the batch
    const batch = [...pendingPermissionBatch];
    const batchCount = batch.length;
    pendingPermissionBatch = [];
    permissionBatchTimeout = null;
    
    if (batchCount === 0) {
      debugLog('processPermissionBatch: empty batch, skipping');
      return;
    }

    debugLog(`processPermissionBatch: processing ${batchCount} permission(s)`);
    
    // Set activePermissionId to the first one (for race condition checks)
    // We track all IDs in the batch for proper cleanup
    activePermissionId = batch[0];
    
    // Show toast with count
    const toastMessage = batchCount === 1
      ? "⚠️ Permission request requires your attention"
      : `⚠️ ${batchCount} permission requests require your attention`;
    await showToast(toastMessage, "warning", 8000);

    // CHECK: Did user already respond while we were showing toast?
    if (pendingPermissionBatch.length > 0) {
      // New permissions arrived during toast - they'll be handled in next batch
      debugLog('processPermissionBatch: new permissions arrived during toast');
    }
    
    // Check if any permission was already replied to
    if (activePermissionId === null) {
      debugLog('processPermissionBatch: aborted - user already responded');
      return;
    }

    // Get count-aware TTS message
    const ttsMessage = getPermissionMessage(batchCount, false);
    const reminderMessage = getPermissionMessage(batchCount, true);

    // Smart notification: sound first, TTS reminder later
    await smartNotify('permission', {
      soundFile: config.permissionSound,
      soundLoops: batchCount === 1 ? 2 : Math.min(3, batchCount), // More loops for more permissions
      ttsMessage: reminderMessage,
      fallbackSound: config.permissionSound,
      // Pass count for potential use in notification
      permissionCount: batchCount
    });
    
    // Speak immediately if in TTS-first or both mode (with count-aware message)
    if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
      await tts.wakeMonitor();
      await tts.forceVolume();
      await tts.speak(ttsMessage, {
        enableTTS: true,
        fallbackSound: config.permissionSound
      });
    }
    
    // Final check: if user responded during notification, cancel scheduled reminder
    if (activePermissionId === null) {
      debugLog('processPermissionBatch: user responded during notification - cancelling reminder');
      cancelPendingReminder('permission');
    }
  };

  return {
    event: async ({ event }) => {
      try {
        // ========================================
        // USER ACTIVITY DETECTION
        // Cancels pending TTS reminders when user responds
        // ========================================
        // NOTE: OpenCode event types (supporting SDK v1.0.x and v1.1.x):
        //   - message.updated: fires when a message is added/updated (use properties.info.role to check user vs assistant)
        //   - permission.updated (SDK v1.0.x): fires when a permission request is created
        //   - permission.asked (SDK v1.1.1+): fires when a permission request is created (replaces permission.updated)
        //   - permission.replied: fires when user responds to a permission request
        //     - SDK v1.0.x: uses permissionID, response
        //     - SDK v1.1.1+: uses requestID, reply
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
          // Structure varies by SDK version:
          //   - Old SDK: event.properties.{ sessionID, permissionID, response }
          //   - New SDK (v1.1.1+): event.properties.{ sessionID, requestID, reply }
          // CRITICAL: Clear activePermissionId FIRST to prevent race condition
          // where permission.updated/asked handler is still running async operations
          const repliedPermissionId = event.properties?.permissionID || event.properties?.requestID;
          const response = event.properties?.response || event.properties?.reply;
          
          // Remove this permission from the pending batch (if still waiting)
          if (repliedPermissionId && pendingPermissionBatch.includes(repliedPermissionId)) {
            pendingPermissionBatch = pendingPermissionBatch.filter(id => id !== repliedPermissionId);
            debugLog(`Permission replied: removed ${repliedPermissionId} from pending batch (${pendingPermissionBatch.length} remaining)`);
          }
          
          // If batch is now empty and we have a pending batch timeout, we can cancel it
          // (user responded to all permissions before batch window expired)
          if (pendingPermissionBatch.length === 0 && permissionBatchTimeout) {
            clearTimeout(permissionBatchTimeout);
            permissionBatchTimeout = null;
            debugLog('Permission replied: cancelled batch timeout (all permissions handled)');
          }
          
          // Match if IDs are equal, or if we have an active permission with unknown ID (undefined)
          // (This happens if permission.updated/asked received an event without permissionID)
          if (activePermissionId === repliedPermissionId || activePermissionId === undefined) {
            activePermissionId = null;
            debugLog(`Permission replied: cleared activePermissionId ${repliedPermissionId || '(unknown)'}`);
          }
          lastUserActivityTime = Date.now();
          cancelPendingReminder('permission'); // Cancel permission-specific reminder
          debugLog(`Permission replied: ${event.type} (response=${response}) - cancelled permission reminder`);
        }
        
        if (event.type === "session.created") {
          // New session started - reset tracking state
          lastUserActivityTime = Date.now();
          lastSessionIdleTime = 0;
          activePermissionId = null;
          seenUserMessageIds.clear();
          cancelAllPendingReminders();
          
          // Reset permission batch state
          pendingPermissionBatch = [];
          if (permissionBatchTimeout) {
            clearTimeout(permissionBatchTimeout);
            permissionBatchTimeout = null;
          }
          
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
        // NOTIFICATION 2: Permission Request (BATCHED)
        // ========================================
        // NOTE: OpenCode SDK v1.1.1+ changed permission events:
        //   - Old: "permission.updated" with properties.id
        //   - New: "permission.asked" with properties.id
        // We support both for backward compatibility.
        //
        // BATCHING: When multiple permissions arrive simultaneously (e.g., 5 at once),
        // we batch them into a single notification instead of playing 5 overlapping sounds.
        if (event.type === "permission.updated" || event.type === "permission.asked") {
          // Capture permissionID
          const permissionId = event.properties?.id;
          
          if (!permissionId) {
             debugLog(`${event.type}: permission ID missing. properties keys: ` + Object.keys(event.properties || {}).join(', '));
          }

          // Add to the pending batch (avoid duplicates)
          if (permissionId && !pendingPermissionBatch.includes(permissionId)) {
            pendingPermissionBatch.push(permissionId);
            debugLog(`${event.type}: added ${permissionId} to batch (now ${pendingPermissionBatch.length} pending)`);
          } else if (!permissionId) {
            // If no ID, still count it (use a placeholder)
            pendingPermissionBatch.push(`unknown-${Date.now()}`);
            debugLog(`${event.type}: added unknown permission to batch (now ${pendingPermissionBatch.length} pending)`);
          }
          
          // Reset the batch window timer (debounce)
          // This gives more permissions a chance to arrive before we notify
          if (permissionBatchTimeout) {
            clearTimeout(permissionBatchTimeout);
          }
          
          permissionBatchTimeout = setTimeout(async () => {
            try {
              await processPermissionBatch();
            } catch (e) {
              debugLog(`processPermissionBatch error: ${e.message}`);
            }
          }, PERMISSION_BATCH_WINDOW_MS);
          
          debugLog(`${event.type}: batch window reset (will process in ${PERMISSION_BATCH_WINDOW_MS}ms if no more arrive)`);
        }
      } catch (e) {
        debugLog(`event handler error: ${e.message}`);
      }
    },
  };
}
