<!-- Dynamic Header -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=120&section=header"/>

# OpenCode Smart Voice Notify

> **Disclaimer**: This project is not built by the OpenCode team and is not affiliated with [OpenCode](https://opencode.ai) in any way. It is an independent community plugin.

A smart voice notification plugin for [OpenCode](https://opencode.ai) with **multiple TTS engines** and an intelligent reminder system.

<img width="1456" height="720" alt="image" src="https://github.com/user-attachments/assets/52ccf357-2548-400b-a346-6362f2fc3180" />


## Features

### Smart TTS Engine Selection
The plugin automatically tries multiple TTS engines in order, falling back if one fails:

1. **OpenAI-Compatible** (Self-hosted) - Any OpenAI-compatible `/v1/audio/speech` endpoint (Kokoro, LocalAI, Coqui, AllTalk, etc.)
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

### OpenAI-Compatible TTS Setup (Kokoro, LocalAI, etc.)

For self-hosted TTS using any OpenAI-compatible `/v1/audio/speech` endpoint:

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

## Requirements

### For OpenAI-Compatible TTS
- Any server implementing the `/v1/audio/speech` endpoint
- Examples: [Kokoro](https://github.com/remsky/Kokoro-FastAPI), [LocalAI](https://localai.io), [AllTalk](https://github.com/erew123/alltalk_tts), OpenAI API
- No API key required for most self-hosted servers

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
