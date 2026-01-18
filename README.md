<!-- Dynamic Header -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=120&section=header"/>

# OpenCode Smart Voice Notify

[![Test](https://github.com/MasuRii/opencode-smart-voice-notify/actions/workflows/test.yml/badge.svg)](https://github.com/MasuRii/opencode-smart-voice-notify/actions/workflows/test.yml)
![Coverage](https://img.shields.io/badge/coverage-86.73%25-brightgreen)
![Version](https://img.shields.io/badge/version-1.2.5-blue)
![License](https://img.shields.io/badge/license-MIT-green)


> **Disclaimer**: This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://opencode.ai) in any way. It is an independent community plugin.

A smart voice notification plugin for [OpenCode](https://opencode.ai) with **multiple TTS engines** and an intelligent reminder system.

<img width="1456" height="720" alt="image" src="https://github.com/user-attachments/assets/52ccf357-2548-400b-a346-6362f2fc3180" />


## Features

### Smart TTS Engine Selection
The plugin automatically tries multiple TTS engines in order, falling back if one fails:

1. **OpenAI-Compatible** (Cloud/Self-hosted) - Any OpenAI-compatible `/v1/audio/speech` endpoint (Kokoro, LocalAI, Coqui, AllTalk, OpenAI API, etc.)
2. **ElevenLabs** (Online) - High-quality, anime-like voices with natural expression
3. **Edge TTS** (Free) - Microsoft's neural voices, native Node.js implementation (no Python required)
4. **Windows SAPI** (Offline) - Built-in Windows speech synthesis
5. **Local Sound Files** (Fallback) - Plays bundled MP3 files if all TTS fails

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
- **Permission Batching**: Multiple simultaneous permission requests are batched into a single notification (e.g., "5 permission requests require your attention")
- **Question Tool Support** (SDK v1.1.7+): Notifies when the agent asks questions and needs user input

### AI-Generated Messages
- **Dynamic notifications**: Use a local AI to generate unique, contextual messages instead of preset static ones
- **OpenAI-compatible**: Works with Ollama, LM Studio, LocalAI, vLLM, llama.cpp, Jan.ai, or any OpenAI-compatible endpoint
- **User-hosted**: You provide your own AI endpoint - no cloud API keys required
- **Custom prompts**: Configure prompts per notification type for full control over AI personality
- **Smart fallback**: Automatically falls back to static messages if AI is unavailable

### System Integration
- **Native Edge TTS**: No external dependencies (Python/pip) required
- Wake monitor from sleep before notifying
- Auto-boost volume if too low
- TUI toast notifications
- Cross-platform support (Windows, macOS, Linux)
- **Focus Detection** (macOS): Suppresses notifications when terminal is focused
- **Webhook Integration**: Receive notifications on Discord or any custom webhook endpoint when tasks finish or need attention
- **Themed Sound Packs**: Use custom sound collections (e.g., Warcraft, StarCraft) by simply pointing to a directory

## Installation

### Option 1: From npm/Bun (Recommended)

Add to your OpenCode config file (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-smart-voice-notify@latest"]
}
```

> **Note**: OpenCode will automatically install the plugin using your system's package manager (npm or bun).

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
3. **`~/.config/opencode/logs/`** - Debug log folder (created when debug logging is enabled).

The auto-generated configuration includes all advanced settings, message arrays, and engine options, so you don't have to refer back to the documentation for available settings.

### Manual Configuration

If you prefer to create the config manually, add a `smart-voice-notify.jsonc` file in your OpenCode config directory (`~/.config/opencode/`):

```jsonc
{
    // ============================================================
    // OpenCode Smart Voice Notify - Quick Start Configuration
    // ============================================================
    // For ALL available options, see example.config.jsonc in the plugin.
    // The plugin auto-creates a comprehensive config on first run.
    // ============================================================

    // Master switch to enable/disable the plugin without uninstalling
    "enabled": true,

    // Notification mode: 'sound-first', 'tts-first', 'both', 'sound-only'
    "notificationMode": "sound-first",
    
    // TTS engine: 'openai', 'elevenlabs', 'edge', 'sapi'
    "ttsEngine": "openai",
    "enableTTS": true,
    
    // ElevenLabs settings (get API key from https://elevenlabs.io/app/settings/api-keys)
    "elevenLabsApiKey": "YOUR_API_KEY_HERE",
    "elevenLabsVoiceId": "cgSgspJ2msm6clMCkdW9",  // Jessica - Playful, Bright
    
    // OpenAI-compatible TTS (Kokoro, LocalAI, OpenAI, Coqui, AllTalk, etc.)
    "openaiTtsEndpoint": "http://localhost:8880",
    "openaiTtsVoice": "af_heart",
    "openaiTtsModel": "kokoro",
    
    // Edge TTS settings (free, no API key required)
    "edgeVoice": "en-US-AnaNeural",
    "edgePitch": "+50Hz",
    "edgeRate": "+10%",
    
    // TTS reminder settings
    "enableTTSReminder": true,
    "ttsReminderDelaySeconds": 30,
    "enableFollowUpReminders": true,
    "maxFollowUpReminders": 3,
    
    // AI-generated messages (optional - requires local AI server)
    "enableAIMessages": false,
    "aiEndpoint": "http://localhost:11434/v1",
    "aiModel": "llama3",
    "aiApiKey": "",
    "aiFallbackToStatic": true,
    
    // Webhook settings (optional - works with Discord)
    "enableWebhook": false,
    "webhookUrl": "",
    "webhookUsername": "OpenCode Notify",
    "webhookMentionOnPermission": false,
    
    // Sound theme settings (optional)
    "soundThemeDir": "", // Path to custom sound theme directory
    "randomizeSoundFromTheme": true, // Pick random sound from theme subfolders
    
    // General settings

    "wakeMonitor": true,
    "forceVolume": true,
    "volumeThreshold": 50,
    "enableToast": true,
    "enableSound": true,
    "debugLog": false
}
```

For the complete configuration with all TTS engine settings, message arrays, AI prompts, and advanced options, see [`example.config.jsonc`](./example.config.jsonc) in the plugin directory.

### OpenAI-Compatible TTS Setup (Kokoro, LocalAI, OpenAI API, etc.)

For cloud-based or self-hosted TTS using any OpenAI-compatible `/v1/audio/speech` endpoint:

```jsonc
{
  "ttsEngine": "openai",
  "openaiTtsEndpoint": "http://192.168.86.43:8880",  // Your TTS server
  "openaiTtsVoice": "af_heart",                      // Server-dependent
  "openaiTtsModel": "kokoro",                        // Server-dependent
  "openaiTtsApiKey": "",                             // Optional, if server requires auth
  "openaiTtsSpeed": 1.0                              // 0.25 to 4.0
}
```

**Supported OpenAI-Compatible TTS Servers:**
| Server | Example Endpoint | Voices |
|--------|------------------|--------|
| Kokoro | `http://localhost:8880` | `af_heart`, `af_bella`, `am_adam`, etc. |
| LocalAI | `http://localhost:8080` | Model-dependent |
| AllTalk | `http://localhost:7851` | Model-dependent |
| OpenAI | `https://api.openai.com` | `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |
| Coqui | `http://localhost:5002` | Model-dependent |

### AI Message Generation (Optional)

If you want dynamic, AI-generated notification messages instead of preset ones, you can connect to a local AI server:

1. **Install a local AI server** (e.g., [Ollama](https://ollama.ai)):
   ```bash
   # Install Ollama and pull a model
   ollama pull llama3
   ```

2. **Enable AI messages in your config**:
   ```jsonc
   {
     "enableAIMessages": true,
     "aiEndpoint": "http://localhost:11434/v1",
     "aiModel": "llama3",
     "aiApiKey": "",
     "aiFallbackToStatic": true
   }
   ```

3. **The AI will generate unique messages** for each notification, which are then spoken by your TTS engine.

**Supported AI Servers:**
| Server | Default Endpoint | API Key |
|--------|-----------------|---------|
| Ollama | `http://localhost:11434/v1` | Not needed |
| LM Studio | `http://localhost:1234/v1` | Not needed |
| LocalAI | `http://localhost:8080/v1` | Not needed |
| vLLM | `http://localhost:8000/v1` | Use "EMPTY" |
| Jan.ai | `http://localhost:1337/v1` | Required |

### Discord / Webhook Integration (Optional)

Receive remote notifications on Discord or any custom endpoint. This is perfect for long-running tasks when you're away from your computer.

1. **Create a Discord Webhook**:
   - In Discord, go to **Server Settings** > **Integrations** > **Webhooks**.
   - Click **New Webhook**, choose a channel, and click **Copy Webhook URL**.

2. **Enable Webhooks in your config**:
   ```jsonc
   {
     "enableWebhook": true,
     "webhookUrl": "https://discord.com/api/webhooks/...",
     "webhookUsername": "OpenCode Notify",
     "webhookEvents": ["idle", "permission", "error", "question"],
     "webhookMentionOnPermission": true
   }
   ```

3. **Features**:
   - **Color-coded Embeds**: Different colors for task completion (green), permissions (orange), errors (red), and questions (blue).
   - **Smart Mentions**: Automatically @everyone on Discord for urgent permission requests.
   - **Rate Limiting**: Intelligent retry logic with backoff if Discord's rate limits are hit.
    - **Fire-and-forget**: Webhook requests never block local sound or TTS playback.

**Supported Webhook Events:**
| Event | Trigger |
|-------|---------|
| `idle` | Agent finished working |
| `permission` | Agent needs permission for a tool |
| `error` | Agent encountered an error |
| `question` | Agent is asking you a question |


### Custom Sound Themes (Optional)

You can replace individual sound files with entire "Sound Themes" (like the classic Warcraft II or StarCraft sound packs).

1. **Set up your theme directory**:
   Create a folder (e.g., `~/.config/opencode/themes/warcraft2/`) with the following structure:
   ```text
   warcraft2/
   ├── idle/          # Sounds for when the agent finishes
   │   ├── job_done.mp3
   │   └── alright.wav
   ├── permission/    # Sounds for permission requests
   │   ├── help.mp3
   │   └── need_orders.wav
   ├── error/         # Sounds for agent errors
   │   └── alert.mp3
   └── question/      # Sounds for agent questions
       └── yes_milord.mp3
   ```

2. **Configure the theme in your config**:
   ```jsonc
   {
     "soundThemeDir": "themes/warcraft2",
     "randomizeSoundFromTheme": true
   }
   ```

3. **Features**:
   - **Automatic Fallback**: If a theme subdirectory or sound is missing, the plugin automatically falls back to your default sound files.
   - **Randomization**: If multiple sounds are in a subdirectory, the plugin will pick one at random each time (if `randomizeSoundFromTheme` is `true`).
   - **Relative Paths**: Paths are relative to your OpenCode config directory (`~/.config/opencode/`).


## Requirements


### For OpenAI-Compatible TTS
- Any server implementing the `/v1/audio/speech` endpoint
- Examples: [Kokoro](https://github.com/remsky/Kokoro-FastAPI), [LocalAI](https://localai.io), [AllTalk](https://github.com/erew123/alltalk_tts), OpenAI API, etc.
- Works with both local self-hosted servers and cloud-based providers.

### For ElevenLabs TTS
- ElevenLabs API key (free tier: 10,000 characters/month)
- Internet connection

### For Edge TTS
- Internet connection (No external dependencies required)

### For Windows SAPI
- Windows OS (uses built-in System.Speech)

### For Desktop Notifications
- **Windows**: Built-in (uses Toast notifications)
- **macOS**: Built-in (uses Notification Center)
- **Linux**: Requires `notify-send` (libnotify)
  ```bash
  # Ubuntu/Debian
  sudo apt install libnotify-bin

  # Fedora
  sudo dnf install libnotify

  # Arch Linux
  sudo pacman -S libnotify
  ```

### For Sound Playback
- **Windows**: Built-in (uses Windows Media Player)
- **macOS**: Built-in (`afplay`)
- **Linux**: `paplay` or `aplay`

### For Focus Detection
Focus detection suppresses sound and desktop notifications when the terminal is focused.

| Platform | Support | Notes |
|----------|---------|-------|
| **macOS** | ✅ Full | Uses AppleScript to detect frontmost application |
| **Windows** | ❌ Not supported | No reliable API available |
| **Linux** | ❌ Not supported | Varies by desktop environment |

> **Note**: On unsupported platforms, notifications are always sent (fail-open behavior). TTS reminders are never suppressed, even when focused, since users may step away after seeing the toast.

### For Webhook Notifications
- **Discord**: Full support for Discord's webhook embed format.
- **Generic**: Works with any endpoint that accepts a POST request with a JSON body (though formatting is optimized for Discord).
- **Rate Limits**: The plugin handles HTTP 429 (Too Many Requests) automatically with retries and a 250ms queue delay.

## Events Handled

| Event | Action |
|-------|--------|
| `session.idle` | Agent finished working - notify user |
| `session.error` | Agent encountered an error - alert user |
| `permission.asked` | Permission request (SDK v1.1.1+) - alert user |

| `permission.updated` | Permission request (SDK v1.0.x) - alert user |
| `permission.replied` | User responded - cancel pending reminders |
| `question.asked` | Agent asks question (SDK v1.1.7+) - notify user |
| `question.replied` | User answered question - cancel pending reminders |
| `question.rejected` | User dismissed question - cancel pending reminders |
| `message.updated` | New user message - cancel pending reminders |
| `session.created` | New session - reset state |

> **Note**: The plugin supports OpenCode SDK v1.0.x, v1.1.x, and v1.1.7+ for backward compatibility.

## Development

To develop on this plugin locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/MasuRii/opencode-smart-voice-notify.git
   cd opencode-smart-voice-notify
   ```

2. Install dependencies:
   ```bash
   # Using Bun (recommended)
   bun install

   # Or using npm
   npm install
   ```

3. Link to your OpenCode config:
   ```json
   {
     "plugin": ["file:///absolute/path/to/opencode-smart-voice-notify"]
   }
   ```

### Testing

The plugin uses [Bun](https://bun.sh)'s built-in test runner for unit and E2E tests.

```bash
# Run all tests
bun test

# Run tests with coverage
bun test --coverage

# Run tests in watch mode
bun test --watch
```

For more detailed testing guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md) (coming soon).

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
