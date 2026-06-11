import { exec, type ExecOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import detectTerminal from 'detect-terminal';
import { promisify } from 'util';

import { createLinuxPlatform } from './linux.js';
import type { ShellRunner } from '../types/opencode-sdk.js';

/**
 * Focus Detection Module for OpenCode Smart Voice Notify
 *
 * Detects whether the user is currently looking at the OpenCode terminal.
 * Used to suppress notifications when the user is already focused on the terminal.
 *
 * Platform support:
 * - macOS: Full support using AppleScript to check frontmost app
 * - Windows: Full support using PowerShell + Get-Process
 * - Linux: X11 (xdotool/xprop) and Wayland (Sway/GNOME/KDE)
 *
 * @module util/focus-detect
 * @see docs/ARCHITECT_PLAN.md - Phase 3, Task 3.2
 */

type ExecAsync = (
  command: string,
  options?: ExecOptionsWithStringEncoding,
) => Promise<{ stdout: string; stderr: string }>;

interface FocusCacheState {
  isFocused: boolean;
  timestamp: number;
  terminalName: string | null;
}

interface FocusDetectionSupport {
  supported: boolean;
  reason?: string;
}

interface TerminalFocusOptions {
  debugLog?: boolean;
  shellRunner?: ShellRunner;
}

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as { message?: unknown };
  return String(maybeError?.message);
};

const execAsync = promisify(exec) as ExecAsync;

const toUtf8Text = (value: Buffer | Uint8Array | string | null | undefined): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (!value) {
    return '';
  }

  return Buffer.from(value).toString('utf8');
};

const executeCommand = async (
  command: string,
  options: ExecOptionsWithStringEncoding,
  shellRunner?: ShellRunner,
): Promise<{ stdout: string; stderr: string }> => {
  if (!shellRunner) {
    return execAsync(command, options);
  }

  const execution = shellRunner`${command}`.quiet().nothrow();
  if (typeof execution.timeout === 'function') {
    execution.timeout(typeof options.timeout === 'number' ? options.timeout : 2000);
  }

  const shellResult = await execution;

  return {
    stdout: toUtf8Text(shellResult.stdout),
    stderr: toUtf8Text(shellResult.stderr),
  };
};

// ========================================
// CACHING CONFIGURATION
// ========================================

/**
 * Cache for focus detection results.
 * Prevents excessive system calls (AppleScript execution).
 */
let focusCache: FocusCacheState = {
  isFocused: false,
  timestamp: 0,
  terminalName: null,
};

/**
 * Cache TTL in milliseconds.
 * Focus detection results are cached for this duration.
 * 500ms provides a good balance between responsiveness and performance.
 */
const CACHE_TTL_MS = 500;

/**
 * List of known terminal application names for macOS.
 * These are matched against the frontmost application name.
 * The detect-terminal package helps identify which terminal is in use.
 */
export const KNOWN_TERMINALS_MACOS = [
  'Terminal',
  'iTerm',
  'iTerm2',
  'Hyper',
  'Alacritty',
  'kitty',
  'WezTerm',
  'Tabby',
  'Warp',
  'Rio',
  'Ghostty',
  // VS Code integrated terminal hosts OpenCode inside the editor process.
  'Visual Studio Code',
  'Visual Studio Code - Insiders',
  'VSCodium',
  'VS Code',
  'VSCode',
  'vscode',
] as const;

/**
 * List of known terminal application names and process names for Windows.
 * These are matched against the focused process name from PowerShell.
 */
export const KNOWN_TERMINALS_WINDOWS = [
  'Windows Terminal',
  'WindowsTerminal',
  'cmd',
  'cmd.exe',
  'Command Prompt',
  'PowerShell',
  'powershell',
  'pwsh',
  'conhost',
  'Alacritty',
  'kitty',
  'WezTerm',
  'Hyper',
  'Tabby',
  'Warp',
  'Rio',
  'Ghostty',
  // VS Code integrated terminal runs under the editor's GUI process.
  'Code',
  'Code.exe',
  'Visual Studio Code',
  'Code - Insiders',
  'Code - Insiders.exe',
  'VS Code',
  'VSCode',
  'vscode',
  'VSCodium',
  'VSCodium.exe',
  // Unix-like shells on Windows
  'Git Bash',
  'bash',
  'MINGW64',
  'Cygwin',
  'MSYS2',
] as const;

/**
 * List of known terminal application names and window classes for Linux.
 */
export const KNOWN_TERMINALS_LINUX = [
  'gnome-terminal',
  'gnome terminal',
  'gnome-terminal-server',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'lxterminal',
  'terminator',
  'tilix',
  'terminology',
  'kitty',
  'alacritty',
  'wezterm',
  'hyper',
  'tabby',
  'warp',
  'rio',
  'ghostty',
  'foot',
  'xterm',
  'urxvt',
  'rxvt',
  'st',
  // VS Code/X11/Wayland classes and TERM_PROGRAM values.
  'code',
  'code-insiders',
  'code-oss',
  'codium',
  'vscodium',
  'vscode',
] as const;

// ========================================
// DEBUG LOGGING
// ========================================

/**
 * Debug logging to file.
 * Only logs when enabled.
 * Writes to ~/.config/opencode/logs/smart-voice-notify-debug.log
 *
 * @param message - Message to log
 * @param enabled - Whether debug logging is enabled
 */
const debugLog = (message: string, enabled = false): void => {
  if (!enabled) return;

  try {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const logsDir = path.join(configDir, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [focus-detect] ${message}\n`);
  } catch {
    // Silently fail - logging should never break the plugin
  }
};

// ========================================
// PLATFORM DETECTION
// ========================================

/**
 * Get the current platform identifier.
 */
export const getPlatform = (): NodeJS.Platform => os.platform();

/**
 * Check if focus detection is supported on this platform.
 *
 * @returns Support status
 */
export const isFocusDetectionSupported = (): FocusDetectionSupport => {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      return { supported: true };
    case 'win32':
      return { supported: true };
    case 'linux':
      return { supported: true };
    default:
      return { supported: false, reason: `Unsupported platform: ${platform}` };
  }
};

// ========================================
// TERMINAL DETECTION
// ========================================

/**
 * Detect the current terminal emulator using detect-terminal package.
 * Caches the result since the terminal doesn't change during execution.
 *
 * @param debug - Enable debug logging
 * @returns Terminal name or null if not detected
 */
let cachedTerminalName: string | null = null;
let terminalDetectionAttempted = false;

const normalizeTerminalName = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/i, '');

const VS_CODE_TERM_PROGRAMS = new Set(['vscode', 'vscode-insiders', 'vscodium']);
const VS_CODE_FOCUS_NAMES = new Set([
  'code',
  'visual studio code',
  'visual studio code - insiders',
  'code - insiders',
  'vs code',
  'vscode',
  'vscode-insiders',
  'vscodium',
  'code-insiders',
  'code-oss',
  'codium',
]);

const getVSCodeTermProgram = (): string | null => {
  const termProgram = process.env.TERM_PROGRAM?.trim().toLowerCase();
  if (!termProgram || !VS_CODE_TERM_PROGRAMS.has(termProgram)) {
    return null;
  }

  return termProgram;
};

const isVSCodeTerminalName = (name: string | null): boolean => {
  if (!name) {
    return false;
  }

  return VS_CODE_FOCUS_NAMES.has(normalizeTerminalName(name));
};

export const getTerminalName = (debug = false): string | null => {
  // Return cached result if already detected
  if (terminalDetectionAttempted) {
    return cachedTerminalName;
  }

  try {
    terminalDetectionAttempted = true;

    const vscodeTermProgram = getVSCodeTermProgram();
    if (vscodeTermProgram) {
      cachedTerminalName = vscodeTermProgram;
      debugLog(`Detected terminal from TERM_PROGRAM: ${cachedTerminalName}`, debug);
      return cachedTerminalName;
    }

    // Prefer the outer terminal (GUI app) over multiplexers like tmux/screen
    const terminal = detectTerminal({ preferOuter: true });
    cachedTerminalName = terminal || null;
    debugLog(`Detected terminal: ${cachedTerminalName}`, debug);
    return cachedTerminalName;
  } catch (error) {
    debugLog(`Terminal detection failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

// ========================================
// FOCUS DETECTION - macOS
// ========================================

/**
 * AppleScript to get the frontmost application name.
 * Uses System Events to determine which app is currently focused.
 * Includes checks for:
 * - App visibility (not hidden with Cmd+H)
 * - Visible, non-minimized windows
 * Returns empty string if app is hidden or has no visible windows.
 */
const APPLESCRIPT_GET_FRONTMOST = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  
  -- Check if app is visible (not hidden with Cmd+H)
  if visible of frontApp is false then
    return ""
  end if
  
  -- Check if the app has any visible, non-minimized windows
  try
    set windowList to every window of frontApp whose visible is true and miniaturized is false
    if (count of windowList) is 0 then
      return ""
    end if
  end try
  
  return name of frontApp
end tell
`;

/**
 * PowerShell script to get the frontmost process on Windows.
 * Uses user32.dll to get foreground window handle, then Get-Process by PID.
 * Includes checks for minimized (IsIconic) and invisible (IsWindowVisible) windows.
 */
const POWERSHELL_GET_FRONTMOST_PROCESS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32FocusDetect {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$processId = 0
$foregroundWindow = [Win32FocusDetect]::GetForegroundWindow()

# No foreground window (e.g., showing desktop)
if ($foregroundWindow -eq [IntPtr]::Zero) {
  return
}

# Check if window is minimized (iconic) - if so, not truly focused
if ([Win32FocusDetect]::IsIconic($foregroundWindow)) {
  return
}

# Check if window is visible - if not, not truly focused
if (-not [Win32FocusDetect]::IsWindowVisible($foregroundWindow)) {
  return
}

[Win32FocusDetect]::GetWindowThreadProcessId($foregroundWindow, [ref]$processId) | Out-Null
if ($processId -le 0) {
  return
}

Get-Process -Id $processId | Select-Object -ExpandProperty ProcessName
`;

const getEncodedPowerShellScript = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64');

/**
 * Get the name of the frontmost application on macOS.
 *
 * @param debug - Enable debug logging
 * @returns Frontmost app name or null on error
 */
const getFrontmostAppMacOS = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  try {
    const { stdout } = await executeCommand(
      `osascript -e '${APPLESCRIPT_GET_FRONTMOST}'`,
      {
        encoding: 'utf8',
        timeout: 2000, // 2 second timeout
        maxBuffer: 1024, // Small buffer - we only expect app name
      },
      shellRunner,
    );

    const appName = stdout.trim();
    debugLog(`Frontmost app: "${appName}"`, debug);
    return appName;
  } catch (error) {
    debugLog(`Failed to get frontmost app: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

/**
 * Get the focused process name on Windows via PowerShell.
 *
 * @param debug - Enable debug logging
 * @param shellRunner - Optional shell runner override for testing
 * @returns Focused process name or null on error
 */
const getFrontmostAppWindows = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  try {
    const encodedScript = getEncodedPowerShellScript(POWERSHELL_GET_FRONTMOST_PROCESS);
    const command =
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    const { stdout, stderr } = await executeCommand(
      command,
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024,
      },
      shellRunner,
    );

    if (stderr.trim()) {
      debugLog(`PowerShell stderr: ${stderr.trim()}`, debug);
    }

    const processName = stdout.trim();
    if (!processName) {
      debugLog('PowerShell returned empty focused process name', debug);
      return null;
    }

    debugLog(`Frontmost process: "${processName}"`, debug);
    return processName;
  } catch (error) {
    debugLog(`Failed to get frontmost Windows process: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const getLinuxSessionType = (): 'x11' | 'wayland' | 'tty' | 'unknown' => {
  try {
    return createLinuxPlatform({}).getSessionType();
  } catch {
    return 'unknown';
  }
};

const runLinuxFocusCommand = async (
  command: string,
  debug: boolean,
  label: string,
  shellRunner?: ShellRunner,
): Promise<string | null> => {
  try {
    const { stdout, stderr } = await executeCommand(
      command,
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      },
      shellRunner,
    );

    if (stderr.trim()) {
      debugLog(`${label}: stderr: ${stderr.trim()}`, debug);
    }

    const output = stdout.trim();
    if (!output) {
      debugLog(`${label}: empty output`, debug);
      return null;
    }

    return output;
  } catch (error) {
    debugLog(`${label}: command failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const parseQuotedValues = (text: string): string[] => {
  const values: string[] = [];
  const matches = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];

  for (const match of matches) {
    const value = match.slice(1, -1).trim();
    if (value) {
      values.push(value);
    }
  }

  return values;
};

const getFrontmostAppLinuxX11 = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  if (!process.env.DISPLAY) {
    const vscodeClass = shellRunner
      ? await runLinuxFocusCommand(
          'xdotool getwindowfocus getwindowclassname',
          debug,
          'linux.x11.xdotool-class-no-display',
          shellRunner,
        )
      : null;

    if (isVSCodeTerminalName(vscodeClass)) {
      debugLog(`linux.x11: VS Code focused without DISPLAY: "${vscodeClass}"`, debug);
      return vscodeClass;
    }

    debugLog('linux.x11: DISPLAY not set', debug);
    return null;
  }

  const xdotoolClass = await runLinuxFocusCommand(
    'xdotool getwindowfocus getwindowclassname',
    debug,
    'linux.x11.xdotool-class',
    shellRunner,
  );
  if (xdotoolClass) {
    debugLog(`linux.x11: focused class from xdotool: "${xdotoolClass}"`, debug);
    return xdotoolClass;
  }

  const xdotoolName = await runLinuxFocusCommand(
    'xdotool getwindowfocus getwindowname',
    debug,
    'linux.x11.xdotool-name',
    shellRunner,
  );
  if (xdotoolName) {
    debugLog(`linux.x11: focused name from xdotool: "${xdotoolName}"`, debug);
    return xdotoolName;
  }

  const activeWindow = await runLinuxFocusCommand(
    'xprop -root _NET_ACTIVE_WINDOW',
    debug,
    'linux.x11.xprop-active-window',
    shellRunner,
  );

  const windowId = activeWindow?.match(/0x[0-9a-f]+/i)?.[0] || null;
  if (!windowId) {
    debugLog('linux.x11: active window id parse failed', debug);
    return null;
  }

  const windowProps = await runLinuxFocusCommand(
    `xprop -id ${windowId} WM_CLASS WM_NAME`,
    debug,
    'linux.x11.xprop-window-props',
    shellRunner,
  );

  if (!windowProps) {
    return null;
  }

  const quotedValues = parseQuotedValues(windowProps);
  const focused = quotedValues.find(Boolean) || null;
  if (focused) {
    debugLog(`linux.x11: focused value from xprop: "${focused}"`, debug);
  }

  return focused;
};

interface SwayTreeNode {
  focused?: boolean;
  name?: string;
  app_id?: string;
  window_properties?: {
    class?: string;
    instance?: string;
    title?: string;
  };
  nodes?: SwayTreeNode[];
  floating_nodes?: SwayTreeNode[];
}

const findFocusedSwayNode = (node: SwayTreeNode): SwayTreeNode | null => {
  if (node.focused) {
    return node;
  }

  const children = [...(node.nodes || []), ...(node.floating_nodes || [])];
  for (const child of children) {
    const result = findFocusedSwayNode(child);
    if (result) {
      return result;
    }
  }

  return null;
};

const getFrontmostAppWaylandSway = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const treeOutput = await runLinuxFocusCommand(
    'swaymsg -t get_tree',
    debug,
    'linux.wayland.swaymsg',
    shellRunner,
  );

  if (!treeOutput) {
    return null;
  }

  try {
    const tree = JSON.parse(treeOutput) as SwayTreeNode;
    const focused = findFocusedSwayNode(tree);
    if (!focused) {
      debugLog('linux.wayland.swaymsg: focused node not found', debug);
      return null;
    }

    const name =
      focused.app_id ||
      focused.window_properties?.class ||
      focused.window_properties?.instance ||
      focused.name ||
      focused.window_properties?.title ||
      null;

    if (name) {
      debugLog(`linux.wayland.swaymsg: focused app "${name}"`, debug);
    }

    return name;
  } catch (error) {
    debugLog(`linux.wayland.swaymsg: parse failed: ${getErrorMessage(error)}`, debug);
    return null;
  }
};

const parseGdbusEvalResult = (output: string): string | null => {
  const match = output.match(/^\((true|false),\s*(.*)\)$/s);
  if (!match) {
    return output.trim() || null;
  }

  if (match[1] !== 'true') {
    return null;
  }

  let value = match[2]?.trim() || '';
  if (!value || value === "''" || value === '""') {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value.trim() || null;
};

const getFrontmostAppWaylandGnome = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const command =
    'gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "(() => { const w = global.display.focus_window; if (!w) return \"\"; return [w.get_wm_class(), w.get_title()].filter(Boolean).join(\" - \" ); })()"';

  const result = await runLinuxFocusCommand(command, debug, 'linux.wayland.gdbus', shellRunner);
  if (!result) {
    return null;
  }

  const parsed = parseGdbusEvalResult(result);
  if (parsed) {
    debugLog(`linux.wayland.gdbus: focused app "${parsed}"`, debug);
  }

  return parsed;
};

const getFrontmostAppWaylandKde = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const activeWindow = await runLinuxFocusCommand(
    'qdbus org.kde.KWin /KWin org.kde.KWin.activeWindow',
    debug,
    'linux.wayland.qdbus-active-window',
    shellRunner,
  );

  if (!activeWindow) {
    return null;
  }

  const caption = await runLinuxFocusCommand(
    `qdbus org.kde.KWin /KWin org.kde.KWin.caption ${activeWindow}`,
    debug,
    'linux.wayland.qdbus-caption',
    shellRunner,
  );

  const windowClass = await runLinuxFocusCommand(
    `qdbus org.kde.KWin /KWin org.kde.KWin.windowClass ${activeWindow}`,
    debug,
    'linux.wayland.qdbus-window-class',
    shellRunner,
  );

  const appName = windowClass || caption || activeWindow;
  debugLog(`linux.wayland.qdbus: focused app "${appName}"`, debug);
  return appName;
};

type LinuxDesktopEnvironment = 'sway' | 'gnome' | 'kde' | 'unknown';

const detectWaylandDesktopEnvironment = (): LinuxDesktopEnvironment => {
  const desktopInfo = [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
  ]
    .filter(Boolean)
    .join(':')
    .toLowerCase();

  if (desktopInfo.includes('sway') || !!process.env.SWAYSOCK) {
    return 'sway';
  }
  if (desktopInfo.includes('gnome')) {
    return 'gnome';
  }
  if (desktopInfo.includes('kde') || desktopInfo.includes('plasma')) {
    return 'kde';
  }

  return 'unknown';
};

const getFrontmostAppLinuxWayland = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const desktop = detectWaylandDesktopEnvironment();
  debugLog(`linux.wayland: desktop detected as ${desktop}`, debug);

  if (desktop === 'sway') {
    const swayResult = await getFrontmostAppWaylandSway(debug, shellRunner);
    if (swayResult) {
      return swayResult;
    }
  }

  if (desktop === 'gnome') {
    const gnomeResult = await getFrontmostAppWaylandGnome(debug, shellRunner);
    if (gnomeResult) {
      return gnomeResult;
    }
  }

  if (desktop === 'kde') {
    const kdeResult = await getFrontmostAppWaylandKde(debug, shellRunner);
    if (kdeResult) {
      return kdeResult;
    }
  }

  const swayResult = await getFrontmostAppWaylandSway(debug, shellRunner);
  if (swayResult) {
    return swayResult;
  }

  const gnomeResult = await getFrontmostAppWaylandGnome(debug, shellRunner);
  if (gnomeResult) {
    return gnomeResult;
  }

  return await getFrontmostAppWaylandKde(debug, shellRunner);
};

/**
 * Get the focused Linux app/window name via X11 or Wayland fallback chain.
 */
const getFrontmostAppLinux = async (debug = false, shellRunner?: ShellRunner): Promise<string | null> => {
  const sessionType = getLinuxSessionType();
  debugLog(`linux: session type detected as ${sessionType}`, debug);

  if (sessionType === 'x11') {
    return await getFrontmostAppLinuxX11(debug, shellRunner);
  }

  if (sessionType === 'wayland') {
    return await getFrontmostAppLinuxWayland(debug, shellRunner);
  }

  if (sessionType === 'tty') {
    debugLog('linux: tty session - no focus window available', debug);
    return null;
  }

  const x11Result = await getFrontmostAppLinuxX11(debug, shellRunner);
  if (x11Result) {
    return x11Result;
  }

  return await getFrontmostAppLinuxWayland(debug, shellRunner);
};

/**
 * Check if the frontmost app is a known terminal on macOS.
 *
 * @param appName - The frontmost application name
 * @param debug - Enable debug logging
 * @returns True if the app is a known terminal
 */
const isKnownTerminal = (
  appName: string | null,
  knownTerminals: readonly string[],
  debug = false,
  useDetectedTerminal = true,
): boolean => {
  if (!appName) return false;

  const normalizedAppName = normalizeTerminalName(appName);

  // Direct match
  if (knownTerminals.some((t) => normalizeTerminalName(t) === normalizedAppName)) {
    debugLog(`"${appName}" is a known terminal (direct match)`, debug);
    return true;
  }

  // Partial match (for apps like "iTerm2" matching "iTerm"). Skip generic names
  // like "code" so unrelated editor/process names do not become false positives.
  if (
    knownTerminals.some((t) => {
      const normalizedTerminal = normalizeTerminalName(t);
      return normalizedTerminal !== 'code' && normalizedAppName.includes(normalizedTerminal);
    })
  ) {
    debugLog(`"${appName}" is a known terminal (partial match)`, debug);
    return true;
  }

  // Check if the detected terminal from detect-terminal matches
  if (useDetectedTerminal) {
    const detectedTerminal = getTerminalName(debug);
    if (detectedTerminal && normalizedAppName.includes(normalizeTerminalName(detectedTerminal))) {
      debugLog(`"${appName}" matches detected terminal "${detectedTerminal}"`, debug);
      return true;
    }
  }

  debugLog(`"${appName}" is NOT a known terminal`, debug);
  return false;
};

// ========================================
// MAIN FOCUS DETECTION FUNCTION
// ========================================

/**
 * Check if the OpenCode terminal is currently focused.
 *
 * This function detects whether the user is currently looking at the terminal
 * where OpenCode is running. Used to suppress notifications when the user
 * is already paying attention to the terminal.
 *
 * Platform behavior:
 * - macOS: Uses AppleScript to check the frontmost application
 * - Windows: Uses PowerShell to check focused window process name
 * - Linux: Uses X11/Wayland specific focus detection commands
 *
 * Results are cached for 500ms to avoid excessive system calls.
 *
 * @param options - Options
 * @returns True if terminal is focused, false otherwise
 *
 * @example
 * const focused = await isTerminalFocused({ debugLog: true });
 * if (focused) {
 *   console.log('User is looking at the terminal - skip notification');
 * }
 */
export const isTerminalFocused = async (options: TerminalFocusOptions = {}): Promise<boolean> => {
  const debug = options?.debugLog || false;
  const now = Date.now();

  // Check cache first
  if (now - focusCache.timestamp < CACHE_TTL_MS) {
    debugLog(`Using cached focus result: ${focusCache.isFocused}`, debug);
    return focusCache.isFocused;
  }

  const platform = getPlatform();

  // Platform-specific implementation
  if (platform === 'darwin') {
    try {
      const frontmostApp = await getFrontmostAppMacOS(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostApp, KNOWN_TERMINALS_MACOS, debug);

      // Update cache
      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostApp,
      };

      debugLog(`Focus detection complete: ${isFocused} (frontmost: "${frontmostApp}")`, debug);
      return isFocused;
    } catch (error) {
      debugLog(`Focus detection error: ${getErrorMessage(error)}`, debug);
      // On error, assume not focused (fail open - still notify)
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  if (platform === 'win32') {
    try {
      const frontmostProcess = await getFrontmostAppWindows(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostProcess, KNOWN_TERMINALS_WINDOWS, debug, false);

      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostProcess,
      };

      debugLog(
        `Focus detection complete: ${isFocused} (frontmost process: "${frontmostProcess}")`,
        debug,
      );
      return isFocused;
    } catch (error) {
      debugLog(`Windows focus detection error: ${getErrorMessage(error)}`, debug);
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  if (platform === 'linux') {
    try {
      const frontmostApp = await getFrontmostAppLinux(debug, options.shellRunner);
      const isFocused = isKnownTerminal(frontmostApp, KNOWN_TERMINALS_LINUX, debug);

      focusCache = {
        isFocused,
        timestamp: now,
        terminalName: frontmostApp,
      };

      debugLog(`Focus detection complete: ${isFocused} (frontmost app: "${frontmostApp}")`, debug);
      return isFocused;
    } catch (error) {
      debugLog(`Linux focus detection error: ${getErrorMessage(error)}`, debug);
      focusCache = {
        isFocused: false,
        timestamp: now,
        terminalName: null,
      };
      return false;
    }
  }

  // Other platforms: Not supported
  debugLog(`Focus detection not supported on platform: ${platform}`, debug);

  // Cache the result even for unsupported platforms
  focusCache = {
    isFocused: false,
    timestamp: now,
    terminalName: null,
  };

  return false;
};

/**
 * Clear the focus detection cache.
 * Useful for testing or when forcing a fresh check.
 */
export const clearFocusCache = (): void => {
  focusCache = {
    isFocused: false,
    timestamp: 0,
    terminalName: null,
  };
};

/**
 * Reset the terminal detection cache.
 * Useful for testing.
 */
export const resetTerminalDetection = (): void => {
  cachedTerminalName = null;
  terminalDetectionAttempted = false;
};

/**
 * Get the current cache state.
 * Useful for testing and debugging.
 */
export const getCacheState = (): FocusCacheState => ({ ...focusCache });

// Default export for convenience
export default {
  isTerminalFocused,
  isFocusDetectionSupported,
  getTerminalName,
  getPlatform,
  clearFocusCache,
  resetTerminalDetection,
  getCacheState,
  KNOWN_TERMINALS_MACOS,
  KNOWN_TERMINALS_WINDOWS,
  KNOWN_TERMINALS_LINUX,
};
