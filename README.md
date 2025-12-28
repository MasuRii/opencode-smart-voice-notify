<!-- Dynamic Header -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=120&section=header"/>

# OpenCode Smart Voice Notify

> **Disclaimer**: This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://opencode.ai) in any way. It is an independent community plugin.

A smart voice notification plugin for [OpenCode](https://opencode.ai) with **multiple TTS engines** and an intelligent reminder system.

<img width="1456" height="720" alt="image" src="https://github.com/user-attachments/assets/52ccf357-2548-400b-a346-6362f2fc3180" />


## Features

### Smart TTS Engine Selection
The plugin automatically tries multiple TTS engines in order, falling back if one fails:

1. **ElevenLabs** (Online) - High-quality, anime-like voices with natural expression
2. **Edge TTS** (Free) - Microsoft's neural voices, native Node.js implementation (no Python required)
3. **Windows SAPI** (Offline) - Built-in Windows speech synthesis
4. **Local Sound Files** (Fallback) - Plays bundled MP3 files if all TTS fails

### Smart Notification System
- **Sound-first mode**: Play a sound immediately, then speak a TTS reminder if user doesn't respond
- **TTS-first mode**: Speak immediately using TTS
- **Both mode**: Play sound AND speak TTS at the same time
- **Sound-only mode**: Just play sounds, no TTS

### Intelligent Reminders
- Delayed TTS reminders if user doesn't respond within configurable time
- Follow-up reminders with exponential backoff
- Automatic cancellation when user responds
- Per-notification type delays (permission requests are more urgent)
- **Smart Quota Handling**: Automatically falls back to free Edge TTS if ElevenLabs quota is exceeded

### System Integration
- **Native Edge TTS**: No external dependencies (Python/pip) required
- Wake monitor from sleep before notifying
- Auto-boost volume if too low
- TUI toast notifications
- Cross-platform support (Windows, macOS, Linux)

## Installation

### Option 1: From npm (Recommended)

Add to your OpenCode config file (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-smart-voice-notify@latest"]
}
```

### Option 2: From GitHub

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:MasuRii/opencode-smart-voice-notify"]
}
```

### Option 3: Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/MasuRii/opencode-smart-voice-notify.git
   ```

2. Reference the local path in your config:
   ```json
   {
     "plugin": ["file:///path/to/opencode-smart-voice-notify"]
   }
   ```

## Configuration

### Automatic Setup

When you first run OpenCode with this plugin installed, it will **automatically create**:

1. **`~/.config/opencode/smart-voice-notify.jsonc`** - A comprehensive configuration file with all available options fully documented.
2. **`~/.config/opencode/assets/*.mp3`** - Bundled notification sound files.

The auto-generated configuration includes all advanced settings, message arrays, and engine options, so you don't have to refer back to the documentation for available settings.

### Manual Configuration

If you prefer to create the config manually, add a `smart-voice-notify.jsonc` file in your OpenCode config directory (`~/.config/opencode/`):

```jsonc
{
    // ============================================================
    // NOTIFICATION MODE SETTINGS (Smart Notification System)
    // ============================================================
    // Controls how notifications are delivered:
    //   'sound-first' - Play sound immediately, TTS reminder after delay (RECOMMENDED)
    //   'tts-first'   - Speak TTS immediately, no sound
    //   'both'        - Play sound AND speak TTS immediately
    //   'sound-only'  - Only play sound, no TTS at all
    "notificationMode": "sound-first",
    
    // ============================================================
    // TTS REMINDER SETTINGS (When user doesn't respond to sound)
    // ============================================================
    
    // Enable TTS reminder if user doesn't respond after sound notification
    "enableTTSReminder": true,
    
    // Delay (in seconds) before TTS reminder fires
    "ttsReminderDelaySeconds": 30,         // Global default
    "idleReminderDelaySeconds": 30,        // For task completion notifications
    "permissionReminderDelaySeconds": 20,  // For permission requests (more urgent)
    
    // Follow-up reminders if user STILL doesn't respond after first TTS
    "enableFollowUpReminders": true,
    "maxFollowUpReminders": 3,              // Max number of follow-up TTS reminders
    "reminderBackoffMultiplier": 1.5,       // Each follow-up waits longer (30s, 45s, 67s...)

    // ============================================================
    // TTS ENGINE SELECTION
    // ============================================================
    // 'elevenlabs' - Best quality, anime-like voices (requires API key)
    // 'edge'       - Good quality neural voices (Free, Native Node.js implementation)
    // 'sapi'       - Windows built-in voices (free, offline)
    "ttsEngine": "edge",
    "enableTTS": true,
    
    // ============================================================
    // ELEVENLABS SETTINGS (Best Quality - Anime-like Voices)
    // ============================================================
    // Get your API key from: https://elevenlabs.io/app/settings/api-keys
    // "elevenLabsApiKey": "YOUR_API_KEY_HERE",
    "elevenLabsVoiceId": "cgSgspJ2msm6clMCkdW9",
    "elevenLabsModel": "eleven_turbo_v2_5",
    "elevenLabsStability": 0.5,
    "elevenLabsSimilarity": 0.75,
    "elevenLabsStyle": 0.5,
    
    // ============================================================
    // EDGE TTS SETTINGS (Free Neural Voices - Default Engine)
    // ============================================================
    "edgeVoice": "en-US-AnaNeural",
    "edgePitch": "+50Hz",
    "edgeRate": "+10%",
    
    // ============================================================
    // SAPI SETTINGS (Windows Built-in - Last Resort Fallback)
    // ============================================================
    "sapiVoice": "Microsoft Zira Desktop",
    "sapiRate": -1,
    "sapiPitch": "medium",
    "sapiVolume": "loud",
    
    // ============================================================
    // INITIAL TTS MESSAGES (Used immediately or after sound)
    // ============================================================
    "idleTTSMessages": [
        "All done! Your task has been completed successfully.",
        "Hey there! I finished working on your request.",
        "Task complete! Ready for your review whenever you are.",
        "Good news! Everything is done and ready for you.",
        "Finished! Let me know if you need anything else."
    ],
    "permissionTTSMessages": [
        "Attention please! I need your permission to continue.",
        "Hey! Quick approval needed to proceed with the task.",
        "Heads up! There is a permission request waiting for you.",
        "Excuse me! I need your authorization before I can continue.",
        "Permission required! Please review and approve when ready."
    ],

    // ============================================================
    // TTS REMINDER MESSAGES (Used after delay if no response)
    // ============================================================
    "idleReminderTTSMessages": [
        "Hey, are you still there? Your task has been waiting for review.",
        "Just a gentle reminder - I finished your request a while ago!",
        "Hello? I completed your task. Please take a look when you can.",
        "Still waiting for you! The work is done and ready for review.",
        "Knock knock! Your completed task is patiently waiting for you."
    ],
    "permissionReminderTTSMessages": [
        "Hey! I still need your permission to continue. Please respond!",
        "Reminder: There is a pending permission request. I cannot proceed without you.",
        "Hello? I am waiting for your approval. This is getting urgent!",
        "Please check your screen! I really need your permission to move forward.",
        "Still waiting for authorization! The task is on hold until you respond."
    ],
    
    // ============================================================
    // SOUND FILES (relative to OpenCode config directory)
    // ============================================================
    "idleSound": "assets/Soft-high-tech-notification-sound-effect.mp3",
    "permissionSound": "assets/Machine-alert-beep-sound-effect.mp3",
    
    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    "wakeMonitor": true,
    "forceVolume": true,
    "volumeThreshold": 50,
    "enableToast": true,
    "enableSound": true,
    "idleThresholdSeconds": 60,
    "debugLog": false
}
```

See `example.config.jsonc` for more details.

## Requirements

### For ElevenLabs TTS
- ElevenLabs API key (free tier: 10,000 characters/month)
- Internet connection

### For Edge TTS
- Internet connection (No external dependencies required)

### For Windows SAPI
- Windows OS (uses built-in System.Speech)

### For Sound Playback
- **Windows**: Built-in (uses Windows Media Player)
- **macOS**: Built-in (`afplay`)
- **Linux**: `paplay` or `aplay`

## Events Handled

| Event | Action |
|-------|--------|
| `session.idle` | Agent finished working - notify user |
| `permission.updated` | Permission request - alert user |
| `permission.replied` | User responded - cancel pending reminders |
| `message.updated` | New user message - cancel pending reminders |
| `session.created` | New session - reset state |

## Development

To develop on this plugin locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/MasuRii/opencode-smart-voice-notify.git
   cd opencode-smart-voice-notify
   bun install  # or npm install
   ```

2. Link to your OpenCode config:
   ```json
   {
     "plugin": ["file:///absolute/path/to/opencode-smart-voice-notify"]
   }
   ```

## Updating

OpenCode does not automatically update plugins. To update to the latest version:

```bash
# Clear the cached plugin
rm -rf ~/.cache/opencode/node_modules/opencode-smart-voice-notify

# Run OpenCode to trigger a fresh install
opencode
```

## License

MIT

## Support

- Open an issue on [GitHub](https://github.com/MasuRii/opencode-smart-voice-notify/issues)
- Check the [OpenCode docs](https://opencode.ai/docs/plugins)

<!-- Dynamic Header -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=120&section=header"/>
