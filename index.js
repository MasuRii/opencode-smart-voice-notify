import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTTS, getTTSConfig } from './util/tts.js';
import { getSmartMessage } from './util/ai-messages.js';

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

  // Master switch: if plugin is disabled, return empty handlers immediately
  if (config.enabled === false) {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const logsDir = path.join(configDir, 'logs');
    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    if (config.debugLog) {
      try {
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] Plugin disabled via config (enabled: false) - no event handlers registered\n`);
      } catch (e) {}
    }
    return {};
  }

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

  // ========================================
  // QUESTION BATCHING STATE (SDK v1.1.7+)
  // Batches multiple simultaneous question requests into a single notification
  // ========================================
  
  // Array of question request objects waiting to be notified (collected during batch window)
  // Each object contains { id: string, questionCount: number } to track actual question count
  let pendingQuestionBatch = [];
  
  // Timeout ID for the question batch window (debounce timer)
  let questionBatchTimeout = null;
  
  // Batch window duration in milliseconds (how long to wait for more questions)
  const QUESTION_BATCH_WINDOW_MS = config.questionBatchWindowMs || 800;
  
  // Track active question request to prevent race condition where user responds
  // before async notification code runs. Set on question.asked, cleared on question.replied/rejected.
  let activeQuestionId = null;

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
   * @param {string} type - 'idle', 'permission', or 'question'
   * @param {string} message - The TTS message to speak (used directly, supports count-aware messages)
   * @param {object} options - Additional options (fallbackSound, permissionCount, questionCount)
   */
  const scheduleTTSReminder = (type, message, options = {}) => {
    // Check if TTS reminders are enabled
    if (!config.enableTTSReminder) {
      debugLog(`scheduleTTSReminder: TTS reminders disabled`);
      return;
    }

    // Get delay from config (in seconds, convert to ms)
    let delaySeconds;
    if (type === 'permission') {
      delaySeconds = config.permissionReminderDelaySeconds || config.ttsReminderDelaySeconds || 30;
    } else if (type === 'question') {
      delaySeconds = config.questionReminderDelaySeconds || config.ttsReminderDelaySeconds || 25;
    } else {
      delaySeconds = config.idleReminderDelaySeconds || config.ttsReminderDelaySeconds || 30;
    }
    const delayMs = delaySeconds * 1000;

    // Cancel any existing reminder of this type
    cancelPendingReminder(type);

    // Store count for generating count-aware messages in reminders
    const itemCount = options.permissionCount || options.questionCount || 1;

    debugLog(`scheduleTTSReminder: scheduling ${type} TTS in ${delaySeconds}s (count=${itemCount})`);

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

        debugLog(`scheduleTTSReminder: firing ${type} TTS reminder (count=${reminder?.itemCount || 1})`);
        
        // Get the appropriate reminder message
        // For permissions/questions with count > 1, use the count-aware message generator
        const storedCount = reminder?.itemCount || 1;
        let reminderMessage;
        if (type === 'permission') {
          reminderMessage = await getPermissionMessage(storedCount, true);
        } else if (type === 'question') {
          reminderMessage = await getQuestionMessage(storedCount, true);
        } else {
          reminderMessage = await getSmartMessage('idle', true, config.idleReminderTTSMessages);
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
              const followUpStoredCount = followUpReminder?.itemCount || 1;
              let followUpMessage;
              if (type === 'permission') {
                followUpMessage = await getPermissionMessage(followUpStoredCount, true);
              } else if (type === 'question') {
                followUpMessage = await getQuestionMessage(followUpStoredCount, true);
              } else {
                followUpMessage = await getSmartMessage('idle', true, config.idleReminderTTSMessages);
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
              itemCount: storedCount  // Preserve the count for follow-ups
            });
          }
        }
      } catch (e) {
        debugLog(`scheduleTTSReminder error: ${e.message}`);
        pendingReminders.delete(type);
      }
    }, delayMs);

    // Store the pending reminder with item count
    pendingReminders.set(type, {
      timeoutId,
      scheduledAt: Date.now(),
      followUpCount: 0,
      itemCount  // Store count for later use
    });
  };

  /**
   * Smart notification: play sound first, then schedule TTS reminder
   * @param {string} type - 'idle', 'permission', or 'question'
   * @param {object} options - Notification options
   */
  const smartNotify = async (type, options = {}) => {
    const {
      soundFile,
      soundLoops = 1,
      ttsMessage,
      fallbackSound,
      permissionCount,  // Support permission count for batched notifications
      questionCount       // Support question count for batched notifications
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
    // For question notifications: check if the question was already answered/rejected
    if (type === 'question' && !activeQuestionId) {
      debugLog(`smartNotify: question handled during sound - aborting reminder`);
      return;
    }

    // Step 2: Schedule TTS reminder if user doesn't respond
    if (config.enableTTSReminder && ttsMessage) {
      scheduleTTSReminder(type, ttsMessage, { fallbackSound, permissionCount, questionCount });
    }
    
    // Step 3: If TTS-first mode is enabled, also speak immediately
    if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
      let immediateMessage;
      if (type === 'permission') {
        immediateMessage = await getSmartMessage('permission', false, config.permissionTTSMessages);
      } else if (type === 'question') {
        immediateMessage = await getSmartMessage('question', false, config.questionTTSMessages);
      } else {
        immediateMessage = await getSmartMessage('idle', false, config.idleTTSMessages);
      }
      
      await tts.speak(immediateMessage, {
        enableTTS: true,
        fallbackSound
      });
    }
  };

  /**
   * Get a count-aware TTS message for permission requests
   * Uses AI generation when enabled, falls back to static messages
   * @param {number} count - Number of permission requests
   * @param {boolean} isReminder - Whether this is a reminder message
   * @returns {Promise<string>} The formatted message
   */
  const getPermissionMessage = async (count, isReminder = false) => {
    const messages = isReminder 
      ? config.permissionReminderTTSMessages 
      : config.permissionTTSMessages;
    
    // If AI messages are enabled, ALWAYS try AI first (regardless of count)
    if (config.enableAIMessages) {
      const aiMessage = await getSmartMessage('permission', isReminder, messages, { count, type: 'permission' });
      // getSmartMessage returns static message as fallback, so if AI was attempted
      // and succeeded, we'll get the AI message. If it failed, we get static.
      // Check if we got a valid message (not the generic fallback)
      if (aiMessage && aiMessage !== 'Notification') {
        return aiMessage;
      }
    }
    
    // Fallback to static messages (AI disabled or failed with generic fallback)
    if (count === 1) {
      return getRandomMessage(messages);
    } else {
      const countMessages = isReminder
        ? config.permissionReminderTTSMessagesMultiple
        : config.permissionTTSMessagesMultiple;
      
      if (countMessages && countMessages.length > 0) {
        const template = getRandomMessage(countMessages);
        return template.replace('{count}', count.toString());
      }
      return `Attention! There are ${count} permission requests waiting for your approval.`;
    }
  };

  /**
   * Get a count-aware TTS message for question requests (SDK v1.1.7+)
   * Uses AI generation when enabled, falls back to static messages
   * @param {number} count - Number of question requests
   * @param {boolean} isReminder - Whether this is a reminder message
   * @returns {Promise<string>} The formatted message
   */
  const getQuestionMessage = async (count, isReminder = false) => {
    const messages = isReminder 
      ? config.questionReminderTTSMessages 
      : config.questionTTSMessages;
    
    // If AI messages are enabled, ALWAYS try AI first (regardless of count)
    if (config.enableAIMessages) {
      const aiMessage = await getSmartMessage('question', isReminder, messages, { count, type: 'question' });
      // getSmartMessage returns static message as fallback, so if AI was attempted
      // and succeeded, we'll get the AI message. If it failed, we get static.
      // Check if we got a valid message (not the generic fallback)
      if (aiMessage && aiMessage !== 'Notification') {
        return aiMessage;
      }
    }
    
    // Fallback to static messages (AI disabled or failed with generic fallback)
    if (count === 1) {
      return getRandomMessage(messages);
    } else {
      const countMessages = isReminder
        ? config.questionReminderTTSMessagesMultiple
        : config.questionTTSMessagesMultiple;
      
      if (countMessages && countMessages.length > 0) {
        const template = getRandomMessage(countMessages);
        return template.replace('{count}', count.toString());
      }
      return `Hey! I have ${count} questions for you. Please check your screen.`;
    }
  };

  /**
   * Process the batched permission requests as a single notification
   * Called after the batch window expires
   * 
   * FIX: Play sound IMMEDIATELY before any AI generation to avoid delay.
   * AI message generation can take 3-15+ seconds, which was delaying sound playback.
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
    
    // Step 1: Show toast IMMEDIATELY (fire and forget - no await)
    const toastMessage = batchCount === 1
      ? "⚠️ Permission request requires your attention"
      : `⚠️ ${batchCount} permission requests require your attention`;
    showToast(toastMessage, "warning", 8000);  // No await - instant display
    
    // Step 2: Play sound (after toast is triggered)
    const soundLoops = batchCount === 1 ? 2 : Math.min(3, batchCount);
    await playSound(config.permissionSound, soundLoops);

    // CHECK: Did user already respond while sound was playing?
    if (pendingPermissionBatch.length > 0) {
      // New permissions arrived during sound - they'll be handled in next batch
      debugLog('processPermissionBatch: new permissions arrived during sound');
    }
    
    // Step 3: Check race condition - did user respond during sound?
    if (activePermissionId === null) {
      debugLog('processPermissionBatch: user responded during sound - aborting');
      return;
    }

    // Step 4: Generate AI message for reminder AFTER sound played
    const reminderMessage = await getPermissionMessage(batchCount, true);
    
    // Step 5: Schedule TTS reminder if enabled
    if (config.enableTTSReminder && reminderMessage) {
      scheduleTTSReminder('permission', reminderMessage, {
        fallbackSound: config.permissionSound,
        permissionCount: batchCount
      });
    }
    
    // Step 6: If TTS-first or both mode, generate and speak immediate message
    if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
      const ttsMessage = await getPermissionMessage(batchCount, false);
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

  /**
   * Process the batched question requests as a single notification (SDK v1.1.7+)
   * Called after the batch window expires
   * 
   * FIX: Play sound IMMEDIATELY before any AI generation to avoid delay.
   * AI message generation can take 3-15+ seconds, which was delaying sound playback.
   */
  const processQuestionBatch = async () => {
    // Capture and clear the batch
    const batch = [...pendingQuestionBatch];
    pendingQuestionBatch = [];
    questionBatchTimeout = null;
    
    if (batch.length === 0) {
      debugLog('processQuestionBatch: empty batch, skipping');
      return;
    }

    // Calculate total number of questions across all batched requests
    // Each batch item is { id, questionCount } where questionCount is the number of questions in that request
    const totalQuestionCount = batch.reduce((sum, item) => sum + (item.questionCount || 1), 0);
    
    debugLog(`processQuestionBatch: processing ${batch.length} request(s) with ${totalQuestionCount} total question(s)`);
    
    // Set activeQuestionId to the first one (for race condition checks)
    // We track all IDs in the batch for proper cleanup
    activeQuestionId = batch[0]?.id;
    
    // Step 1: Show toast IMMEDIATELY (fire and forget - no await)
    const toastMessage = totalQuestionCount === 1
      ? "❓ The agent has a question for you"
      : `❓ The agent has ${totalQuestionCount} questions for you`;
    showToast(toastMessage, "info", 8000);  // No await - instant display
    
    // Step 2: Play sound (after toast is triggered)
    await playSound(config.questionSound, 2);

    // CHECK: Did user already respond while sound was playing?
    if (pendingQuestionBatch.length > 0) {
      // New questions arrived during sound - they'll be handled in next batch
      debugLog('processQuestionBatch: new questions arrived during sound');
    }
    
    // Step 3: Check race condition - did user respond during sound?
    if (activeQuestionId === null) {
      debugLog('processQuestionBatch: user responded during sound - aborting');
      return;
    }

    // Step 4: Generate AI message for reminder AFTER sound played
    const reminderMessage = await getQuestionMessage(totalQuestionCount, true);

    // Step 5: Schedule TTS reminder if enabled
    if (config.enableTTSReminder && reminderMessage) {
      scheduleTTSReminder('question', reminderMessage, {
        fallbackSound: config.questionSound,
        questionCount: totalQuestionCount
      });
    }
    
    // Step 6: If TTS-first or both mode, generate and speak immediate message
    if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
      const ttsMessage = await getQuestionMessage(totalQuestionCount, false);
      await tts.wakeMonitor();
      await tts.forceVolume();
      await tts.speak(ttsMessage, {
        enableTTS: true,
        fallbackSound: config.questionSound
      });
    }
    
    // Final check: if user responded during notification, cancel scheduled reminder
    if (activeQuestionId === null) {
      debugLog('processQuestionBatch: user responded during notification - cancelling reminder');
      cancelPendingReminder('question');
    }
  };

  return {
    event: async ({ event }) => {
      try {
        // ========================================
        // USER ACTIVITY DETECTION
        // Cancels pending TTS reminders when user responds
        // ========================================
        // NOTE: OpenCode event types (supporting SDK v1.0.x, v1.1.x, and v1.1.7+):
        //   - message.updated: fires when a message is added/updated (use properties.info.role to check user vs assistant)
        //   - permission.updated (SDK v1.0.x): fires when a permission request is created
        //   - permission.asked (SDK v1.1.1+): fires when a permission request is created (replaces permission.updated)
        //   - permission.replied: fires when user responds to a permission request
        //     - SDK v1.0.x: uses permissionID, response
        //     - SDK v1.1.1+: uses requestID, reply
        //   - question.asked (SDK v1.1.7+): fires when agent asks user a question
        //   - question.replied (SDK v1.1.7+): fires when user answers a question
        //   - question.rejected (SDK v1.1.7+): fires when user dismisses a question
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
          activeQuestionId = null;
          seenUserMessageIds.clear();
          cancelAllPendingReminders();
          
          // Reset permission batch state
          pendingPermissionBatch = [];
          if (permissionBatchTimeout) {
            clearTimeout(permissionBatchTimeout);
            permissionBatchTimeout = null;
          }
          
          // Reset question batch state
          pendingQuestionBatch = [];
          if (questionBatchTimeout) {
            clearTimeout(questionBatchTimeout);
            questionBatchTimeout = null;
          }
          
          debugLog(`Session created: ${event.type} - reset all tracking state`);
        }

        // ========================================
        // NOTIFICATION 1: Session Idle (Agent Finished)
        // 
        // FIX: Play sound IMMEDIATELY before any AI generation to avoid delay.
        // AI message generation can take 3-15+ seconds, which was delaying sound playback.
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
          
          // Step 1: Show toast IMMEDIATELY (fire and forget - no await)
          showToast("✅ Agent has finished working", "success", 5000);  // No await - instant display
          
          // Step 2: Play sound (after toast is triggered)
          // Only play sound in sound-first, sound-only, or both mode
          if (config.notificationMode !== 'tts-first') {
            await playSound(config.idleSound, 1);
          }
          
          // Step 3: Check race condition - did user respond during sound?
          if (lastUserActivityTime > lastSessionIdleTime) {
            debugLog(`session.idle: user active during sound - aborting`);
            return;
          }

          // Step 4: Generate AI message for reminder AFTER sound played
          const reminderMessage = await getSmartMessage('idle', true, config.idleReminderTTSMessages);

          // Step 5: Schedule TTS reminder if enabled
          if (config.enableTTSReminder && reminderMessage) {
            scheduleTTSReminder('idle', reminderMessage, {
              fallbackSound: config.idleSound
            });
          }
          
          // Step 6: If TTS-first or both mode, generate and speak immediate message
          if (config.notificationMode === 'tts-first' || config.notificationMode === 'both') {
            const ttsMessage = await getSmartMessage('idle', false, config.idleTTSMessages);
            await tts.wakeMonitor();
            await tts.forceVolume();
            await tts.speak(ttsMessage, {
              enableTTS: true,
              fallbackSound: config.idleSound
            });
          }
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

        // ========================================
        // NOTIFICATION 3: Question Request (BATCHED) - SDK v1.1.7+
        // ========================================
        // The "question" tool allows the LLM to ask users questions during execution.
        // Events: question.asked, question.replied, question.rejected
        //
        // BATCHING: When multiple question requests arrive simultaneously,
        // we batch them into a single notification instead of playing overlapping sounds.
        // NOTE: Each question.asked event can contain multiple questions in its questions array.
        if (event.type === "question.asked") {
          // Capture question request ID and count of questions in this request
          const questionId = event.properties?.id;
          const questionsArray = event.properties?.questions;
          const questionCount = Array.isArray(questionsArray) ? questionsArray.length : 1;
          
          if (!questionId) {
            debugLog(`${event.type}: question ID missing. properties keys: ` + Object.keys(event.properties || {}).join(', '));
          }

          // Add to the pending batch (avoid duplicates by checking ID)
          // Store as object with id and questionCount for proper counting
          const existingIndex = pendingQuestionBatch.findIndex(item => item.id === questionId);
          if (questionId && existingIndex === -1) {
            pendingQuestionBatch.push({ id: questionId, questionCount });
            debugLog(`${event.type}: added ${questionId} with ${questionCount} question(s) to batch (now ${pendingQuestionBatch.length} request(s) pending)`);
          } else if (!questionId) {
            // If no ID, still count it (use a placeholder)
            pendingQuestionBatch.push({ id: `unknown-${Date.now()}`, questionCount });
            debugLog(`${event.type}: added unknown question request with ${questionCount} question(s) to batch (now ${pendingQuestionBatch.length} request(s) pending)`);
          }
          
          // Reset the batch window timer (debounce)
          // This gives more questions a chance to arrive before we notify
          if (questionBatchTimeout) {
            clearTimeout(questionBatchTimeout);
          }
          
          questionBatchTimeout = setTimeout(async () => {
            try {
              await processQuestionBatch();
            } catch (e) {
              debugLog(`processQuestionBatch error: ${e.message}`);
            }
          }, QUESTION_BATCH_WINDOW_MS);
          
          debugLog(`${event.type}: batch window reset (will process in ${QUESTION_BATCH_WINDOW_MS}ms if no more arrive)`);
        }

        // Handle question.replied - user answered the question(s)
        if (event.type === "question.replied") {
          const repliedQuestionId = event.properties?.requestID;
          const answers = event.properties?.answers;
          
          // Remove this question from the pending batch (if still waiting)
          // pendingQuestionBatch is now an array of { id, questionCount } objects
          const existingIndex = pendingQuestionBatch.findIndex(item => item.id === repliedQuestionId);
          if (repliedQuestionId && existingIndex !== -1) {
            pendingQuestionBatch.splice(existingIndex, 1);
            debugLog(`Question replied: removed ${repliedQuestionId} from pending batch (${pendingQuestionBatch.length} remaining)`);
          }
          
          // If batch is now empty and we have a pending batch timeout, we can cancel it
          if (pendingQuestionBatch.length === 0 && questionBatchTimeout) {
            clearTimeout(questionBatchTimeout);
            questionBatchTimeout = null;
            debugLog('Question replied: cancelled batch timeout (all questions handled)');
          }
          
          // Clear active question ID
          if (activeQuestionId === repliedQuestionId || activeQuestionId === undefined) {
            activeQuestionId = null;
            debugLog(`Question replied: cleared activeQuestionId ${repliedQuestionId || '(unknown)'}`);
          }
          lastUserActivityTime = Date.now();
          cancelPendingReminder('question'); // Cancel question-specific reminder
          debugLog(`Question replied: ${event.type} (answers=${JSON.stringify(answers)}) - cancelled question reminder`);
        }

        // Handle question.rejected - user dismissed the question
        if (event.type === "question.rejected") {
          const rejectedQuestionId = event.properties?.requestID;
          
          // Remove this question from the pending batch (if still waiting)
          // pendingQuestionBatch is now an array of { id, questionCount } objects
          const existingIndex = pendingQuestionBatch.findIndex(item => item.id === rejectedQuestionId);
          if (rejectedQuestionId && existingIndex !== -1) {
            pendingQuestionBatch.splice(existingIndex, 1);
            debugLog(`Question rejected: removed ${rejectedQuestionId} from pending batch (${pendingQuestionBatch.length} remaining)`);
          }
          
          // If batch is now empty and we have a pending batch timeout, we can cancel it
          if (pendingQuestionBatch.length === 0 && questionBatchTimeout) {
            clearTimeout(questionBatchTimeout);
            questionBatchTimeout = null;
            debugLog('Question rejected: cancelled batch timeout (all questions handled)');
          }
          
          // Clear active question ID
          if (activeQuestionId === rejectedQuestionId || activeQuestionId === undefined) {
            activeQuestionId = null;
            debugLog(`Question rejected: cleared activeQuestionId ${rejectedQuestionId || '(unknown)'}`);
          }
          lastUserActivityTime = Date.now();
          cancelPendingReminder('question'); // Cancel question-specific reminder
          debugLog(`Question rejected: ${event.type} - cancelled question reminder`);
        }
      } catch (e) {
        debugLog(`event handler error: ${e.message}`);
      }
    },
  };
}
