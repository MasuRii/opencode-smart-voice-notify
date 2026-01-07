import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

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
    // SOUND FILES (For immediate notifications)
    // These are played first before TTS reminder kicks in
    // ============================================================
    // Paths are relative to ~/.config/opencode/ directory
    // Sound files are automatically copied here on first run
    // You can replace with your own custom MP3/WAV files
    
    "idleSound": "${overrides.idleSound || 'assets/Soft-high-tech-notification-sound-effect.mp3'}",
    "permissionSound": "${overrides.permissionSound || 'assets/Machine-alert-beep-sound-effect.mp3'}",
    
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
 * If the file doesn't exist, creates a default config file.
 * Performs version checks and migrates config if necessary.
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

  let existingConfig = null;
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      existingConfig = parseJSONC(content);
    } catch (error) {
      // If file is invalid JSONC, we'll treat it as missing and overwrite
    }
  }

  // Version check and migration logic
  if (!existingConfig || existingConfig._configVersion !== currentVersion) {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Generate new config content using existing values as overrides
      // This preserves user settings while updating comments and adding new fields
      const newConfigContent = generateDefaultConfig(existingConfig || {}, currentVersion);
      fs.writeFileSync(filePath, newConfigContent, 'utf-8');

      // Also ensure all bundled assets (sound files) are present in the config directory
      copyBundledAssets(configDir);

      if (existingConfig) {
        console.log(`[Smart Voice Notify] Config migrated to version ${currentVersion}`);
      } else {
        console.log(`[Smart Voice Notify] Initialized default config at ${filePath}`);
      }

      // Re-parse the newly written config
      existingConfig = parseJSONC(newConfigContent);
    } catch (error) {
      // If migration fails, try to return whatever we have or defaults
      return existingConfig || defaults;
    }
  }

  return { ...defaults, ...existingConfig };
};
