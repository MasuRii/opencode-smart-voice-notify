import crypto from 'crypto';
import { execFile } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { PluginConfig } from '../types/config.js';
import type { LinuxPlatformAPI } from '../types/linux.js';
import type { OpenCodeClient, ShellRunner, ToastVariant, TUIToastPayload } from '../types/opencode-sdk.js';
import type { SpeakOptions, TTSAPI, TTSFactoryParams } from '../types/tts.js';

import { loadConfig } from './config.js';
import { createLinuxPlatform } from './linux.js';

const getPlatform = (): NodeJS.Platform => os.platform();
// Remove module-level configDir constant that caches process.env prematurely
// const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

type VoiceCacheEngine = 'openai' | 'elevenlabs' | 'edge' | 'sapi';

interface ElevenLabsErrorLike {
  statusCode?: number;
  message?: string;
}

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message ?? error);
};

const outputToString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString();
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
};

const toBufferChunk = (chunk: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
};

/**
 * Gets the current OpenCode config directory
 * @returns
 */
const getConfigDir = (): string => process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

/**
 * Loads the TTS configuration (shared with the notification plugin)
 * @returns
 */
export const getTTSConfig = (): PluginConfig => {
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

    // OpenAI-compatible TTS settings
    openaiTtsEndpoint: '',
    openaiTtsApiKey: '',
    openaiTtsModel: 'tts-1',
    openaiTtsVoice: 'alloy',
    openaiTtsFormat: 'mp3',
    openaiTtsSpeed: 1.0,
    enableVoiceCache: false,
    voiceCacheDir: 'voice-cache',
    voiceCacheMaxSizeMB: 100,

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
    reminderBackoffMultiplier: 1.5, // Each follow-up waits longer (30s, 45s, 67.5s)

    // ============================================================
    // TTS MESSAGE VARIETY (Initial notifications - randomly selected)
    // ============================================================
    // Messages when agent finishes work
    idleTTSMessages: [
      'All done! Your task has been completed successfully.',
      'Hey there! I finished working on your request.',
      'Task complete! Ready for your review whenever you are.',
      'Good news! Everything is done and ready for you.',
      'Finished! Let me know if you need anything else.',
    ],
    // Messages for permission requests
    permissionTTSMessages: [
      'Attention please! I need your permission to continue.',
      'Hey! Quick approval needed to proceed with the task.',
      'Heads up! There is a permission request waiting for you.',
      'Excuse me! I need your authorization before I can continue.',
      'Permission required! Please review and approve when ready.',
    ],
    // Messages for MULTIPLE permission requests (use {count} placeholder)
    permissionTTSMessagesMultiple: [
      'Attention please! There are {count} permission requests waiting for your approval.',
      'Hey! {count} permissions need your approval to continue.',
      'Heads up! You have {count} pending permission requests.',
      'Excuse me! I need your authorization for {count} different actions.',
      '{count} permissions required! Please review and approve when ready.',
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
      'Knock knock! Your completed task is patiently waiting for you.',
    ],
    // Reminder messages when permission still needed
    permissionReminderTTSMessages: [
      'Hey! I still need your permission to continue. Please respond!',
      'Reminder: There is a pending permission request. I cannot proceed without you.',
      'Hello? I am waiting for your approval. This is getting urgent!',
      'Please check your screen! I really need your permission to move forward.',
      'Still waiting for authorization! The task is on hold until you respond.',
    ],
    // Reminder messages for MULTIPLE permissions (use {count} placeholder)
    permissionReminderTTSMessagesMultiple: [
      'Hey! I still need your approval for {count} permissions. Please respond!',
      'Reminder: There are {count} pending permission requests. I cannot proceed without you.',
      'Hello? I am waiting for your approval on {count} items. This is getting urgent!',
      'Please check your screen! {count} permissions are waiting for your response.',
      'Still waiting for authorization on {count} requests! The task is on hold.',
    ],

    // Permission batch window (ms) - how long to wait for more permissions before notifying
    permissionBatchWindowMs: 800,

    // ============================================================
    // QUESTION TOOL MESSAGES (SDK v1.1.7+ - Agent asking user questions)
    // ============================================================
    // Messages when agent asks user a question
    questionTTSMessages: [
      'Hey! I have a question for you. Please check your screen.',
      'Attention! I need your input to continue.',
      'Quick question! Please take a look when you have a moment.',
      'I need some clarification. Could you please respond?',
      'Question time! Your input is needed to proceed.',
    ],
    // Messages for MULTIPLE questions (use {count} placeholder)
    questionTTSMessagesMultiple: [
      'Hey! I have {count} questions for you. Please check your screen.',
      'Attention! I need your input on {count} items to continue.',
      '{count} questions need your attention. Please take a look!',
      'I need some clarifications. There are {count} questions waiting for you.',
      'Question time! {count} questions need your response to proceed.',
    ],
    // Reminder messages for questions
    questionReminderTTSMessages: [
      'Hey! I am still waiting for your answer. Please check the questions!',
      'Reminder: There is a question waiting for your response.',
      'Hello? I need your input to continue. Please respond when you can.',
      'Still waiting for your answer! The task is on hold.',
      'Your input is needed! Please check the pending question.',
    ],
    // Reminder messages for MULTIPLE questions (use {count} placeholder)
    questionReminderTTSMessagesMultiple: [
      'Hey! I am still waiting for answers to {count} questions. Please respond!',
      'Reminder: There are {count} questions waiting for your response.',
      'Hello? I need your input on {count} items. Please respond when you can.',
      'Still waiting for your answers on {count} questions! The task is on hold.',
      'Your input is needed! {count} questions are pending your response.',
    ],
    // Question reminder delay (seconds) - slightly less urgent than permissions
    questionReminderDelaySeconds: 25,
    // Question batch window (ms) - how long to wait for more questions before notifying
    questionBatchWindowMs: 800,

    // ============================================================
    // SOUND FILES (Used for immediate notifications)
    // ============================================================
    idleSound: 'assets/Soft-high-tech-notification-sound-effect.mp3',
    permissionSound: 'assets/Machine-alert-beep-sound-effect.mp3',
    questionSound: 'assets/Machine-alert-beep-sound-effect.mp3',

    // ============================================================
    // GENERAL SETTINGS
    // ============================================================
    wakeMonitor: true,
    forceVolume: true,
    enableSound: true,
    enableToast: true,
    volumeThreshold: 50,
    idleThresholdSeconds: 30,
    debugLog: false,
  });
};

let elevenLabsQuotaExceeded = false;

/**
 * Creates a TTS utility instance
 * @param params - { $, client }
 * @returns TTS API
 */
export const createTTS = ({ $, client }: TTSFactoryParams): TTSAPI => {
  const shell: ShellRunner | undefined = $;
  const opencodeClient: OpenCodeClient | undefined = client;
  const config = getTTSConfig();
  const currentPlatform = getPlatform();
  const configDir = getConfigDir();
  const logsDir = path.join(configDir, 'logs');

  const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');

  // Ensure logs directory exists if debug logging is enabled
  if (config.debugLog && !fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // Silently fail - logging is optional
    }
  }

  // Debug logging function (defined early so it can be passed to Linux platform)
  const debugLog = (message: string): void => {
    if (!config.debugLog) return;
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch {}
  };

  // Initialize Linux platform utilities (only used on Linux)
  const linux: LinuxPlatformAPI | null = currentPlatform === 'linux' ? createLinuxPlatform({ $: shell, debugLog }) : null;
  let tuiShowToastShape: 'v1' | 'v2' | null = null;

  const showToast = async (message: string, variant: ToastVariant = 'info'): Promise<void> => {
    if (!config.enableToast) return;
    try {
      if (typeof opencodeClient?.tui?.showToast === 'function') {
        const toastPayload: TUIToastPayload = { message, variant, duration: 6000 };

        if (tuiShowToastShape === 'v1') {
          await opencodeClient.tui.showToast({ body: toastPayload });
          return;
        }

        if (tuiShowToastShape === 'v2') {
          await opencodeClient.tui.showToast(toastPayload);
          return;
        }

        try {
          await opencodeClient.tui.showToast(toastPayload);
          tuiShowToastShape = 'v2';
        } catch {
          await opencodeClient.tui.showToast({ body: toastPayload });
          tuiShowToastShape = 'v1';
        }
      }
    } catch {}
  };

  const execFileQuiet = (file: string, args: string[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
        const stderrText = outputToString(stderr).trim();
        const stdoutText = outputToString(stdout).trim();

        if (error) {
          const details = [getErrorMessage(error), stderrText, stdoutText].filter(Boolean).join('; ');
          reject(new Error(details || `${file} failed`));
          return;
        }

        if (stderrText) {
          debugLog(`execFileQuiet stderr from ${file}: ${stderrText}`);
        }
        resolve();
      });
    });
  };

  const runPowerShellCommand = async (cmd: string): Promise<void> => {
    if (shell) {
      await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      return;
    }

    await execFileQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd]);
  };

  const escapePowerShellSingleQuotedString = (value: string): string => value.replace(/'/g, "''");

  const getSafeLoopCount = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 1;
    }
    return Math.max(1, Math.floor(value));
  };

  /**
   * Play an audio file using legacy Windows Media Center (MCI)
   */

  const getWindowsMciPlaybackCommand = (audioPath: string, loopCount: number): string => {
    const safePath = escapePowerShellSingleQuotedString(audioPath);
    return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MciAudio {
  [DllImport("winmm.dll", CharSet = CharSet.Auto)]
  public static extern int mciSendString(string command, StringBuilder returnValue, int returnLength, IntPtr winHandle);
}
'@
function Invoke-Mci([string]$Command) {
  $buffer = New-Object System.Text.StringBuilder 256
  $code = [MciAudio]::mciSendString($Command, $buffer, $buffer.Capacity, [IntPtr]::Zero)
  if ($code -ne 0) { throw "MCI command failed ($code): $Command" }
  return $buffer.ToString()
}
$filePath = '${safePath}'
$alias = 'opencode_notify_' + ([Guid]::NewGuid().ToString('N'))
try {
  for ($i = 0; $i -lt ${loopCount}; $i++) {
    [void](Invoke-Mci "open \`"$filePath\`" alias $alias")
    [void](Invoke-Mci "play $alias wait")
    [void](Invoke-Mci "close $alias")
  }
} finally {
  try { [void](Invoke-Mci "close $alias") } catch {}
}
exit 0
`;
  };

  /**
   * Play an audio file using .NET player
   */

  const getWindowsDotnetPlaybackCommand = (audioPath: string, loopCount: number): string => {
    const safePath = escapePowerShellSingleQuotedString(audioPath);
    return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$filePath = (Resolve-Path "${safePath}").Path
$player.Open($filePath)
while ($player.NaturalDuration.HasTimeSpan -eq $false) {
    Start-Sleep -Milliseconds 50
}
$durationSeconds = $player.NaturalDuration.TimeSpan.TotalSeconds
$player.Play()
Start-Sleep -Seconds $durationSeconds

try {
  for ($i = 1; $i -lt ${loopCount}; $i++) {
    $player.Position = [System.TimeSpan]::Zero
    $player.Play()
    Start-Sleep -Seconds $durationSeconds
  }
} finally {
  try { $player.Close() } catch {}
}
exit 0
`;
  };

  /**
   * Play an audio file using system media player
   */
  const playAudioFile = async (filePath: string, loops = 1): Promise<void> => {
    const safeLoops = getSafeLoopCount(loops);
    try {
      if (currentPlatform === 'win32') {
        try {
          debugLog('playAudioFile: attempting to playAudioFile via .NET');
          const cmd = getWindowsDotnetPlaybackCommand(filePath, safeLoops);
          await runPowerShellCommand(cmd);
          debugLog(`playAudioFile: Windows .NET playback completed for ${filePath} (${safeLoops}x)`);
        } catch (error) {
          debugLog(`playAudioFile error: .NET failed ${getErrorMessage(error)} attempting MCI`);
          const cmd = getWindowsMciPlaybackCommand(filePath, safeLoops);
          await runPowerShellCommand(cmd);
          debugLog(`playAudioFile: Windows MCI playback completed for ${filePath} (${safeLoops}x)`);
        }
      } else if (currentPlatform === 'darwin') {
        if (!shell) {
          debugLog('playAudioFile: shell runner ($) not available for macOS playback');
          return;
        }
        for (let i = 0; i < safeLoops; i++) {
          await shell`afplay ${filePath}`.quiet();
        }
      } else if (currentPlatform === 'linux' && linux) {
        // Use the Linux platform module for audio playback
        await linux.playAudioFile(filePath, safeLoops);
      } else {
        if (!shell) {
          debugLog('playAudioFile: shell runner ($) not available for Unix playback');
          return;
        }
        // Generic fallback for other Unix-like systems
        for (let i = 0; i < safeLoops; i++) {
          try {
            await shell`paplay ${filePath}`.quiet();
          } catch {
            await shell`aplay ${filePath}`.quiet();
          }
        }
      }
    } catch (error) {
      debugLog(`playAudioFile error: ${getErrorMessage(error)}`);
    }
  };

  const getVoiceCacheLimitBytes = (): number => {
    const maxSizeMB = Number(config.voiceCacheMaxSizeMB ?? 100);
    if (!Number.isFinite(maxSizeMB) || maxSizeMB <= 0) {
      return 0;
    }
    return Math.floor(maxSizeMB * 1024 * 1024);
  };

  const getVoiceCacheDirectory = (): string | null => {
    if (!config.enableVoiceCache || getVoiceCacheLimitBytes() <= 0) {
      return null;
    }

    const configuredDir = config.voiceCacheDir || 'voice-cache';
    const cacheDir = path.isAbsolute(configuredDir) ? configuredDir : path.join(configDir, configuredDir);

    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      return cacheDir;
    } catch (error) {
      debugLog(`voice cache: unable to create cache directory: ${getErrorMessage(error)}`);
      return null;
    }
  };

  const normalizeCacheExtension = (extension: string): string => {
    const cleaned = extension.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleaned || 'mp3';
  };

  const getVoiceCacheFile = (
    engine: VoiceCacheEngine,
    text: string,
    parameters: Record<string, unknown>,
    extension: string,
  ): string | null => {
    const cacheDir = getVoiceCacheDirectory();
    if (!cacheDir) {
      return null;
    }

    const cacheKey = crypto
      .createHash('sha256')
      .update(JSON.stringify({ version: 1, engine, text, parameters }))
      .digest('hex');

    return path.join(cacheDir, `tts-${cacheKey}.${normalizeCacheExtension(extension)}`);
  };

  const pruneVoiceCache = (cacheDir: string): void => {
    const limitBytes = getVoiceCacheLimitBytes();
    if (limitBytes <= 0) {
      return;
    }

    try {
      const entries = fs
        .readdirSync(cacheDir)
        .filter((file) => file.startsWith('tts-'))
        .map((file) => {
          const filePath = path.join(cacheDir, file);
          const stats = fs.statSync(filePath);
          return { filePath, size: stats.size, mtimeMs: stats.mtimeMs };
        })
        .filter((entry) => fs.statSync(entry.filePath).isFile())
        .sort((left, right) => left.mtimeMs - right.mtimeMs);

      let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
      for (const entry of entries) {
        if (totalBytes <= limitBytes) {
          break;
        }
        try {
          fs.unlinkSync(entry.filePath);
          totalBytes -= entry.size;
        } catch (error) {
          debugLog(`voice cache: unable to prune ${entry.filePath}: ${getErrorMessage(error)}`);
        }
      }
    } catch (error) {
      debugLog(`voice cache: prune failed: ${getErrorMessage(error)}`);
    }
  };

  const commitVoiceCacheFile = (tempFile: string, cacheFile: string): boolean => {
    try {
      if (!fs.existsSync(tempFile)) {
        return false;
      }

      if (fs.existsSync(cacheFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
        return true;
      }

      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      try {
        fs.renameSync(tempFile, cacheFile);
      } catch {
        fs.copyFileSync(tempFile, cacheFile);
        fs.unlinkSync(tempFile);
      }
      pruneVoiceCache(path.dirname(cacheFile));
      return fs.existsSync(cacheFile);
    } catch (error) {
      debugLog(`voice cache: unable to commit cache file: ${getErrorMessage(error)}`);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      return false;
    }
  };

  const writeVoiceCacheBuffer = (cacheFile: string, audio: Buffer): boolean => {
    const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempFile, audio);
      return commitVoiceCacheFile(tempFile, cacheFile);
    } catch (error) {
      debugLog(`voice cache: unable to write cache buffer: ${getErrorMessage(error)}`);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      return false;
    }
  };

  const copyVoiceCacheFile = (cacheFile: string, sourceFile: string): boolean => {
    if (!fs.existsSync(sourceFile)) {
      return false;
    }

    const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.copyFileSync(sourceFile, tempFile);
      return commitVoiceCacheFile(tempFile, cacheFile);
    } catch (error) {
      debugLog(`voice cache: unable to copy cache file: ${getErrorMessage(error)}`);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      return false;
    }
  };

  const playCachedVoiceFile = async (cacheFile: string): Promise<boolean> => {
    if (!fs.existsSync(cacheFile)) {
      return false;
    }

    try {
      const now = new Date();
      fs.utimesSync(cacheFile, now, now);
    } catch {}

    debugLog(`voice cache: hit ${cacheFile}`);
    await playAudioFile(cacheFile);
    return true;
  };

  const createTempAudioFile = (prefix: string, extension: string): string => {
    const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return path.join(os.tmpdir(), `${prefix}-${uniquePart}.${normalizeCacheExtension(extension)}`);
  };

  /**
   * ElevenLabs Engine (Online, High Quality, Anime-like voices)
   */
  const speakWithElevenLabs = async (text: string): Promise<boolean> => {
    const voiceId = config.elevenLabsVoiceId || 'cgSgspJ2msm6clMCkdW9';
    const model = config.elevenLabsModel || 'eleven_turbo_v2_5';
    const stability = config.elevenLabsStability ?? 0.5;
    const similarity = config.elevenLabsSimilarity ?? 0.75;
    const style = config.elevenLabsStyle ?? 0.5;
    const cacheFile = getVoiceCacheFile(
      'elevenlabs',
      text,
      { voiceId, model, stability, similarity, style },
      'mp3',
    );

    if (cacheFile && (await playCachedVoiceFile(cacheFile))) {
      return true;
    }

    if (elevenLabsQuotaExceeded) return false;

    if (!config.elevenLabsApiKey) {
      debugLog('speakWithElevenLabs: No API key configured');
      return false;
    }

    try {
      const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
      const elClient = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });

      const elevenLabsPayload = {
        text,
        model_id: model,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style,
          use_speaker_boost: true,
        },
      } as unknown as Parameters<typeof elClient.textToSpeech.convert>[1];

      const audio = await elClient.textToSpeech.convert(voiceId, elevenLabsPayload);

      const chunks: Buffer[] = [];
      for await (const chunk of audio as AsyncIterable<unknown>) {
        chunks.push(toBufferChunk(chunk));
      }
      const audioBuffer = Buffer.concat(chunks);
      const cacheWritten = cacheFile ? writeVoiceCacheBuffer(cacheFile, audioBuffer) : false;
      const audioFile = cacheWritten && cacheFile ? cacheFile : createTempAudioFile('opencode-tts', 'mp3');
      if (!cacheWritten) {
        fs.writeFileSync(audioFile, audioBuffer);
      }

      await playAudioFile(audioFile);
      if (!cacheWritten) {
        try {
          fs.unlinkSync(audioFile);
        } catch {}
      }
      return true;
    } catch (error) {
      debugLog(`speakWithElevenLabs error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);

      // Handle quota exceeded (401 specifically, or specific error message)
      const elevenLabsError = error as ElevenLabsErrorLike;
      const errorMessage = elevenLabsError.message ?? '';
      const isQuotaError =
        elevenLabsError.statusCode === 401 ||
        errorMessage.includes('401') ||
        errorMessage.toLowerCase().includes('quota_exceeded') ||
        errorMessage.toLowerCase().includes('quota exceeded');

      if (isQuotaError) {
        elevenLabsQuotaExceeded = true;
        await showToast('⚠️ ElevenLabs quota exceeded! Switching to Edge TTS for this session.', 'error');
      }

      return false;
    }
  };

  /**
   * Edge TTS Engine via Python CLI (Free, Neural voices)
   * Uses Python edge-tts package via command line as it's more reliable than Node.js WebSocket libraries.
   * Fallback: tries msedge-tts npm package if Python edge-tts is not available.
   */
  const speakWithEdgeTTS = async (text: string): Promise<boolean> => {
    const voice = config.edgeVoice || 'en-US-JennyNeural';
    const pitch = config.edgePitch || '+0Hz';
    const rate = config.edgeRate || '+10%';
    const volume = config.edgeVolume || '+0%';
    const cacheFile = getVoiceCacheFile('edge', text, { voice, pitch, rate, volume }, 'mp3');

    if (cacheFile && (await playCachedVoiceFile(cacheFile))) {
      return true;
    }

    const tempFile = cacheFile ? `${cacheFile}.${process.pid}.${Date.now()}.tmp` : createTempAudioFile('opencode-edge-tts', 'mp3');

    // Escape text for shell (replace quotes with escaped quotes)
    const escapedText = text.replace(/"/g, '\\"');

    // Try Python edge-tts first (more reliable due to aiohttp WebSocket handling)
    if (shell) {
      try {
        // Use proper template literal syntax with individual arguments
        await shell`edge-tts --voice ${voice} --rate ${rate} --volume ${volume} --pitch ${pitch} --text ${escapedText} --write-media ${tempFile}`
          .quiet()
          .nothrow();

        if (fs.existsSync(tempFile)) {
          const cacheWritten = cacheFile ? commitVoiceCacheFile(tempFile, cacheFile) : false;
          const audioFile = cacheWritten && cacheFile ? cacheFile : tempFile;
          await playAudioFile(audioFile);
          if (!cacheWritten) {
            try {
              fs.unlinkSync(tempFile);
            } catch {}
          }
          debugLog('speakWithEdgeTTS: success via Python edge-tts CLI');
          return true;
        }
      } catch (error) {
        debugLog(`speakWithEdgeTTS: Python CLI failed: ${getErrorMessage(error) || 'unknown'}, trying npm package...`);
        // Fall through to try npm package
      }
    }

    // Fallback to msedge-tts npm package
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      const tts = new MsEdgeTTS();

      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const { audioFilePath } = await tts.toFile(os.tmpdir(), text, { pitch, rate, volume });

      const cacheWritten = cacheFile ? copyVoiceCacheFile(cacheFile, audioFilePath) : false;
      const audioFile = cacheWritten && cacheFile ? cacheFile : audioFilePath;
      await playAudioFile(audioFile);
      try {
        if (audioFilePath !== audioFile) {
          fs.unlinkSync(audioFilePath);
        } else if (!cacheWritten) {
          fs.unlinkSync(audioFilePath);
        }
      } catch {}
      debugLog('speakWithEdgeTTS: success via msedge-tts npm package');
      return true;
    } catch (error) {
      debugLog(`speakWithEdgeTTS error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * Windows SAPI Engine (Offline, Built-in)
   */
  const speakWithSAPI = async (text: string): Promise<boolean> => {
    if (currentPlatform !== 'win32') {
      debugLog('speakWithSAPI: skipped (not Windows)');
      return false;
    }
    if (!shell) {
      debugLog('speakWithSAPI: skipped (shell helper $ not available)');
      return false;
    }
    const scriptPath = path.join(os.tmpdir(), `opencode-sapi-${Date.now()}.ps1`);
    let sapiOutputFile: string | null = null;
    try {
      const escapedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      const voice = config.sapiVoice || 'Microsoft Zira Desktop';
      const rate = Math.max(-10, Math.min(10, config.sapiRate || -1));
      const pitch = config.sapiPitch || 'medium';
      const volume = config.sapiVolume || 'loud';
      const ratePercent = rate >= 0 ? `+${rate * 10}%` : `${rate * 5}%`;
      const cacheFile = getVoiceCacheFile('sapi', text, { voice, rate, pitch, volume }, 'wav');

      if (cacheFile && (await playCachedVoiceFile(cacheFile))) {
        return true;
      }

      sapiOutputFile = cacheFile ? `${cacheFile}.${process.pid}.${Date.now()}.tmp.wav` : null;
      const setOutputToCacheFile = sapiOutputFile
        ? `$synth.SetOutputToWaveFile('${sapiOutputFile.replace(/'/g, "''")}')`
        : '';

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
    ${setOutputToCacheFile}
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
      const result = await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${scriptPath}`.nothrow().quiet();

      if (result.exitCode !== 0) {
        debugLog(`speakWithSAPI failed with code ${result.exitCode}: ${outputToString(result.stderr)}`);
        return false;
      }

      if (cacheFile && sapiOutputFile) {
        if (commitVoiceCacheFile(sapiOutputFile, cacheFile)) {
          await playAudioFile(cacheFile);
          return true;
        }
        debugLog('speakWithSAPI: cache output file was not created');
        return false;
      }

      return true;
    } catch (error) {
      debugLog(`speakWithSAPI error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    } finally {
      try {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      } catch {}
      try {
        if (sapiOutputFile && fs.existsSync(sapiOutputFile)) fs.unlinkSync(sapiOutputFile);
      } catch {}
    }
  };

  /**
   * macOS Say Engine
   */
  const speakWithSay = async (text: string): Promise<boolean> => {
    if (currentPlatform !== 'darwin' || !shell) return false;
    try {
      await shell`say ${text}`.quiet();
      return true;
    } catch (error) {
      debugLog(`speakWithSay error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * OpenAI-Compatible TTS Engine (Kokoro, OpenAI, LocalAI, etc.)
   * Calls /v1/audio/speech endpoint with configurable base URL
   */
  const speakWithOpenAI = async (text: string): Promise<boolean> => {
    const endpoint = config.openaiTtsEndpoint.replace(/\/$/, '');
    const model = config.openaiTtsModel || 'tts-1';
    const voice = config.openaiTtsVoice || 'alloy';
    const format = config.openaiTtsFormat || 'mp3';
    const speed = config.openaiTtsSpeed ?? 1.0;
    const cacheFile = getVoiceCacheFile('openai', text, { endpoint, model, voice, format, speed }, format);

    if (cacheFile && (await playCachedVoiceFile(cacheFile))) {
      return true;
    }

    if (!endpoint) {
      debugLog('speakWithOpenAI: No endpoint configured');
      return false;
    }

    try {
      const url = `${endpoint}/v1/audio/speech`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add auth header if API key is provided
      if (config.openaiTtsApiKey) {
        headers.Authorization = `Bearer ${config.openaiTtsApiKey}`;
      }

      const body = {
        model,
        input: text,
        voice,
        response_format: format,
        speed,
      };

      debugLog(`speakWithOpenAI: Calling ${url} with voice=${body.voice}, model=${body.model}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog(`speakWithOpenAI: API error ${response.status}: ${errorText}`);
        return false;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const cacheWritten = cacheFile ? writeVoiceCacheBuffer(cacheFile, audioBuffer) : false;
      const audioFile = cacheWritten && cacheFile ? cacheFile : createTempAudioFile('opencode-tts-openai', format);
      if (!cacheWritten) {
        fs.writeFileSync(audioFile, audioBuffer);
      }

      await playAudioFile(audioFile);
      if (!cacheWritten) {
        try {
          fs.unlinkSync(audioFile);
        } catch {}
      }
      return true;
    } catch (error) {
      debugLog(`speakWithOpenAI error: ${getErrorMessage(error) || String(error) || 'Unknown error'}`);
      return false;
    }
  };

  /**
   * Get the current system idle time in seconds.
   */
  const getSystemIdleSeconds = async (): Promise<number> => {
    if (currentPlatform === 'linux') {
      // On Linux, we can't reliably detect idle time across all DEs
      // Return a high value to always attempt wake (it's a no-op if already awake)
      return 999;
    }
    if (currentPlatform !== 'win32' || !shell) return 999;
    try {
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
      const result = await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      return parseInt(outputToString(result.stdout).trim() || '0', 10);
    } catch {
      return 999; // Assume idle on error
    }
  };

  /**
   * Get the current system volume level (0-100).
   */
  const getCurrentVolume = async (): Promise<number> => {
    // Use Linux platform module
    if (currentPlatform === 'linux' && linux) {
      return await linux.getCurrentVolume();
    }
    if (currentPlatform !== 'win32' || !shell) return -1;
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
      const result = await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      return parseInt(outputToString(result.stdout).trim() || '-1', 10);
    } catch {
      return -1;
    }
  };

  /**
   * Wake Monitor Utility
   */
  const wakeMonitor = async (force = false): Promise<void> => {
    if (!config.wakeMonitor || !shell) return;
    try {
      const idleSeconds = await getSystemIdleSeconds();
      const threshold = config.idleThresholdSeconds || 30;

      if (!force && idleSeconds < threshold) {
        debugLog(`wakeMonitor: skipped (idle ${idleSeconds}s < ${threshold}s)`);
        return;
      }

      debugLog(`wakeMonitor: attempting to wake monitor (idle: ${idleSeconds}s, force: ${force})`);

      if (currentPlatform === 'win32') {
        const cmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{F15}')`;
        await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
        debugLog('wakeMonitor: Windows wake command executed');
      } else if (currentPlatform === 'darwin') {
        await shell`caffeinate -u -t 1`.quiet();
        debugLog('wakeMonitor: macOS wake command executed');
      } else if (currentPlatform === 'linux' && linux) {
        // Use the Linux platform module for wake monitor
        await linux.wakeMonitor();
        debugLog('wakeMonitor: Linux wake command executed');
      }
    } catch (error) {
      debugLog(`wakeMonitor error: ${getErrorMessage(error)}`);
    }
  };

  /**
   * Force Volume Utility
   */
  const forceVolume = async (force = false): Promise<void> => {
    if (!config.forceVolume || !shell) return;
    try {
      if (!force) {
        const currentVolume = await getCurrentVolume();
        const volumeThreshold = config.volumeThreshold || 50;
        if (currentVolume >= 0 && currentVolume >= volumeThreshold) return;
      }

      if (currentPlatform === 'win32') {
        const cmd = `$wsh = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $wsh.SendKeys([char]175) }`;
        await shell`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmd}`.quiet();
      } else if (currentPlatform === 'darwin') {
        await shell`osascript -e "set volume output volume 100"`.quiet();
      } else if (currentPlatform === 'linux' && linux) {
        // Use the Linux platform module for force volume
        await linux.forceVolume();
      }
    } catch (error) {
      debugLog(`forceVolume error: ${getErrorMessage(error)}`);
    }
  };

  /**
   * Main Speak function with fallback chain
   * Cascade: Primary Engine -> Edge TTS -> Windows SAPI -> macOS Say -> Sound File
   *
   * Fallback ensures TTS works even if:
   * - Python edge-tts not installed (falls to npm package, then SAPI/Say)
   * - msedge-tts npm fails (403 errors - falls to SAPI/Say)
   * - User is on macOS without edge-tts (falls to built-in 'say' command)
   * - User is on Linux without edge-tts (falls to sound file only)
   */
  const speak = async (message: string, options: SpeakOptions = {}): Promise<boolean> => {
    const activeConfig = { ...config, ...options } as PluginConfig & SpeakOptions;
    if (!activeConfig.enableSound) return false;

    if (activeConfig.enableTTS) {
      let success = false;
      const engine = activeConfig.ttsEngine || 'elevenlabs';

      if (engine === 'openai') {
        success = await speakWithOpenAI(message);
        if (!success) success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSAPI(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else if (engine === 'elevenlabs') {
        success = await speakWithElevenLabs(message);
        if (!success) success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSAPI(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else if (engine === 'edge') {
        success = await speakWithEdgeTTS(message);
        if (!success) success = await speakWithSAPI(message);
        if (!success) success = await speakWithSay(message); // macOS fallback
      } else if (engine === 'sapi') {
        success = await speakWithSAPI(message);
        if (!success) success = await speakWithSay(message);
      }

      if (success) return true;
    }

    if (activeConfig.fallbackSound) {
      const soundPath = path.isAbsolute(activeConfig.fallbackSound)
        ? activeConfig.fallbackSound
        : path.join(getConfigDir(), activeConfig.fallbackSound);

      await playAudioFile(soundPath, activeConfig.loops || 1);
    }
    return false;
  };

  return {
    speak,
    announce: async (message: string, options: SpeakOptions = {}): Promise<boolean> => {
      await wakeMonitor();
      await forceVolume();
      return speak(message, options);
    },
    wakeMonitor,
    forceVolume,
    playAudioFile,
    config,
  };
};
