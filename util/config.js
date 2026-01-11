import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

/**
 * Debug logging to file (no console output).
 * Logs are written to ~/.config/opencode/logs/smart-voice-notify-debug.log
 * @param {string} message - Message to log
 * @param {string} configDir - Config directory path
 */
const debugLogToFile = (message, configDir) => {
  try {
    const logsDir = path.join(configDir, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [config] ${message}\n`);
  } catch (e) {
    // Silently fail - logging should never break the plugin
  }
};

/**
 * Basic JSONC parser that strips single-line and multi-line comments.
 * @param {string} jsonc 
 * @returns {any}
 */
const parseJSONC = (jsonc) => {
  const stripped = jsonc.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
  return JSON.parse(stripped);
};

/**
 * Helper to format JSON values for the template.
 * @param {any} val 
 * @param {number} indent 
 * @returns {string}
 */
const formatJSON = (val, indent = 0) => {
  const json = JSON.stringify(val, null, 4);
  return indent > 0 ? json.replace(/\n/g, '\n' + ' '.repeat(indent)) : json;
};

/**
 * Deep merge two objects. User values take precedence over defaults.
 * - For objects: recursively merge, adding new keys from defaults
 * - For arrays: user's array completely replaces default (no merge)
 * - For primitives: user's value takes precedence if it exists
 * 
 * @param {object} defaults - The default configuration object
 * @param {object} user - The user's existing configuration object
 * @returns {object} Merged configuration with user values preserved
 */
const deepMerge = (defaults, user) => {
  // If user value doesn't exist, use default
  if (user === undefined || user === null) {
    return defaults;
  }
  
  // If either is not an object (or is array), user value wins
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return user;
  }
  if (typeof user !== 'object' || user === null || Array.isArray(user)) {
    return user;
  }
  
  // Both are objects - merge them
  const result = { ...user };
  
  for (const key of Object.keys(defaults)) {
    if (!(key in user)) {
      // Key doesn't exist in user config - add it from defaults
      result[key] = defaults[key];
    } else if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
      // Both have this key and it's an object - recurse
      result[key] = deepMerge(defaults[key], user[key]);
    }
    // else: user has this key and it's not an object to merge - keep user's value
  }
  
  return result;
};

/**
 * Get the default configuration object.
 * This is the source of truth for all default values.
 * @returns {object} Default configuration object
 */
const getDefaultConfigObject = () => ({
  _configVersion: null, // Will be set by caller
  enabled: true,
  notificationMode: 'sound-first',
  enableTTSReminder: true,
  ttsReminderDelaySeconds: 30,
  idleReminderDelaySeconds: 30,
  permissionReminderDelaySeconds: 20,
  enableFollowUpReminders: true,
  maxFollowUpReminders: 3,
  reminderBackoffMultiplier: 1.5,
  ttsEngine: 'elevenlabs',
  enableTTS: true,
  // elevenLabsApiKey is intentionally omitted - users must set it
  elevenLabsVoiceId: 'cgSgspJ2msm6clMCkdW9',
  elevenLabsModel: 'eleven_turbo_v2_5',
  elevenLabsStability: 0.5,
  elevenLabsSimilarity: 0.75,
  elevenLabsStyle: 0.5,
  edgeVoice: 'en-US-JennyNeural',
  edgePitch: '+0Hz',
  edgeRate: '+10%',
  sapiVoice: 'Microsoft Zira Desktop',
  sapiRate: -1,
  sapiPitch: 'medium',
  sapiVolume: 'loud',
  openaiTtsEndpoint: '',
  openaiTtsApiKey: '',
  openaiTtsModel: 'tts-1',
  openaiTtsVoice: 'alloy',
  openaiTtsFormat: 'mp3',
  openaiTtsSpeed: 1.0,
  idleTTSMessages: [
    "All done! Your task has been completed successfully.",
    "Hey there! I finished working on your request.",
    "Task complete! Ready for your review whenever you are.",
    "Good news! Everything is done and ready for you.",
    "Finished! Let me know if you need anything else."
  ],
  permissionTTSMessages: [
    "Attention please! I need your permission to continue.",
    "Hey! Quick approval needed to proceed with the task.",
    "Heads up! There is a permission request waiting for you.",
    "Excuse me! I need your authorization before I can continue.",
    "Permission required! Please review and approve when ready."
  ],
  permissionTTSMessagesMultiple: [
    "Attention please! There are {count} permission requests waiting for your approval.",
    "Hey! {count} permissions need your approval to continue.",
    "Heads up! You have {count} pending permission requests.",
    "Excuse me! I need your authorization for {count} different actions.",
    "{count} permissions required! Please review and approve when ready."
  ],
  idleReminderTTSMessages: [
    "Hey, are you still there? Your task has been waiting for review.",
    "Just a gentle reminder - I finished your request a while ago!",
    "Hello? I completed your task. Please take a look when you can.",
    "Still waiting for you! The work is done and ready for review.",
    "Knock knock! Your completed task is patiently waiting for you."
  ],
  permissionReminderTTSMessages: [
    "Hey! I still need your permission to continue. Please respond!",
    "Reminder: There is a pending permission request. I cannot proceed without you.",
    "Hello? I am waiting for your approval. This is getting urgent!",
    "Please check your screen! I really need your permission to move forward.",
    "Still waiting for authorization! The task is on hold until you respond."
  ],
  permissionReminderTTSMessagesMultiple: [
    "Hey! I still need your approval for {count} permissions. Please respond!",
    "Reminder: There are {count} pending permission requests. I cannot proceed without you.",
    "Hello? I am waiting for your approval on {count} items. This is getting urgent!",
    "Please check your screen! {count} permissions are waiting for your response.",
    "Still waiting for authorization on {count} requests! The task is on hold."
  ],
  permissionBatchWindowMs: 800,
  questionTTSMessages: [
    "Hey! I have a question for you. Please check your screen.",
    "Attention! I need your input to continue.",
    "Quick question! Please take a look when you have a moment.",
    "I need some clarification. Could you please respond?",
    "Question time! Your input is needed to proceed."
  ],
  questionTTSMessagesMultiple: [
    "Hey! I have {count} questions for you. Please check your screen.",
    "Attention! I need your input on {count} items to continue.",
    "{count} questions need your attention. Please take a look!",
    "I need some clarifications. There are {count} questions waiting for you.",
    "Question time! {count} questions need your response to proceed."
  ],
  questionReminderTTSMessages: [
    "Hey! I am still waiting for your answer. Please check the questions!",
    "Reminder: There is a question waiting for your response.",
    "Hello? I need your input to continue. Please respond when you can.",
    "Still waiting for your answer! The task is on hold.",
    "Your input is needed! Please check the pending question."
  ],
  questionReminderTTSMessagesMultiple: [
    "Hey! I am still waiting for answers to {count} questions. Please respond!",
    "Reminder: There are {count} questions waiting for your response.",
    "Hello? I need your input on {count} items. Please respond when you can.",
    "Still waiting for your answers on {count} questions! The task is on hold.",
    "Your input is needed! {count} questions are pending your response."
  ],
  questionReminderDelaySeconds: 25,
  questionBatchWindowMs: 800,
  enableAIMessages: false,
  aiEndpoint: 'http://localhost:11434/v1',
  aiModel: 'llama3',
  aiApiKey: '',
  aiTimeout: 15000,
  aiFallbackToStatic: true,
  aiPrompts: {
    idle: "Generate a single brief, friendly notification sentence (max 15 words) saying a coding task is complete. Be encouraging and warm. Output only the message, no quotes.",
    permission: "Generate a single brief, urgent but friendly notification sentence (max 15 words) asking the user to approve a permission request. Output only the message, no quotes.",
    question: "Generate a single brief, polite notification sentence (max 15 words) saying the assistant has a question and needs user input. Output only the message, no quotes.",
    idleReminder: "Generate a single brief, gentle reminder sentence (max 15 words) that a completed task is waiting for review. Be slightly more insistent. Output only the message, no quotes.",
    permissionReminder: "Generate a single brief, urgent reminder sentence (max 15 words) that permission approval is still needed. Convey importance. Output only the message, no quotes.",
    questionReminder: "Generate a single brief, polite but persistent reminder sentence (max 15 words) that a question is still waiting for an answer. Output only the message, no quotes."
  },
  idleSound: 'assets/Soft-high-tech-notification-sound-effect.mp3',
  permissionSound: 'assets/Machine-alert-beep-sound-effect.mp3',
  questionSound: 'assets/Machine-alert-beep-sound-effect.mp3',
  wakeMonitor: true,
  forceVolume: true,
  volumeThreshold: 50,
  enableToast: true,
  enableSound: true,
  idleThresholdSeconds: 60,
  debugLog: false
});

/**
 * Find new fields that exist in defaults but not in user config.
 * Used for logging what was added during migration.
 * @param {object} defaults 
 * @param {object} user 
 * @param {string} prefix 
 * @returns {string[]} Array of field paths that were added
 */
const findNewFields = (defaults, user, prefix = '') => {
  const newFields = [];
  
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return newFields;
  }
  
  for (const key of Object.keys(defaults)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    
    if (!(key in user)) {
      newFields.push(fieldPath);
    } else if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
      if (typeof user[key] === 'object' && user[key] !== null && !Array.isArray(user[key])) {
        newFields.push(...findNewFields(defaults[key], user[key], fieldPath));
      }
    }
  }
  
  return newFields;
};

/**
 * Get the directory where this plugin is installed.
 * Used to find bundled assets like example.config.jsonc
 */
const getPluginDir = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.dirname(__dirname); // Go up from util/ to plugin root
};

/**
 * Generate a comprehensive default configuration file content.
 * This provides users with ALL available options fully documented.
 * @param {object} overrides - Existing configuration to preserve
 * @param {string} version - Current version to set in config
 */
const generateDefaultConfig = (overrides = {}, version = '1.0.0') => {
  return `{
    // ============================================================
    // OpenCode Smart Voice Notify - Configuration
    // ============================================================
    // 
    // This file was auto-generated with all available options.
    // Customize the settings below to your preference.
    // 
    // Sound files have been automatically copied to:
    //   ~/.config/opencode/assets/
    //
    // Documentation: https://github.com/MasuRii/opencode-smart-voice-notify
    //
    // ============================================================

    // Internal version tracking - DO NOT REMOVE
    "_configVersion": "${version}",

    // ============================================================
    // PLUGIN ENABLE/DISABLE
    // ============================================================
    // Master switch to enable or disable the entire plugin.
    // Set to false to disable all notifications without uninstalling.
    "enabled": ${overrides.enabled !== undefined ? overrides.enabled : true},

    // ============================================================
    // NOTIFICATION MODE SETTINGS (Smart Notification System)
    // ============================================================
    // Controls how notifications are delivered:
    //   'sound-first' - Play sound immediately, TTS reminder after delay (RECOMMENDED)
    //   'tts-first'   - Speak TTS immediately, no sound
    //   'both'        - Play sound AND speak TTS immediately
    //   'sound-only'  - Only play sound, no TTS at all
    "notificationMode": "${overrides.notificationMode || 'sound-first'}",
    
    // ============================================================
    // TTS REMINDER SETTINGS (When user doesn't respond to sound)
    // ============================================================
    
    // Enable TTS reminder if user doesn't respond after sound notification
    "enableTTSReminder": ${overrides.enableTTSReminder !== undefined ? overrides.enableTTSReminder : true},
    
    // Delay (in seconds) before TTS reminder fires
    // Set globally or per-notification type
    "ttsReminderDelaySeconds": ${overrides.ttsReminderDelaySeconds !== undefined ? overrides.ttsReminderDelaySeconds : 30},         // Global default
    "idleReminderDelaySeconds": ${overrides.idleReminderDelaySeconds !== undefined ? overrides.idleReminderDelaySeconds : 30},        // For task completion notifications
    "permissionReminderDelaySeconds": ${overrides.permissionReminderDelaySeconds !== undefined ? overrides.permissionReminderDelaySeconds : 20},  // For permission requests (more urgent)
    
    // Follow-up reminders if user STILL doesn't respond after first TTS
    "enableFollowUpReminders": ${overrides.enableFollowUpReminders !== undefined ? overrides.enableFollowUpReminders : true},
    "maxFollowUpReminders": ${overrides.maxFollowUpReminders !== undefined ? overrides.maxFollowUpReminders : 3},              // Max number of follow-up TTS reminders
    "reminderBackoffMultiplier": ${overrides.reminderBackoffMultiplier !== undefined ? overrides.reminderBackoffMultiplier : 1.5},       // Each follow-up waits longer (30s, 45s, 67s...)

    // ============================================================
    // TTS ENGINE SELECTION
    // ============================================================
    // 'elevenlabs' - Best quality, anime-like voices (requires API key, free tier: 10k chars/month)
    // 'edge'       - Good quality neural voices (free, requires: pip install edge-tts)
    // 'sapi'       - Windows built-in voices (free, offline, robotic)
    "ttsEngine": "${overrides.ttsEngine || 'elevenlabs'}",
    
    // Enable TTS for notifications (falls back to sound files if TTS fails)
    "enableTTS": ${overrides.enableTTS !== undefined ? overrides.enableTTS : true},
    
    // ============================================================
    // ELEVENLABS SETTINGS (Best Quality - Anime-like Voices)
    // ============================================================
    // Get your API key from: https://elevenlabs.io/app/settings/api-keys
    // Free tier: 10,000 characters/month
    // 
    // To use ElevenLabs:
    // 1. Uncomment elevenLabsApiKey and add your key
    // 2. Change ttsEngine above to "elevenlabs"
    //
    ${overrides.elevenLabsApiKey ? `"elevenLabsApiKey": "${overrides.elevenLabsApiKey}",` : `// "elevenLabsApiKey": "YOUR_API_KEY_HERE",`}
    
    // Voice ID - Recommended cute/anime-like voices:
    //   'cgSgspJ2msm6clMCkdW9' - Jessica (Playful, Bright, Warm) - RECOMMENDED
    //   'FGY2WhTYpPnrIDTdsKH5' - Laura (Enthusiast, Quirky)
    //   'jsCqWAovK2LkecY7zXl4' - Freya (Expressive, Confident)
    //   'EXAVITQu4vr4xnSDxMaL' - Sarah (Soft, Warm)
    // Browse more at: https://elevenlabs.io/voice-library
    "elevenLabsVoiceId": "${overrides.elevenLabsVoiceId || 'cgSgspJ2msm6clMCkdW9'}",
    
    // Model: 'eleven_turbo_v2_5' (fast, good), 'eleven_multilingual_v2' (highest quality)
    "elevenLabsModel": "${overrides.elevenLabsModel || 'eleven_turbo_v2_5'}",
    
    // Voice tuning (0.0 to 1.0)
    "elevenLabsStability": ${overrides.elevenLabsStability !== undefined ? overrides.elevenLabsStability : 0.5},       // Lower = more expressive, Higher = more consistent
    "elevenLabsSimilarity": ${overrides.elevenLabsSimilarity !== undefined ? overrides.elevenLabsSimilarity : 0.75},     // How closely to match the original voice
    "elevenLabsStyle": ${overrides.elevenLabsStyle !== undefined ? overrides.elevenLabsStyle : 0.5},           // Style exaggeration (higher = more expressive)
    
    // ============================================================
    // EDGE TTS SETTINGS (Free Neural Voices - Default Engine)
    // ============================================================
    // Requires: pip install edge-tts
    
    // Voice options (run 'edge-tts --list-voices' to see all):
    //   'en-US-AnaNeural'   - Young, cute, cartoon-like (RECOMMENDED)
    //   'en-US-JennyNeural' - Friendly, warm
    //   'en-US-AriaNeural'  - Confident, clear
    //   'en-GB-SoniaNeural' - British, friendly
    //   'en-AU-NatashaNeural' - Australian, warm
    "edgeVoice": "${overrides.edgeVoice || 'en-US-JennyNeural'}",
    
    // Pitch adjustment: +0Hz to +100Hz (higher = more anime-like)
    "edgePitch": "${overrides.edgePitch || '+0Hz'}",
    
    // Speech rate: -50% to +100%
    "edgeRate": "${overrides.edgeRate || '+10%'}",
    
    // ============================================================
    // SAPI SETTINGS (Windows Built-in - Last Resort Fallback)
    // ============================================================
    
    // Voice (run PowerShell to list all installed voices):
    //   Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name }
    //
    // Common Windows voices:
    //   'Microsoft Zira Desktop' - Female, US English
    //   'Microsoft David Desktop' - Male, US English
    //   'Microsoft Hazel Desktop' - Female, UK English
    "sapiVoice": "${overrides.sapiVoice || 'Microsoft Zira Desktop'}",
    
    // Speech rate: -10 (slowest) to +10 (fastest), 0 is normal
    "sapiRate": ${overrides.sapiRate !== undefined ? overrides.sapiRate : -1},
    
    // Pitch: 'x-low', 'low', 'medium', 'high', 'x-high'
    "sapiPitch": "${overrides.sapiPitch || 'medium'}",
    
    // Volume: 'silent', 'x-soft', 'soft', 'medium', 'loud', 'x-loud'
    "sapiVolume": "${overrides.sapiVolume || 'loud'}",
    
    // ============================================================
    // OPENAI-COMPATIBLE TTS SETTINGS (Kokoro, LocalAI, OpenAI, etc.)
    // ============================================================
    // Any OpenAI-compatible /v1/audio/speech endpoint.
    // Examples: Kokoro, OpenAI, LocalAI, Coqui, AllTalk, etc.
    //
    // To use OpenAI-compatible TTS:
    // 1. Set ttsEngine above to "openai"
    // 2. Set openaiTtsEndpoint to your server URL (without /v1/audio/speech)
    // 3. Configure voice and model for your server
    
    // Base URL for your TTS server (e.g., "http://192.168.86.43:8880")
    "openaiTtsEndpoint": "${overrides.openaiTtsEndpoint || ''}",
    
    // API key (leave empty if your server doesn't require auth)
    "openaiTtsApiKey": "${overrides.openaiTtsApiKey || ''}",
    
    // Model name (server-dependent, e.g., "tts-1", "kokoro", "xtts")
    "openaiTtsModel": "${overrides.openaiTtsModel || 'tts-1'}",
    
    // Voice name (server-dependent)
    // Kokoro voices: "af_heart", "af_bella", "am_adam", etc.
    // OpenAI voices: "alloy", "echo", "fable", "onyx", "nova", "shimmer"
    "openaiTtsVoice": "${overrides.openaiTtsVoice || 'alloy'}",
    
    // Audio format: "mp3", "opus", "aac", "flac", "wav", "pcm"
    "openaiTtsFormat": "${overrides.openaiTtsFormat || 'mp3'}",
    
    // Speech speed: 0.25 to 4.0 (1.0 = normal)
    "openaiTtsSpeed": ${overrides.openaiTtsSpeed !== undefined ? overrides.openaiTtsSpeed : 1.0},
    
    // ============================================================
    // INITIAL TTS MESSAGES (Used immediately or after sound)
    // These are randomly selected each time for variety
    // ============================================================
    
    // Messages when agent finishes work (task completion)
    "idleTTSMessages": ${formatJSON(overrides.idleTTSMessages || [
        "All done! Your task has been completed successfully.",
        "Hey there! I finished working on your request.",
        "Task complete! Ready for your review whenever you are.",
        "Good news! Everything is done and ready for you.",
        "Finished! Let me know if you need anything else."
    ], 4)},
    
    // Messages for permission requests
    "permissionTTSMessages": ${formatJSON(overrides.permissionTTSMessages || [
        "Attention please! I need your permission to continue.",
        "Hey! Quick approval needed to proceed with the task.",
        "Heads up! There is a permission request waiting for you.",
        "Excuse me! I need your authorization before I can continue.",
        "Permission required! Please review and approve when ready."
    ], 4)},
    
    // Messages for MULTIPLE permission requests (use {count} placeholder)
    // Used when several permissions arrive simultaneously
    "permissionTTSMessagesMultiple": ${formatJSON(overrides.permissionTTSMessagesMultiple || [
        "Attention please! There are {count} permission requests waiting for your approval.",
        "Hey! {count} permissions need your approval to continue.",
        "Heads up! You have {count} pending permission requests.",
        "Excuse me! I need your authorization for {count} different actions.",
        "{count} permissions required! Please review and approve when ready."
    ], 4)},

    // ============================================================
    // TTS REMINDER MESSAGES (More urgent - used after delay if no response)
    // These are more personalized and urgent to get user attention
    // ============================================================
    
    // Reminder messages when agent finished but user hasn't responded
    "idleReminderTTSMessages": ${formatJSON(overrides.idleReminderTTSMessages || [
        "Hey, are you still there? Your task has been waiting for review.",
        "Just a gentle reminder - I finished your request a while ago!",
        "Hello? I completed your task. Please take a look when you can.",
        "Still waiting for you! The work is done and ready for review.",
        "Knock knock! Your completed task is patiently waiting for you."
    ], 4)},
    
    // Reminder messages when permission still needed
    "permissionReminderTTSMessages": ${formatJSON(overrides.permissionReminderTTSMessages || [
        "Hey! I still need your permission to continue. Please respond!",
        "Reminder: There is a pending permission request. I cannot proceed without you.",
        "Hello? I am waiting for your approval. This is getting urgent!",
        "Please check your screen! I really need your permission to move forward.",
        "Still waiting for authorization! The task is on hold until you respond."
    ], 4)},
    
    // Reminder messages for MULTIPLE permissions (use {count} placeholder)
    "permissionReminderTTSMessagesMultiple": ${formatJSON(overrides.permissionReminderTTSMessagesMultiple || [
        "Hey! I still need your approval for {count} permissions. Please respond!",
        "Reminder: There are {count} pending permission requests. I cannot proceed without you.",
        "Hello? I am waiting for your approval on {count} items. This is getting urgent!",
        "Please check your screen! {count} permissions are waiting for your response.",
        "Still waiting for authorization on {count} requests! The task is on hold."
    ], 4)},
    
    // ============================================================
    // PERMISSION BATCHING (Multiple permissions at once)
    // ============================================================
    // When multiple permissions arrive simultaneously, batch them into one notification
    // This prevents overlapping sounds when 5+ permissions come at once
    
    // Batch window (ms) - how long to wait for more permissions before notifying
    "permissionBatchWindowMs": ${overrides.permissionBatchWindowMs !== undefined ? overrides.permissionBatchWindowMs : 800},
    
    // ============================================================
    // QUESTION TOOL SETTINGS (SDK v1.1.7+ - Agent asking user questions)
    // ============================================================
    // The "question" tool allows the LLM to ask users questions during execution.
    // This is useful for gathering preferences, clarifying instructions, or getting
    // decisions on implementation choices.
    
    // Messages when agent asks user a question
    "questionTTSMessages": ${formatJSON(overrides.questionTTSMessages || [
        "Hey! I have a question for you. Please check your screen.",
        "Attention! I need your input to continue.",
        "Quick question! Please take a look when you have a moment.",
        "I need some clarification. Could you please respond?",
        "Question time! Your input is needed to proceed."
    ], 4)},
    
    // Messages for MULTIPLE questions (use {count} placeholder)
    "questionTTSMessagesMultiple": ${formatJSON(overrides.questionTTSMessagesMultiple || [
        "Hey! I have {count} questions for you. Please check your screen.",
        "Attention! I need your input on {count} items to continue.",
        "{count} questions need your attention. Please take a look!",
        "I need some clarifications. There are {count} questions waiting for you.",
        "Question time! {count} questions need your response to proceed."
    ], 4)},
    
    // Reminder messages for questions (more urgent - used after delay)
    "questionReminderTTSMessages": ${formatJSON(overrides.questionReminderTTSMessages || [
        "Hey! I am still waiting for your answer. Please check the questions!",
        "Reminder: There is a question waiting for your response.",
        "Hello? I need your input to continue. Please respond when you can.",
        "Still waiting for your answer! The task is on hold.",
        "Your input is needed! Please check the pending question."
    ], 4)},
    
    // Reminder messages for MULTIPLE questions (use {count} placeholder)
    "questionReminderTTSMessagesMultiple": ${formatJSON(overrides.questionReminderTTSMessagesMultiple || [
        "Hey! I am still waiting for answers to {count} questions. Please respond!",
        "Reminder: There are {count} questions waiting for your response.",
        "Hello? I need your input on {count} items. Please respond when you can.",
        "Still waiting for your answers on {count} questions! The task is on hold.",
        "Your input is needed! {count} questions are pending your response."
    ], 4)},
    
    // Delay (in seconds) before question reminder fires
    "questionReminderDelaySeconds": ${overrides.questionReminderDelaySeconds !== undefined ? overrides.questionReminderDelaySeconds : 25},
    
    // Question batch window (ms) - how long to wait for more questions before notifying
    "questionBatchWindowMs": ${overrides.questionBatchWindowMs !== undefined ? overrides.questionBatchWindowMs : 800},
    
    // ============================================================
    // AI MESSAGE GENERATION (OpenAI-Compatible Endpoints)
    // ============================================================
    // Use a local/self-hosted AI to generate dynamic notification messages
    // instead of using preset static messages. The AI generates the text,
    // which is then spoken by your configured TTS engine (ElevenLabs, Edge, etc.)
    //
    // Supports: Ollama, LM Studio, LocalAI, vLLM, llama.cpp, Jan.ai, and any
    // OpenAI-compatible endpoint. You provide your own endpoint URL and API key.
    
    // Enable AI-generated messages (experimental feature)
    "enableAIMessages": ${overrides.enableAIMessages !== undefined ? overrides.enableAIMessages : false},
    
    // Your AI server endpoint URL (e.g., Ollama: http://localhost:11434/v1)
    // Common endpoints:
    //   Ollama:    http://localhost:11434/v1
    //   LM Studio: http://localhost:1234/v1
    //   LocalAI:   http://localhost:8080/v1
    //   vLLM:      http://localhost:8000/v1
    //   Jan.ai:    http://localhost:1337/v1
    "aiEndpoint": "${overrides.aiEndpoint || 'http://localhost:11434/v1'}",
    
    // Model name to use (depends on what's loaded in your AI server)
    // Examples: "llama3", "mistral", "phi3", "gemma2", "qwen2"
    "aiModel": "${overrides.aiModel || 'llama3'}",
    
    // API key for your AI server (leave empty for Ollama/LM Studio/LocalAI)
    // Only needed if your server requires authentication
    "aiApiKey": "${overrides.aiApiKey || ''}",
    
    // Request timeout in milliseconds (local AI can be slow on first request)
    "aiTimeout": ${overrides.aiTimeout !== undefined ? overrides.aiTimeout : 15000},
    
    // Fallback to static preset messages if AI generation fails
    "aiFallbackToStatic": ${overrides.aiFallbackToStatic !== undefined ? overrides.aiFallbackToStatic : true},
    
    // Custom prompts for each notification type
    // The AI will generate a short message based on these prompts
    // Keep prompts concise - they're sent with each notification
    "aiPrompts": ${formatJSON(overrides.aiPrompts || {
        "idle": "Generate a single brief, friendly notification sentence (max 15 words) saying a coding task is complete. Be encouraging and warm. Output only the message, no quotes.",
        "permission": "Generate a single brief, urgent but friendly notification sentence (max 15 words) asking the user to approve a permission request. Output only the message, no quotes.",
        "question": "Generate a single brief, polite notification sentence (max 15 words) saying the assistant has a question and needs user input. Output only the message, no quotes.",
        "idleReminder": "Generate a single brief, gentle reminder sentence (max 15 words) that a completed task is waiting for review. Be slightly more insistent. Output only the message, no quotes.",
        "permissionReminder": "Generate a single brief, urgent reminder sentence (max 15 words) that permission approval is still needed. Convey importance. Output only the message, no quotes.",
        "questionReminder": "Generate a single brief, polite but persistent reminder sentence (max 15 words) that a question is still waiting for an answer. Output only the message, no quotes."
    }, 4)},
    
    // ============================================================
    // SOUND FILES (For immediate notifications)
    // These are played first before TTS reminder kicks in
    // ============================================================
    // Paths are relative to ~/.config/opencode/ directory
    // Sound files are automatically copied here on first run
    // You can replace with your own custom MP3/WAV files
    
    "idleSound": "${overrides.idleSound || 'assets/Soft-high-tech-notification-sound-effect.mp3'}",
    "permissionSound": "${overrides.permissionSound || 'assets/Machine-alert-beep-sound-effect.mp3'}",
    "questionSound": "${overrides.questionSound || 'assets/Machine-alert-beep-sound-effect.mp3'}",
    
    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    
    // Wake monitor from sleep when notifying (Windows/macOS)
    "wakeMonitor": ${overrides.wakeMonitor !== undefined ? overrides.wakeMonitor : true},
    
    // Force system volume up if below threshold
    "forceVolume": ${overrides.forceVolume !== undefined ? overrides.forceVolume : true},
    
    // Volume threshold (0-100): force volume if current level is below this
    "volumeThreshold": ${overrides.volumeThreshold !== undefined ? overrides.volumeThreshold : 50},
    
    // Show TUI toast notifications in OpenCode terminal
    "enableToast": ${overrides.enableToast !== undefined ? overrides.enableToast : true},
    
    // Enable audio notifications (sound files and TTS)
    "enableSound": ${overrides.enableSound !== undefined ? overrides.enableSound : true},
    
    // Consider monitor asleep after this many seconds of inactivity (Windows only)
    "idleThresholdSeconds": ${overrides.idleThresholdSeconds !== undefined ? overrides.idleThresholdSeconds : 60},
    
    // Enable debug logging to ~/.config/opencode/logs/smart-voice-notify-debug.log
    // The logs folder is created automatically when debug logging is enabled
    // Useful for troubleshooting notification issues
    "debugLog": ${overrides.debugLog !== undefined ? overrides.debugLog : false}
}`;
};

/**
 * Copy bundled assets (sound files) to the OpenCode config directory.
 * @param {string} configDir - The OpenCode config directory path
 */
const copyBundledAssets = (configDir) => {
  try {
    const pluginDir = getPluginDir();
    const sourceAssetsDir = path.join(pluginDir, 'assets');
    const targetAssetsDir = path.join(configDir, 'assets');

    // Check if source assets exist (they should be bundled with the plugin)
    if (!fs.existsSync(sourceAssetsDir)) {
      return; // No bundled assets to copy
    }

    // Create target assets directory if it doesn't exist
    if (!fs.existsSync(targetAssetsDir)) {
      fs.mkdirSync(targetAssetsDir, { recursive: true });
    }

    // Copy each asset file if it doesn't already exist in target
    const assetFiles = fs.readdirSync(sourceAssetsDir);
    for (const file of assetFiles) {
      const sourcePath = path.join(sourceAssetsDir, file);
      const targetPath = path.join(targetAssetsDir, file);

      // Only copy if target doesn't exist (don't overwrite user customizations)
      if (!fs.existsSync(targetPath) && fs.statSync(sourcePath).isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  } catch (error) {
    // Silently fail - assets are optional
  }
};

/**
 * Loads a configuration file from the OpenCode config directory.
 * If the file doesn't exist, creates a default config file with full documentation.
 * If the file exists, performs smart merging to add new fields without overwriting user values.
 * 
 * IMPORTANT: User values are NEVER overwritten. Only new fields from plugin updates are added.
 * 
 * @param {string} name - Name of the config file (without .jsonc extension)
 * @param {object} defaults - Default values if file doesn't exist or is invalid
 * @returns {object}
 */
export const loadConfig = (name, defaults = {}) => {
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const filePath = path.join(configDir, `${name}.jsonc`);

  // Get current version from package.json
  const pluginDir = getPluginDir();
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8'));
  const currentVersion = pkg.version;

  // Always ensure bundled assets are present
  copyBundledAssets(configDir);

  // Try to load existing config
  let existingConfig = null;
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      existingConfig = parseJSONC(content);
    } catch (error) {
      // If file is invalid JSONC, we'll create a fresh one
      debugLogToFile(`Config file was invalid (${error.message}), creating fresh config`, configDir);
    }
  }

  // Get default config object with current version
  const defaultConfig = getDefaultConfigObject();
  defaultConfig._configVersion = currentVersion;

  // CASE 1: No existing config - create new file with full documentation
  if (!existingConfig) {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Generate new config file with all documentation comments
      const newConfigContent = generateDefaultConfig({}, currentVersion);
      fs.writeFileSync(filePath, newConfigContent, 'utf-8');

      debugLogToFile(`Initialized default config at ${filePath}`, configDir);

      // Return the default config merged with any passed defaults
      return { ...defaults, ...defaultConfig };
    } catch (error) {
      // If creation fails, return defaults
      return { ...defaults, ...defaultConfig };
    }
  }

  // CASE 2: Existing config - smart merge to add new fields only
  // Find what new fields need to be added (for logging)
  const newFields = findNewFields(defaultConfig, existingConfig);
  
  // Deep merge: user values preserved, only new fields added from defaults
  const mergedConfig = deepMerge(defaultConfig, existingConfig);
  
  // Update version in merged config
  mergedConfig._configVersion = currentVersion;

  // Only write back if there are new fields to add OR version changed
  const versionChanged = existingConfig._configVersion !== currentVersion;
  
  if (newFields.length > 0 || versionChanged) {
    try {
      // Regenerate the config file with full documentation comments
      // Pass the merged config so user values are preserved in the output
      const newConfigContent = generateDefaultConfig(mergedConfig, currentVersion);
      fs.writeFileSync(filePath, newConfigContent, 'utf-8');

      if (newFields.length > 0) {
        debugLogToFile(`Added ${newFields.length} new config field(s): ${newFields.join(', ')}`, configDir);
      }
      if (versionChanged) {
        debugLogToFile(`Config version updated to ${currentVersion}`, configDir);
      }
    } catch (error) {
      // If write fails, still return the merged config (just won't persist new fields)
      debugLogToFile(`Warning: Could not update config file: ${error.message}`, configDir);
    }
  }

  return { ...defaults, ...mergedConfig };
};
