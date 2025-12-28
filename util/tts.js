import path from 'path';
import os from 'os';
import fs from 'fs';
import { loadConfig } from './config.js';

const platform = os.platform();
const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

/**
 * Loads the TTS configuration (shared with the notification plugin)
 * @returns {object}
 */
export const getTTSConfig = () => {
  return loadConfig('smart-voice-notify', {
    ttsEngine: 'elevenlabs',
    enableTTS: true,
    elevenLabsApiKey: '',
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
    
    // ============================================================
    // NOTIFICATION MODE & TTS REMINDER SETTINGS
    // ============================================================
    // 'sound-first' - Play sound immediately, TTS reminder after delay (default)
    // 'tts-first'   - Speak TTS immediately, no sound
    // 'both'        - Play sound AND speak TTS immediately
    // 'sound-only'  - Only play sound, no TTS at all
    notificationMode: 'sound-first',
    
    // Enable TTS reminder if user doesn't respond after sound notification
    enableTTSReminder: true,
    
    // Delay in seconds before TTS reminder (if user hasn't responded)
    // Can be set globally or per-notification type
    ttsReminderDelaySeconds: 30,
    idleReminderDelaySeconds: 30,
    permissionReminderDelaySeconds: 20,
    
    // Follow-up reminders (if user still doesn't respond after first TTS)
    enableFollowUpReminders: true,
    maxFollowUpReminders: 3,
    reminderBackoffMultiplier: 1.5,  // Each follow-up waits longer (30s, 45s, 67.5s)
    
    // ============================================================
    // TTS MESSAGE VARIETY (Initial notifications - randomly selected)
    // ============================================================
    // Messages when agent finishes work
    idleTTSMessages: [
      'All done! Your task has been completed successfully.',
      'Hey there! I finished working on your request.',
      'Task complete! Ready for your review whenever you are.',
      'Good news! Everything is done and ready for you.',
      'Finished! Let me know if you need anything else.'
    ],
    // Messages for permission requests
    permissionTTSMessages: [
      'Attention please! I need your permission to continue.',
      'Hey! Quick approval needed to proceed with the task.',
      'Heads up! There is a permission request waiting for you.',
      'Excuse me! I need your authorization before I can continue.',
      'Permission required! Please review and approve when ready.'
    ],
    
    // ============================================================
    // TTS REMINDER MESSAGES (More urgent/personalized - used after delay)
    // ============================================================
    // Reminder messages when agent finished but user hasn't responded
    idleReminderTTSMessages: [
      'Hey, are you still there? Your task has been waiting for review.',
      'Just a gentle reminder - I finished your request a while ago!',
      'Hello? I completed your task. Please take a look when you can.',
      'Still waiting for you! The work is done and ready for review.',
      'Knock knock! Your completed task is patiently waiting for you.'
    ],
    // Reminder messages when permission still needed
    permissionReminderTTSMessages: [
      'Hey! I still need your permission to continue. Please respond!',
      'Reminder: There is a pending permission request. I cannot proceed without you.',
      'Hello? I am waiting for your approval. This is getting urgent!',
      'Please check your screen! I really need your permission to move forward.',
      'Still waiting for authorization! The task is on hold until you respond.'
    ],
    
    // ============================================================
    // SOUND FILES (Used for immediate notifications)
    // ============================================================
    idleSound: 'assets/Soft-high-tech-notification-sound-effect.mp3',
    permissionSound: 'assets/Machine-alert-beep-sound-effect.mp3',
    
    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    wakeMonitor: true,
    forceVolume: true,
    enableSound: true,
    enableToast: true,
    volumeThreshold: 50,
    idleThresholdSeconds: 60,
    debugLog: false
  });
};

let elevenLabsQuotaExceeded = false;

/**
 * Creates a TTS utility instance
 * @param {object} params - { $, client }
 * @returns {object} TTS API
 */
export const createTTS = ({ $, client }) => {
  const config = getTTSConfig();
  const logFile = path.join(configDir, 'smart-voice-notify-debug.log');

  const showToast = async (message, variant = 'info') => {
    if (!config.enableToast) return;
    try {
      if (typeof client?.tui?.showToast === 'function') {
        await client.tui.showToast({
          body: {
            message: message,
            variant: variant,
            duration: 6000
          }
        });
      }
    } catch (e) {}
  };

  const debugLog = (message) => {
    if (!config.debugLog) return;
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (e) {}
  };

  /**
   * Play an audio file using system media player
   */
  const playAudioFile = async (filePath, loops = 1) => {
    if (!$) {
      debugLog('playAudioFile: shell runner ($) not available');
      return;
    }
    try {
      if (platform === 'win32') {
        const cmd = `
          Add-Type -AssemblyName presentationCore
          $player = New-Object System.Windows.Media.MediaPlayer
          $player.Volume = 1.0
          for ($i = 0; $i -lt ${loops}; $i++) {
            $player.Open([Uri]::new('${filePath.replace(/\\/g, '\\\\')}'))
            $player.Play()
            Start-Sleep -Milliseconds 500
            while ($player.Position -lt $player.NaturalDuration.TimeSpan -and $player.HasAudio) {
              Start-Sleep -Milliseconds 100
            }
          }
          $player.Close()
        `;
        await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      } else if (platform === 'darwin') {
        for (let i = 0; i < loops; i++) {
          await $`afplay ${filePath}`.quiet();
        }
      } else {
        for (let i = 0; i < loops; i++) {
          try {
            await $`paplay ${filePath}`.quiet();
          } catch {
            await $`aplay ${filePath}`.quiet();
          }
        }
      }
    } catch (e) {
      debugLog(`playAudioFile error: ${e.message}`);
    }
  };

  /**
   * ElevenLabs Engine (Online, High Quality, Anime-like voices)
   */
  const speakWithElevenLabs = async (text) => {
    if (elevenLabsQuotaExceeded) return false;

    if (!config.elevenLabsApiKey) {
      debugLog('speakWithElevenLabs: No API key configured');
      return false;
    }

    try {
      const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
      const elClient = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
      
      const audio = await elClient.textToSpeech.convert(config.elevenLabsVoiceId || 'cgSgspJ2msm6clMCkdW9', {
        text: text,
        model_id: config.elevenLabsModel || 'eleven_turbo_v2_5',
        voice_settings: {
          stability: config.elevenLabsStability ?? 0.5,
          similarity_boost: config.elevenLabsSimilarity ?? 0.75,
          style: config.elevenLabsStyle ?? 0.5,
          use_speaker_boost: true
        }
      });
      
      const tempFile = path.join(os.tmpdir(), `opencode-tts-${Date.now()}.mp3`);
      const chunks = [];
      for await (const chunk of audio) { chunks.push(chunk); }
      fs.writeFileSync(tempFile, Buffer.concat(chunks));
      
      await playAudioFile(tempFile);
      try { fs.unlinkSync(tempFile); } catch (e) {}
      return true;
    } catch (e) {
      debugLog(`speakWithElevenLabs error: ${e.message}`);
      
      // Handle quota exceeded (401 specifically, or specific error message)
      const isQuotaError = 
        e.statusCode === 401 || 
        e.message?.includes('401') || 
        e.message?.toLowerCase().includes('quota_exceeded') || 
        e.message?.toLowerCase().includes('quota exceeded');

      if (isQuotaError) {
        elevenLabsQuotaExceeded = true;
        await showToast("⚠️ ElevenLabs quota exceeded! Switching to Edge TTS for this session.", "error");
      }
      
      return false;
    }
  };

  /**
   * Edge TTS Engine (Free, Neural voices)
   */
  const speakWithEdgeTTS = async (text) => {
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      const tts = new MsEdgeTTS();
      const voice = config.edgeVoice || 'en-US-JennyNeural';
      const pitch = config.edgePitch || '+0Hz';
      const rate = config.edgeRate || '+10%';
      const volume = config.edgeVolume || '+0%';
      
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      
      const { audioFilePath } = await tts.toFile(os.tmpdir(), text, { pitch, rate, volume });
      
      await playAudioFile(audioFilePath);
      try { fs.unlinkSync(audioFilePath); } catch (e) {}
      return true;
    } catch (e) {
      debugLog(`speakWithEdgeTTS error: ${e.message}`);
      return false;
    }
  };

  /**
   * Windows SAPI Engine (Offline, Built-in)
   */
  const speakWithSAPI = async (text) => {
    if (platform !== 'win32' || !$) return false;
    const scriptPath = path.join(os.tmpdir(), `opencode-sapi-${Date.now()}.ps1`);
    try {
      const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      const voice = config.sapiVoice || 'Microsoft Zira Desktop';
      const rate = Math.max(-10, Math.min(10, config.sapiRate || -1));
      const pitch = config.sapiPitch || 'medium';
      const volume = config.sapiVolume || 'loud';
      const ratePercent = rate >= 0 ? `+${rate * 10}%` : `${rate * 5}%`;
      
      const ssml = `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="${voice.replace(/"/g, '&quot;')}">
    <prosody rate="${ratePercent}" pitch="${pitch}" volume="${volume}">
      ${escapedText}
    </prosody>
  </voice>
</speak>`;
      
      const scriptContent = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.Rate = ${rate}
    try { $synth.SelectVoice("${voice.replace(/"/g, '""')}") } catch { }
    $ssml = @"
${ssml}
"@
    $synth.SpeakSsml($ssml)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($synth) { $synth.Dispose() }
}
`;
      fs.writeFileSync(scriptPath, scriptContent, 'utf-8');
      const result = await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${scriptPath}`.nothrow().quiet();
      
      if (result.exitCode !== 0) {
        debugLog(`speakWithSAPI failed with code ${result.exitCode}: ${result.stderr}`);
        return false;
      }
      return true;
    } catch (e) {
      debugLog(`speakWithSAPI error: ${e.message}`);
      return false;
    } finally {
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch (e) {}
    }
  };

  /**
   * macOS Say Engine
   */
  const speakWithSay = async (text) => {
    if (platform !== 'darwin' || !$) return false;
    try {
      await $`say ${text}`.quiet();
      return true;
    } catch (e) {
      debugLog(`speakWithSay error: ${e.message}`);
      return false;
    }
  };

  /**
   * Check if the system has been idle long enough that the monitor might be asleep.
   */
  const isMonitorLikelyAsleep = async () => {
    if (platform !== 'win32' || !$) return true;
    try {
      const idleThreshold = config.idleThresholdSeconds || 60;
      const cmd = `
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IdleCheck {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static uint GetIdleSeconds() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(lii);
        if (GetLastInputInfo(ref lii)) {
            return (uint)((Environment.TickCount - lii.dwTime) / 1000);
        }
        return 0;
    }
}
'@
[IdleCheck]::GetIdleSeconds()
      `;
      const result = await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      const idleSeconds = parseInt(result.stdout?.toString().trim() || '0', 10);
      return idleSeconds >= idleThreshold;
    } catch (e) {
      return true;
    }
  };

  /**
   * Get the current system volume level (0-100).
   */
  const getCurrentVolume = async () => {
    if (platform !== 'win32' || !$) return -1;
    try {
      const cmd = `
        $signature = @'
[DllImport("winmm.dll")]
public static extern int waveOutGetVolume(IntPtr hwo, out uint dwVolume);
'@
        Add-Type -MemberDefinition $signature -Name Win32VolCheck -Namespace Win32 -PassThru | Out-Null
        $vol = 0
        $result = [Win32.Win32VolCheck]::waveOutGetVolume([IntPtr]::Zero, [ref]$vol)
        if ($result -eq 0) {
            $leftVol = $vol -band 0xFFFF
            [Math]::Round(($leftVol / 65535) * 100)
        } else { -1 }
      `;
      const result = await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      return parseInt(result.stdout?.toString().trim() || '-1', 10);
    } catch (e) {
      return -1;
    }
  };

  /**
   * Wake Monitor Utility
   */
  const wakeMonitor = async (force = false) => {
    if (!config.wakeMonitor || !$) return;
    try {
      if (!force) {
        const likelyAsleep = await isMonitorLikelyAsleep();
        if (!likelyAsleep) return;
      }
      
      if (platform === 'win32') {
        const cmd = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);' -Name "Win32SendMessage" -Namespace Win32Functions; [Win32Functions.Win32SendMessage]::SendMessage(0xFFFF, 0x0112, 0xF170, -1)`;
        await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      } else if (platform === 'darwin') {
        await $`caffeinate -u -t 1`.quiet();
      }
    } catch (e) {
      debugLog(`wakeMonitor error: ${e.message}`);
    }
  };

  /**
   * Force Volume Utility
   */
  const forceVolume = async (force = false) => {
    if (!config.forceVolume || !$) return;
    try {
      if (!force) {
        const currentVolume = await getCurrentVolume();
        const volumeThreshold = config.volumeThreshold || 50;
        if (currentVolume >= 0 && currentVolume >= volumeThreshold) return;
      }

      if (platform === 'win32') {
        const cmd = `$wsh = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $wsh.SendKeys([char]175) }`;
        await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      } else if (platform === 'darwin') {
        await $`osascript -e "set volume output volume 100"`.quiet();
      }
    } catch (e) {
      debugLog(`forceVolume error: ${e.message}`);
    }
  };

  /**
   * Main Speak function with fallback chain
   * Cascade: ElevenLabs -> Edge TTS -> Windows SAPI -> macOS Say -> Sound File
   */
  const speak = async (message, options = {}) => {
    const activeConfig = { ...config, ...options };
    if (!activeConfig.enableSound) return false;
    
    if (activeConfig.enableTTS) {
      let success = false;
      const engine = activeConfig.ttsEngine || 'elevenlabs';
      
      if (engine === 'elevenlabs') {
        success = await speakWithElevenLabs(message);
        if (!success) success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSAPI(message);
      } else if (engine === 'edge') {
        success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSAPI(message);
      } else if (engine === 'sapi') {
        success = await speakWithSAPI(message);
        if (!success) success = await speakWithSay(message);
      }
      
      if (success) return true;
    }

    if (activeConfig.fallbackSound) {
      const soundPath = path.isAbsolute(activeConfig.fallbackSound) 
        ? activeConfig.fallbackSound 
        : path.join(configDir, activeConfig.fallbackSound);
      await playAudioFile(soundPath, activeConfig.loops || 1);
    }
    return false;
  };

  return {
    speak,
    announce: async (message, options = {}) => {
      await wakeMonitor();
      await forceVolume();
      return speak(message, options);
    },
    wakeMonitor,
    forceVolume,
    playAudioFile,
    config
  };
};
