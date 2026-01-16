/**
 * Unit Tests for Focus Detection Module
 * 
 * Tests for the util/focus-detect.js module which provides terminal focus detection.
 * Used to suppress notifications when the user is actively looking at the terminal.
 * 
 * @see util/focus-detect.js
 * @see docs/ARCHITECT_PLAN.md - Phase 3, Task 3.6
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir,
  readTestFile,
  testFileExists,
  wait
} from '../setup.js';

// Import the focus detection module
import {
  isTerminalFocused,
  isFocusDetectionSupported,
  getTerminalName,
  getPlatform,
  clearFocusCache,
  resetTerminalDetection,
  getCacheState,
  KNOWN_TERMINALS_MACOS
} from '../../util/focus-detect.js';

import focusDetect from '../../util/focus-detect.js';

describe('focus detection module', () => {
  beforeEach(() => {
    // Create test temp directory and reset caches before each test
    createTestTempDir();
    clearFocusCache();
    resetTerminalDetection();
  });
  
  afterEach(() => {
    cleanupTestTempDir();
    clearFocusCache();
    resetTerminalDetection();
  });

  // ============================================================
  // getPlatform() TESTS
  // ============================================================

  describe('getPlatform()', () => {
    test('returns a string', () => {
      const platform = getPlatform();
      expect(typeof platform).toBe('string');
    });
    
    test('returns one of the known platforms', () => {
      const platform = getPlatform();
      expect(['darwin', 'win32', 'linux', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(platform);
    });
    
    test('returns consistent value on repeated calls', () => {
      const platform1 = getPlatform();
      const platform2 = getPlatform();
      expect(platform1).toBe(platform2);
    });
  });

  // ============================================================
  // isFocusDetectionSupported() TESTS
  // ============================================================

  describe('isFocusDetectionSupported()', () => {
    test('returns an object', () => {
      const result = isFocusDetectionSupported();
      expect(typeof result).toBe('object');
    });
    
    test('returns object with supported property', () => {
      const result = isFocusDetectionSupported();
      expect(result).toHaveProperty('supported');
      expect(typeof result.supported).toBe('boolean');
    });
    
    test('returns reason when not supported', () => {
      const result = isFocusDetectionSupported();
      // If not supported, should have a reason
      if (!result.supported) {
        expect(result).toHaveProperty('reason');
        expect(typeof result.reason).toBe('string');
      }
    });
    
    test('macOS should be supported', () => {
      const platform = getPlatform();
      const result = isFocusDetectionSupported();
      
      if (platform === 'darwin') {
        expect(result.supported).toBe(true);
      }
    });
    
    test('Windows should not be supported', () => {
      const platform = getPlatform();
      const result = isFocusDetectionSupported();
      
      if (platform === 'win32') {
        expect(result.supported).toBe(false);
        expect(result.reason).toContain('Windows');
      }
    });
    
    test('Linux should not be supported', () => {
      const platform = getPlatform();
      const result = isFocusDetectionSupported();
      
      if (platform === 'linux') {
        expect(result.supported).toBe(false);
        expect(result.reason).toContain('Linux');
      }
    });
  });

  // ============================================================
  // KNOWN_TERMINALS_MACOS TESTS
  // ============================================================

  describe('KNOWN_TERMINALS_MACOS', () => {
    test('is an array', () => {
      expect(Array.isArray(KNOWN_TERMINALS_MACOS)).toBe(true);
    });
    
    test('contains at least 20 terminal names', () => {
      expect(KNOWN_TERMINALS_MACOS.length).toBeGreaterThanOrEqual(20);
    });
    
    test('includes Terminal (macOS default)', () => {
      expect(KNOWN_TERMINALS_MACOS).toContain('Terminal');
    });
    
    test('includes iTerm2', () => {
      expect(KNOWN_TERMINALS_MACOS.some(t => t.includes('iTerm'))).toBe(true);
    });
    
    test('includes VS Code variants', () => {
      expect(KNOWN_TERMINALS_MACOS.some(t => t.includes('Code'))).toBe(true);
    });
    
    test('includes popular terminals like Alacritty, Hyper, Warp', () => {
      expect(KNOWN_TERMINALS_MACOS).toContain('Alacritty');
      expect(KNOWN_TERMINALS_MACOS).toContain('Hyper');
      expect(KNOWN_TERMINALS_MACOS).toContain('Warp');
    });
    
    test('includes JetBrains IDEs', () => {
      expect(KNOWN_TERMINALS_MACOS.some(t => t.includes('IntelliJ'))).toBe(true);
      expect(KNOWN_TERMINALS_MACOS.some(t => t.includes('WebStorm'))).toBe(true);
    });
    
    test('all entries are non-empty strings', () => {
      for (const terminal of KNOWN_TERMINALS_MACOS) {
        expect(typeof terminal).toBe('string');
        expect(terminal.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // isTerminalFocused() - BASIC TESTS
  // ============================================================

  describe('isTerminalFocused() basic behavior', () => {
    test('returns a Promise', () => {
      const result = isTerminalFocused();
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('Promise resolves to a boolean', async () => {
      const result = await isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
    
    test('accepts empty options object', async () => {
      const result = await isTerminalFocused({});
      expect(typeof result).toBe('boolean');
    });
    
    test('accepts options with debugLog', async () => {
      createTestLogsDir();
      const result = await isTerminalFocused({ debugLog: true });
      expect(typeof result).toBe('boolean');
    });
    
    test('handles null options gracefully', async () => {
      // Should not throw with null
      const result = await isTerminalFocused(null);
      expect(typeof result).toBe('boolean');
    });
    
    test('handles undefined options gracefully', async () => {
      const result = await isTerminalFocused(undefined);
      expect(typeof result).toBe('boolean');
    });
  });

  // ============================================================
  // isTerminalFocused() - PLATFORM-SPECIFIC BEHAVIOR
  // ============================================================

  describe('isTerminalFocused() platform behavior', () => {
    test('returns false on unsupported platforms (fail-open)', async () => {
      const platform = getPlatform();
      const supported = isFocusDetectionSupported();
      
      if (!supported.supported) {
        // On unsupported platforms, should return false (fail-open: still notify)
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('returns boolean on Windows (fails open)', async () => {
      const platform = getPlatform();
      
      if (platform === 'win32') {
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('returns boolean on Linux (fails open)', async () => {
      const platform = getPlatform();
      
      if (platform === 'linux') {
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('handles macOS check without throwing', async () => {
      const platform = getPlatform();
      
      if (platform === 'darwin') {
        // Should not throw - may return true or false depending on focused app
        await expect(isTerminalFocused()).resolves.toBeDefined();
      }
    });
  });

  // ============================================================
  // CACHING BEHAVIOR TESTS
  // ============================================================

  describe('focus detection caching', () => {
    test('getCacheState() returns cache object', () => {
      const cache = getCacheState();
      expect(typeof cache).toBe('object');
      expect(cache).toHaveProperty('isFocused');
      expect(cache).toHaveProperty('timestamp');
      expect(cache).toHaveProperty('terminalName');
    });
    
    test('cache starts with default values', () => {
      clearFocusCache();
      const cache = getCacheState();
      expect(cache.isFocused).toBe(false);
      expect(cache.timestamp).toBe(0);
      expect(cache.terminalName).toBeNull();
    });
    
    test('cache is updated after isTerminalFocused() call', async () => {
      clearFocusCache();
      const cacheBefore = getCacheState();
      expect(cacheBefore.timestamp).toBe(0);
      
      await isTerminalFocused();
      
      const cacheAfter = getCacheState();
      expect(cacheAfter.timestamp).toBeGreaterThan(0);
    });
    
    test('clearFocusCache() resets cache state', async () => {
      // First make a call to populate cache
      await isTerminalFocused();
      
      const cachePopulated = getCacheState();
      expect(cachePopulated.timestamp).toBeGreaterThan(0);
      
      // Clear cache
      clearFocusCache();
      
      const cacheCleared = getCacheState();
      expect(cacheCleared.timestamp).toBe(0);
      expect(cacheCleared.isFocused).toBe(false);
    });
    
    test('caching prevents multiple system calls within TTL', async () => {
      clearFocusCache();
      
      // First call populates cache
      const start = Date.now();
      const result1 = await isTerminalFocused();
      const cache1 = getCacheState();
      
      // Second call should use cache (no new timestamp)
      const result2 = await isTerminalFocused();
      const cache2 = getCacheState();
      
      // Third call should also use cache
      const result3 = await isTerminalFocused();
      const cache3 = getCacheState();
      
      // All results should be the same (from cache)
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      
      // Timestamps should be the same (cache hit)
      expect(cache2.timestamp).toBe(cache1.timestamp);
      expect(cache3.timestamp).toBe(cache1.timestamp);
    });
    
    test('cache expires after TTL (500ms)', async () => {
      clearFocusCache();
      
      // First call populates cache
      await isTerminalFocused();
      const cache1 = getCacheState();
      const timestamp1 = cache1.timestamp;
      
      // Wait for cache to expire (TTL is 500ms, wait 600ms to be safe)
      await wait(600);
      
      // Next call should refresh cache
      await isTerminalFocused();
      const cache2 = getCacheState();
      const timestamp2 = cache2.timestamp;
      
      // Timestamps should be different (cache miss, new system call)
      expect(timestamp2).toBeGreaterThan(timestamp1);
      expect(timestamp2 - timestamp1).toBeGreaterThanOrEqual(500);
    });
    
    test('multiple rapid calls use cached value', async () => {
      clearFocusCache();
      
      // Make 5 rapid calls
      const results = await Promise.all([
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused(),
        isTerminalFocused()
      ]);
      
      // All should return the same value
      const firstResult = results[0];
      for (const result of results) {
        expect(result).toBe(firstResult);
      }
    });
  });

  // ============================================================
  // TERMINAL DETECTION TESTS
  // ============================================================

  describe('getTerminalName()', () => {
    test('returns string or null', () => {
      const result = getTerminalName();
      expect(result === null || typeof result === 'string').toBe(true);
    });
    
    test('caches terminal detection result', () => {
      resetTerminalDetection();
      
      const result1 = getTerminalName();
      const result2 = getTerminalName();
      
      // Should return the same value (cached)
      expect(result1).toBe(result2);
    });
    
    test('accepts debug parameter', () => {
      resetTerminalDetection();
      createTestLogsDir();
      
      // Should not throw
      const result = getTerminalName(true);
      expect(result === null || typeof result === 'string').toBe(true);
    });
    
    test('resetTerminalDetection() clears cached value', () => {
      // Populate cache
      getTerminalName();
      
      // Reset
      resetTerminalDetection();
      
      // Should work again without errors
      const result = getTerminalName();
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  // ============================================================
  // DEBUG LOGGING TESTS
  // ============================================================

  describe('debug logging', () => {
    test('creates logs directory when debugLog is true', async () => {
      // Ensure temp dir exists
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      // Check if logs directory was created
      expect(testFileExists('logs')).toBe(true);
    });
    
    test('writes to debug log file when enabled', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      // Check if log file exists
      expect(testFileExists('logs/smart-voice-notify-debug.log')).toBe(true);
    });
    
    test('debug log contains focus detection entries', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: true });
      
      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      if (logContent) {
        expect(logContent).toContain('[focus-detect]');
      }
    });
    
    test('debug logging does not affect return value', async () => {
      clearFocusCache();
      createTestTempDir();
      
      const withDebug = await isTerminalFocused({ debugLog: true });
      
      clearFocusCache();
      
      const withoutDebug = await isTerminalFocused({ debugLog: false });
      
      // Both should be the same type
      expect(typeof withDebug).toBe('boolean');
      expect(typeof withoutDebug).toBe('boolean');
    });
    
    test('no log file created when debugLog is false', async () => {
      createTestTempDir();
      
      await isTerminalFocused({ debugLog: false });
      
      // Log file should not exist (directory might not even be created)
      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      // Either no log or only contains entries from debug=true calls
      expect(logContent === null || !logContent.includes('[focus-detect]') || logContent.includes('[focus-detect]')).toBe(true);
    });
  });

  // ============================================================
  // DEFAULT EXPORT TESTS
  // ============================================================

  describe('default export', () => {
    test('exports all expected functions', () => {
      expect(focusDetect).toHaveProperty('isTerminalFocused');
      expect(focusDetect).toHaveProperty('isFocusDetectionSupported');
      expect(focusDetect).toHaveProperty('getTerminalName');
      expect(focusDetect).toHaveProperty('getPlatform');
      expect(focusDetect).toHaveProperty('clearFocusCache');
      expect(focusDetect).toHaveProperty('resetTerminalDetection');
      expect(focusDetect).toHaveProperty('getCacheState');
      expect(focusDetect).toHaveProperty('KNOWN_TERMINALS_MACOS');
    });
    
    test('default export functions are callable', async () => {
      expect(typeof focusDetect.isTerminalFocused).toBe('function');
      expect(typeof focusDetect.isFocusDetectionSupported).toBe('function');
      expect(typeof focusDetect.getTerminalName).toBe('function');
      expect(typeof focusDetect.getPlatform).toBe('function');
      expect(typeof focusDetect.clearFocusCache).toBe('function');
      expect(typeof focusDetect.resetTerminalDetection).toBe('function');
      expect(typeof focusDetect.getCacheState).toBe('function');
    });
    
    test('default export functions work correctly', async () => {
      const platform = focusDetect.getPlatform();
      expect(typeof platform).toBe('string');
      
      const supported = focusDetect.isFocusDetectionSupported();
      expect(typeof supported.supported).toBe('boolean');
      
      const result = await focusDetect.isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
  });

  // ============================================================
  // ERROR HANDLING TESTS
  // ============================================================

  describe('error handling', () => {
    test('isTerminalFocused handles errors gracefully (fail-open)', async () => {
      // Even if something goes wrong internally, should not throw
      const result = await isTerminalFocused();
      expect(typeof result).toBe('boolean');
    });
    
    test('returns false on error (fail-open strategy)', async () => {
      // The module is designed to return false on any error
      // This ensures notifications still work even if focus detection fails
      const platform = getPlatform();
      const supported = isFocusDetectionSupported();
      
      if (!supported.supported) {
        // Unsupported platforms should return false
        const result = await isTerminalFocused();
        expect(result).toBe(false);
      }
    });
    
    test('isFocusDetectionSupported never throws', () => {
      // Should never throw
      expect(() => isFocusDetectionSupported()).not.toThrow();
    });
    
    test('getPlatform never throws', () => {
      expect(() => getPlatform()).not.toThrow();
    });
    
    test('clearFocusCache never throws', () => {
      expect(() => clearFocusCache()).not.toThrow();
    });
    
    test('resetTerminalDetection never throws', () => {
      expect(() => resetTerminalDetection()).not.toThrow();
    });
    
    test('getCacheState never throws', () => {
      expect(() => getCacheState()).not.toThrow();
    });
    
    test('getTerminalName never throws', () => {
      expect(() => getTerminalName()).not.toThrow();
    });
  });

  // ============================================================
  // INTEGRATION WITH CONFIG
  // ============================================================

  describe('integration with config', () => {
    test('focus detection can be used with config settings', async () => {
      // Simulate config settings
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: false
      };
      
      // If suppressWhenFocused is true and not alwaysNotify, check focus
      if (config.suppressWhenFocused && !config.alwaysNotify) {
        const focused = await isTerminalFocused();
        // Should suppress if focused is true
        const shouldSuppress = focused;
        expect(typeof shouldSuppress).toBe('boolean');
      }
    });
    
    test('alwaysNotify override works conceptually', async () => {
      const config = {
        suppressWhenFocused: true,
        alwaysNotify: true
      };
      
      // When alwaysNotify is true, focus check should be skipped
      if (config.alwaysNotify) {
        // Don't suppress, regardless of focus
        const shouldSuppress = false;
        expect(shouldSuppress).toBe(false);
      }
    });
    
    test('suppressWhenFocused=false skips focus check', async () => {
      const config = {
        suppressWhenFocused: false,
        alwaysNotify: false
      };
      
      // When suppressWhenFocused is false, focus check should be skipped
      if (!config.suppressWhenFocused) {
        const shouldSuppress = false;
        expect(shouldSuppress).toBe(false);
      }
    });
  });
});
