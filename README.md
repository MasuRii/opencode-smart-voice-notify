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
- **Permission Batching**: Multiple simultaneous permission requests are batched into a single notification (e.g., "5 permission requests require your attention")
- **Question Tool Support** (SDK v1.1.7+): Notifies when the agent asks questions and needs user input

### AI-Generated Messages (Experimental)
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
    // OpenCode Smart Voice Notify - Full Configuration Reference
    // ============================================================
    // 
    // IMPORTANT: This is a REFERENCE file showing ALL available options.
    // 
    // To use this plugin:
    // 1. Copy this file to: ~/.config/opencode/smart-voice-notify.jsonc
    //    (On Windows: C:\Users\<YourUser>\.config\opencode\smart-voice-notify.jsonc)
    // 2. Customize the settings below to your preference
    // 3. The plugin auto-creates a minimal config if none exists
    //
    // Sound files are automatically copied to ~/.config/opencode/assets/
    // on first run. You can also use your own custom sound files.
    //
    // ============================================================

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
    // Set globally or per-notification type
    "ttsReminderDelaySeconds": 30,         // Global default
    "idleReminderDelaySeconds": 30,        // For task completion notifications
    "permissionReminderDelaySeconds": 20,  // For permission requests (more urgent)
    
    // Follow-up reminders if user STILL doesn't respond after first TTS
    "enableFollowUpReminders": true,
    "maxFollowUpReminders": 3,              // Max number of follow-up TTS reminders
    "reminderBackoffMultiplier": 1.5,       // Each follow-up waits longer (30s, 45s, 67s...)

    // ============================================================
    // PERMISSION BATCHING (Multiple permissions at once)
    // ============================================================
    // When multiple permissions arrive simultaneously (e.g., 5 at once),
    // batch them into a single notification instead of playing 5 overlapping sounds.
    // The notification will say "X permission requests require your attention".
    
    // Batch window (ms) - how long to wait for more permissions before notifying
    "permissionBatchWindowMs": 800,

    // ============================================================
    // TTS ENGINE SELECTION
    // ============================================================
    // 'elevenlabs' - Best quality, anime-like voices (requires API key, free tier: 10k chars/month)
    // 'edge'       - Good quality neural voices (Free, Native Node.js implementation)
    // 'sapi'       - Windows built-in voices (free, offline, robotic)
    "ttsEngine": "elevenlabs",
    
    // Enable TTS for notifications (falls back to sound files if TTS fails)
    "enableTTS": true,
    
    // ============================================================
    // ELEVENLABS SETTINGS (Best Quality - Anime-like Voices)
    // ============================================================
    // Get your API key from: https://elevenlabs.io/app/settings/api-keys
    // Free tier: 10,000 characters/month
    "elevenLabsApiKey": "YOUR_API_KEY_HERE",
    
    // Voice ID - Recommended cute/anime-like voices:
    //   'cgSgspJ2msm6clMCkdW9' - Jessica (Playful, Bright, Warm) - RECOMMENDED
    //   'FGY2WhTYpPnrIDTdsKH5' - Laura (Enthusiast, Quirky)
    //   'jsCqWAovK2LkecY7zXl4' - Freya (Expressive, Confident)
    //   'EXAVITQu4vr4xnSDxMaL' - Sarah (Soft, Warm)
    // Browse more at: https://elevenlabs.io/voice-library
    "elevenLabsVoiceId": "cgSgspJ2msm6clMCkdW9",
    
    // Model: 'eleven_turbo_v2_5' (fast, good), 'eleven_multilingual_v2' (highest quality)
    "elevenLabsModel": "eleven_turbo_v2_5",
    
    // Voice tuning (0.0 to 1.0)
    "elevenLabsStability": 0.5,       // Lower = more expressive, Higher = more consistent
    "elevenLabsSimilarity": 0.75,     // How closely to match the original voice
    "elevenLabsStyle": 0.5,           // Style exaggeration (higher = more expressive)
    
    // ============================================================
    // EDGE TTS SETTINGS (Free Neural Voices - Fallback)
    // ============================================================
    // Native Node.js implementation (No external dependencies)
    
    // Voice options (run 'edge-tts --list-voices' to see all):
    //   'en-US-AnaNeural'   - Young, cute, cartoon-like (RECOMMENDED)
    //   'en-US-JennyNeural' - Friendly, warm
    //   'en-US-AriaNeural'  - Confident, clear
    //   'en-GB-SoniaNeural' - British, friendly
    //   'en-AU-NatashaNeural' - Australian, warm
    "edgeVoice": "en-US-AnaNeural",
    
    // Pitch adjustment: +0Hz to +100Hz (higher = more anime-like)
    "edgePitch": "+50Hz",
    
    // Speech rate: -50% to +100%
    "edgeRate": "+10%",
    
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
    "sapiVoice": "Microsoft Zira Desktop",
    
    // Speech rate: -10 (slowest) to +10 (fastest), 0 is normal
    "sapiRate": -1,
    
    // Pitch: 'x-low', 'low', 'medium', 'high', 'x-high'
    "sapiPitch": "medium",
    
    // Volume: 'silent', 'x-soft', 'soft', 'medium', 'loud', 'x-loud'
    "sapiVolume": "loud",
    
    // ============================================================
    // INITIAL TTS MESSAGES (Used immediately or after sound)
    // These are randomly selected each time for variety
    // ============================================================
    
    // Messages when agent finishes work (task completion)
    "idleTTSMessages": [
        "All done! Your task has been completed successfully.",
        "Hey there! I finished working on your request.",
        "Task complete! Ready for your review whenever you are.",
        "Good news! Everything is done and ready for you.",
        "Finished! Let me know if you need anything else."
    ],
    
    // Messages for permission requests
    "permissionTTSMessages": [
        "Attention please! I need your permission to continue.",
        "Hey! Quick approval needed to proceed with the task.",
        "Heads up! There is a permission request waiting for you.",
        "Excuse me! I need your authorization before I can continue.",
        "Permission required! Please review and approve when ready."
    ],
    
    // Messages for MULTIPLE permission requests (use {count} placeholder)
    // Used when several permissions arrive simultaneously
    "permissionTTSMessagesMultiple": [
        "Attention please! There are {count} permission requests waiting for your approval.",
        "Hey! {count} permissions need your approval to continue.",
        "Heads up! You have {count} pending permission requests.",
        "Excuse me! I need your authorization for {count} different actions.",
        "{count} permissions required! Please review and approve when ready."
    ],

    // ============================================================
    // TTS REMINDER MESSAGES (More urgent - used after delay if no response)
    // These are more personalized and urgent to get user attention
    // ============================================================
    
    // Reminder messages when agent finished but user hasn't responded
    "idleReminderTTSMessages": [
        "Hey, are you still there? Your task has been waiting for review.",
        "Just a gentle reminder - I finished your request a while ago!",
        "Hello? I completed your task. Please take a look when you can.",
        "Still waiting for you! The work is done and ready for review.",
        "Knock knock! Your completed task is patiently waiting for you."
    ],
    
    // Reminder messages when permission still needed
    "permissionReminderTTSMessages": [
        "Hey! I still need your permission to continue. Please respond!",
        "Reminder: There is a pending permission request. I cannot proceed without you.",
        "Hello? I am waiting for your approval. This is getting urgent!",
        "Please check your screen! I really need your permission to move forward.",
        "Still waiting for authorization! The task is on hold until you respond."
    ],
    
    // Reminder messages for MULTIPLE permissions (use {count} placeholder)
    "permissionReminderTTSMessagesMultiple": [
        "Hey! I still need your approval for {count} permissions. Please respond!",
        "Reminder: There are {count} pending permission requests. I cannot proceed without you.",
        "Hello? I am waiting for your approval on {count} items. This is getting urgent!",
        "Please check your screen! {count} permissions are waiting for your response.",
        "Still waiting for authorization on {count} requests! The task is on hold."
    ],
    
    // ============================================================
    // QUESTION TOOL MESSAGES (SDK v1.1.7+ - Agent asking user questions)
    // ============================================================
    // The "question" tool allows the LLM to ask users questions during execution.
    // This is useful for gathering preferences, clarifying instructions, or getting
    // decisions on implementation choices.
    
    // Messages when agent asks user a question
    "questionTTSMessages": [
        "Hey! I have a question for you. Please check your screen.",
        "Attention! I need your input to continue.",
        "Quick question! Please take a look when you have a moment.",
        "I need some clarification. Could you please respond?",
        "Question time! Your input is needed to proceed."
    ],
    
    // Messages for MULTIPLE questions (use {count} placeholder)
    "questionTTSMessagesMultiple": [
        "Hey! I have {count} questions for you. Please check your screen.",
        "Attention! I need your input on {count} items to continue.",
        "{count} questions need your attention. Please take a look!",
        "I need some clarifications. There are {count} questions waiting for you.",
        "Question time! {count} questions need your response to proceed."
    ],
    
    // Reminder messages for questions (more urgent - used after delay)
    "questionReminderTTSMessages": [
        "Hey! I am still waiting for your answer. Please check the questions!",
        "Reminder: There is a question waiting for your response.",
        "Hello? I need your input to continue. Please respond when you can.",
        "Still waiting for your answer! The task is on hold.",
        "Your input is needed! Please check the pending question."
    ],
    
    // Reminder messages for MULTIPLE questions (use {count} placeholder)
    "questionReminderTTSMessagesMultiple": [
        "Hey! I am still waiting for answers to {count} questions. Please respond!",
        "Reminder: There are {count} questions waiting for your response.",
        "Hello? I need your input on {count} items. Please respond when you can.",
        "Still waiting for your answers on {count} questions! The task is on hold.",
        "Your input is needed! {count} questions are pending your response."
    ],
    
    // Delay (in seconds) before question reminder fires
    "questionReminderDelaySeconds": 25,
    
    // Question batch window (ms) - how long to wait for more questions before notifying
    "questionBatchWindowMs": 800,
    
    // ============================================================
    // SOUND FILES (For immediate notifications)
    // These are played first before TTS reminder kicks in
    // ============================================================
    // Paths are relative to ~/.config/opencode/ directory
    // The plugin automatically copies bundled sounds to assets/ on first run
    // You can replace with your own custom MP3/WAV files
    
    "idleSound": "assets/Soft-high-tech-notification-sound-effect.mp3",
    "permissionSound": "assets/Machine-alert-beep-sound-effect.mp3",
    "questionSound": "assets/Machine-alert-beep-sound-effect.mp3",
    
    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    
    // Wake monitor from sleep when notifying (Windows/macOS)
    "wakeMonitor": true,
    
    // Force system volume up if below threshold
    "forceVolume": true,
    
    // Volume threshold (0-100): force volume if current level is below this
    "volumeThreshold": 50,
    
    // Show TUI toast notifications in OpenCode terminal
    "enableToast": true,
    
    // Enable audio notifications (sound files and TTS)
    "enableSound": true,
    
    // Consider monitor asleep after this many seconds of inactivity (Windows only)
    "idleThresholdSeconds": 60,
    
    // Enable debug logging to ~/.config/opencode/logs/smart-voice-notify-debug.log
    // The logs folder is created automatically when debug logging is enabled
    // Useful for troubleshooting notification issues
    "debugLog": false
}
```

See `example.config.jsonc` for more details.

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
