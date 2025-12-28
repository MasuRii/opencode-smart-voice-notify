# OpenCode Smart Voice Notify

> **Disclaimer**: This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://opencode.ai) in any way. It is an independent community plugin.

A smart voice notification plugin for [OpenCode](https://opencode.ai) with **multiple TTS engines** and an intelligent reminder system.

## Features

### Smart TTS Engine Selection
The plugin automatically tries multiple TTS engines in order, falling back if one fails:

1. **ElevenLabs** (Online) - High-quality, anime-like voices with natural expression
2. **Edge TTS** (Free) - Microsoft's neural voices, no API key required
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

### System Integration
- Wake monitor from sleep before notifying
- Auto-boost volume if too low
- TUI toast notifications
- Cross-platform support (Windows, macOS, Linux)

## Installation

### Option 1: From npm (Recommended)

Add to your OpenCode config file (`~/.config/opencode/config.json`):

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
    // NOTIFICATION MODE SETTINGS
    // ============================================================
    // 'sound-first' - Play sound immediately, TTS reminder after delay (RECOMMENDED)
    // 'tts-first'   - Speak TTS immediately
    // 'both'        - Play sound AND speak TTS immediately
    // 'sound-only'  - Only play sound, no TTS
    "notificationMode": "sound-first",
    
    // ============================================================
    // TTS ENGINE SELECTION
    // ============================================================
    // 'elevenlabs' - Best quality (requires API key)
    // 'edge'       - Free neural voices (requires: pip install edge-tts)
    // 'sapi'       - Windows built-in (free, offline)
    "ttsEngine": "elevenlabs",
    "enableTTS": true,
    
    // ============================================================
    // ELEVENLABS SETTINGS
    // ============================================================
    // Get your API key from: https://elevenlabs.io/app/settings/api-keys
    "elevenLabsApiKey": "your-api-key-here",
    "elevenLabsVoiceId": "cgSgspJ2msm6clMCkdW9",  // Jessica voice
    "elevenLabsModel": "eleven_turbo_v2_5",
    
    // ============================================================
    // TTS REMINDER SETTINGS
    // ============================================================
    "enableTTSReminder": true,
    "idleReminderDelaySeconds": 30,
    "permissionReminderDelaySeconds": 20,
    "enableFollowUpReminders": true,
    "maxFollowUpReminders": 3,
    
    // ============================================================
    // SOUND FILES (relative to OpenCode config directory)
    // ============================================================
    "idleSound": "assets/Soft-high-tech-notification-sound-effect.mp3",
    "permissionSound": "assets/Machine-alert-beep-sound-effect.mp3"
}
```

See `example.config.jsonc` for the full configuration options.

## Requirements

### For ElevenLabs TTS
- ElevenLabs API key (free tier: 10,000 characters/month)
- Internet connection

### For Edge TTS
- Python with `edge-tts` package:
  ```bash
  pip install edge-tts
  ```

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
