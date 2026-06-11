// @ts-nocheck
/**
 * Red-Phase TDD Tests: VS Code Focus Detection
 *
 * Root cause: KNOWN_TERMINALS_WINDOWS does not include VS Code process names
 * ("Code", "Code.exe", "Visual Studio Code") and KNOWN_TERMINALS_LINUX does
 * not include VS Code window classes. The detect-terminal package also does
 * not identify VS Code's integrated terminal.
 *
 * Expected fix:
 * - Add "Code", "Code.exe", "Visual Studio Code" to KNOWN_TERMINALS_WINDOWS
 * - Add "code" to KNOWN_TERMINALS_LINUX
 * - Optionally detect $TERM_PROGRAM=vscode as a known terminal indicator
 *
 * These tests verify that the focus detection module currently FAILS to
 * recognize VS Code terminals. When the fix is applied, all tests in
 * this file should pass.
 *
 * @see src/util/focus-detect.ts
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import os from 'os';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir,
  createMockShellRunner,
  wait,
} from '../setup.js';

import {
  isTerminalFocused,
  clearFocusCache,
  resetTerminalDetection,
  KNOWN_TERMINALS_WINDOWS,
  KNOWN_TERMINALS_LINUX,
  KNOWN_TERMINALS_MACOS,
} from '../../src/util/focus-detect.js';

describe('VS Code Focus Detection', () => {
  beforeEach(() => {
    createTestTempDir();
    createTestLogsDir();
    clearFocusCache();
    resetTerminalDetection();
  });

  afterEach(() => {
    cleanupTestTempDir();
    clearFocusCache();
    resetTerminalDetection();
  });

  // ============================================================
  // KNOWN_TERMINALS_WINDOWS: VS Code entries
  // ============================================================

  describe('KNOWN_TERMINALS_WINDOWS should include VS Code entries', () => {
    test('should include "Code" (VS Code main process name)', () => {
      // VS Code's main process is named "Code" (or "Code.exe" on Windows)
      // When running OpenCode inside VS Code's integrated terminal,
      // the focused process is "Code" — but this is NOT in the known list.
      expect(KNOWN_TERMINALS_WINDOWS).toContain('Code');
    });

    test('should include "Code.exe" (VS Code process with extension)', () => {
      // PowerShell may report the full name including .exe
      expect(KNOWN_TERMINALS_WINDOWS).toContain('Code.exe');
    });

    test('should include "Visual Studio Code" (window title on some systems)', () => {
      // Some focus detection methods return the window title rather than process name
      expect(KNOWN_TERMINALS_WINDOWS).toContain('Visual Studio Code');
    });

    test('should include "Code - Insiders" (VS Code Insiders edition)', () => {
      // VS Code Insiders has a different process name
      expect(KNOWN_TERMINALS_WINDOWS).toContain('Code - Insiders');
    });
  });

  describe('KNOWN_TERMINALS_LINUX should include VS Code entries', () => {
    test('should include "code" (VS Code WM_CLASS on Linux/X11)', () => {
      // On Linux, VS Code's WM_CLASS is "code" (lowercase)
      expect(KNOWN_TERMINALS_LINUX).toContain('code');
    });
  });

  describe('KNOWN_TERMINALS_MACOS should include VS Code entries', () => {
    test('should include "Visual Studio Code" (macOS app name)', () => {
      // On macOS, AppleScript reports VS Code as "Visual Studio Code"
      expect(KNOWN_TERMINALS_MACOS).toContain('Visual Studio Code');
    });
  });

  // ============================================================
  // INTEGRATION: isTerminalFocused with VS Code process names
  // ============================================================

  describe('isTerminalFocused() with VS Code process names (Windows)', () => {
    let platformSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('win32');
      clearFocusCache();
    });

    afterEach(() => {
      platformSpy.mockRestore();
      clearFocusCache();
    });

    test('should detect "Code" as a focused terminal', async () => {
      // Simulate PowerShell returning "Code" as the focused process
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Code\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });

      // Currently FAILS: "Code" is not in KNOWN_TERMINALS_WINDOWS
      // After fix: should return true
      expect(result).toBe(true);
    });

    test('should detect "Code.exe" as a focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Code.exe\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });

      // Currently FAILS: "Code.exe" is not in KNOWN_TERMINALS_WINDOWS
      // After normalization (remove .exe, lowercase) it becomes "code" — still not matched
      expect(result).toBe(true);
    });

    test('should detect "Code - Insiders" as a focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Code - Insiders\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });

      // Currently FAILS: "Code - Insiders" is not in KNOWN_TERMINALS_WINDOWS
      expect(result).toBe(true);
    });

    test('should detect "VSCodium" as a focused terminal', async () => {
      // VSCodium is the open-source build of VS Code
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('VSCodium\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });

      // Currently FAILS: "VSCodium" is not in KNOWN_TERMINALS_WINDOWS
      expect(result).toBe(true);
    });
  });

  describe('isTerminalFocused() with VS Code process names (macOS)', () => {
    let platformSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
      clearFocusCache();
    });

    afterEach(() => {
      platformSpy.mockRestore();
      clearFocusCache();
    });

    test('should detect "Visual Studio Code" as a focused terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('Visual Studio Code\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });

      // Currently FAILS: "Visual Studio Code" is not in KNOWN_TERMINALS_MACOS
      expect(result).toBe(true);
    });
  });

  describe('isTerminalFocused() with VS Code process names (Linux)', () => {
    let platformSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('linux');
      clearFocusCache();
    });

    afterEach(() => {
      platformSpy.mockRestore();
      clearFocusCache();
    });

    test('should detect "code" WM_CLASS as a focused terminal (X11)', async () => {
      const shellRunner = createMockShellRunner({
        handler: (command: string) => {
          // xdotool getwindowfocus getwindowclassname
          if (command.includes('xdotool')) {
            return {
              stdout: Buffer.from('code\n'),
              stderr: Buffer.from(''),
              exitCode: 0,
            };
          }
          // Other commands return empty
          return {
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
            exitCode: 0,
          };
        },
      });

      // Mock Linux session type as x11
      const envSpy = spyOn(process.env, 'DISPLAY' as never).mockReturnValue(':0' as never);

      try {
        const result = await isTerminalFocused({ shellRunner });

        // Currently FAILS: "code" is not in KNOWN_TERMINALS_LINUX
        expect(result).toBe(true);
      } finally {
        envSpy.mockRestore();
      }
    });
  });

  // ============================================================
  // NEGATIVE TESTS: Non-VS-Code processes should NOT match
  // ============================================================

  describe('Non-VS-Code processes should not be detected as terminals', () => {
    let platformSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      platformSpy = spyOn(os, 'platform').mockReturnValue('win32');
      clearFocusCache();
    });

    afterEach(() => {
      platformSpy.mockRestore();
      clearFocusCache();
    });

    test('"chrome" should NOT be detected as a terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('chrome\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('"explorer" should NOT be detected as a terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('explorer\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });

    test('"notepad++" should NOT be detected as a terminal', async () => {
      const shellRunner = createMockShellRunner({
        handler: () => ({
          stdout: Buffer.from('notepad++\n'),
          stderr: Buffer.from(''),
          exitCode: 0,
        }),
      });

      const result = await isTerminalFocused({ shellRunner });
      expect(result).toBe(false);
    });
  });
});
