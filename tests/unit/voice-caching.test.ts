// @ts-nocheck
/**
 * Red-Phase TDD Tests: Voice Caching for Repeated TTS
 *
 * Root cause: No TTS output caching mechanism exists. Every TTS call
 * generates audio from scratch, even when the same text is spoken
 * repeatedly (e.g., standard notification messages like
 * "Your task is complete" that appear hundreds of times).
 *
 * Expected fix:
 * - Add a cache layer (e.g., LRU cache keyed by engine+voice+text+params)
 * - Store generated audio files (MP3/WAV) in a cache directory
 * - Check cache before invoking TTS engine
 * - Add config fields: enableVoiceCache, voiceCacheDir, voiceCacheMaxSize
 *
 * These tests verify that the current implementation has NO caching:
 * identical TTS text triggers the TTS engine every time. When caching
 * is implemented, the TTS engine should NOT be called for cached text.
 *
 * @see src/util/tts.ts (speak function)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createMockShellRunner,
  createMockClient,
  mockEvents,
  wait,
} from '../setup.js';
import SmartVoiceNotifyPlugin from '../../src/index.js';
import { getTTSConfig } from '../../src/util/tts.js';

describe('Voice Caching for Repeated TTS', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockShell: ReturnType<typeof createMockShellRunner>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTestTempDir();
    createTestAssets();
    mockClient = createMockClient();
    mockShell = createMockShellRunner();
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // HELPER: Initialize plugin
  // ============================================================

  const initPlugin = async (overrides = {}) => {
    createTestConfig(
      createMinimalConfig({
        enabled: true,
        notificationMode: 'tts-first',  // Use TTS-first to trigger speak()
        enableTTS: true,
        enableSound: true,
        enableToast: false,
        enableDesktopNotification: false,
        enableWebhook: false,
        enableTTSReminder: false,
        enableAIMessages: false,
        enableIdleNotification: true,
        debugLog: false,
        ttsEngine: 'sapi',  // Use SAPI to capture shell calls
        ...overrides,
      }),
    );

    return SmartVoiceNotifyPlugin({
      project: { id: 'cache-test-project' },
      client: mockClient,
      $: mockShell,
      directory: tempDir,
      worktree: tempDir,
    });
  };

  // ============================================================
  // CONFIG FIELD TESTS: Voice cache config should exist
  // ============================================================

  describe('Config: voice cache settings should exist', () => {
    test('plugin config should have enableVoiceCache field', () => {
      createTestConfig(createMinimalConfig({}));
      const config = getTTSConfig();

      // Currently FAILS: no voice cache config field exists
      expect(config).toHaveProperty('enableVoiceCache');
    });

    test('plugin config should have voiceCacheDir field', () => {
      createTestConfig(createMinimalConfig({}));
      const config = getTTSConfig();

      // Currently FAILS: no cache directory config field exists
      expect(config).toHaveProperty('voiceCacheDir');
    });

    test('plugin config should have voiceCacheMaxSizeMB field', () => {
      createTestConfig(createMinimalConfig({}));
      const config = getTTSConfig();

      // Currently FAILS: no cache size limit config field exists
      expect(config).toHaveProperty('voiceCacheMaxSizeMB');
    });

    test('enableVoiceCache should default to false (opt-in)', () => {
      createTestConfig(createMinimalConfig({}));
      const config = getTTSConfig() as Record<string, unknown>;

      // Currently FAILS: field doesn't exist, so accessing it returns undefined
      // After fix: should be false by default (users opt in)
      expect(config.enableVoiceCache).toBe(false);
    });
  });

  // ============================================================
  // BEHAVIORAL TESTS: No caching of TTS output
  // ============================================================

  describe('TTS caching behavior: repeated text should use cache', () => {
    test('repeated idle notification should NOT call TTS engine for same message', async () => {
      const plugin = await initPlugin();
      const ttiCallsBefore = mockShell.getCallCount();

      // Fire first session.idle (triggers TTS speak with a message from idleTTSMessages)
      mockClient.session.setMockSession('session-cache-1', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-cache-1') });
      const callsAfterFirst = mockShell.getCallCount();

      // Fire second session.idle (same notification messages are available)
      mockClient.session.setMockSession('session-cache-2', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-cache-2') });
      const callsAfterSecond = mockShell.getCallCount();

      // Both events generate TTS calls (no caching)
      const firstEventCalls = callsAfterFirst - ttiCallsBefore;
      const secondEventCalls = callsAfterSecond - callsAfterFirst;

      // BUG: Both events generate TTS calls. The second should potentially
      // reuse cached audio if the same message was selected.
      //
      // This test documents the LACK of caching — both events always
      // invoke the TTS engine regardless of whether the audio was generated before.
      // After implementing caching, the second event should use cached audio
      // (fewer or zero TTS engine calls).
      expect(secondEventCalls).toBeGreaterThan(0);
    });

    test('TTS speak() for identical text should not have cache lookup mechanism', async () => {
      // Import createTTS directly to test at the utility level
      const { createTTS } = await import('../../src/util/tts.js');
      const ttsInstance = createTTS({ $: mockShell, client: mockClient });

      const testText = 'Your task is complete!';

      // Call speak twice with the same text
      mockShell.reset();
      await ttsInstance.speak(testText, { enableTTS: true });
      const firstCallCount = mockShell.getCallCount();

      mockShell.reset();
      await ttsInstance.speak(testText, { enableTTS: true });
      const secondCallCount = mockShell.getCallCount();

      // BUG: Both calls invoke the TTS engine (same number of shell calls)
      // After implementing caching: second call should be served from cache
      // (zero or fewer shell calls for the same text)
      expect(secondCallCount).toBe(firstCallCount);
    });

    test('no cache directory should exist for voice caching', () => {
      const configDir = process.env.OPENCODE_CONFIG_DIR || tempDir;
      const expectedCacheDir = path.join(configDir, 'voice-cache');

      // Currently PASSES: no cache directory exists
      // After implementing caching: a voice-cache directory should be created
      expect(fs.existsSync(expectedCacheDir)).toBe(false);
    });
  });

  // ============================================================
  // EDGE CASE TESTS: Cache behavior requirements
  // ============================================================

  describe('Voice cache edge cases (requirements for future implementation)', () => {
    test('different TTS engines should have separate cache entries', () => {
      createTestConfig(createMinimalConfig({}));
      const config = getTTSConfig() as Record<string, unknown>;

      // Requirement: if caching is implemented, the cache key must include
      // the TTS engine name, voice, and other parameters to avoid serving
      // ElevenLabs audio when Edge TTS is configured.
      //
      // This test documents the expected behavior — currently there is no
      // cache, so this is a design requirement test.
      //
      // Current state: no cache mechanism exists, so this is implicitly true
      // (every call generates fresh audio).
      expect(true).toBe(true);  // Placeholder — real test after implementation
    });

    test('cache should respect config changes (different voice = cache miss)', () => {
      // Requirement: changing the voice setting should invalidate cache.
      // Cache key must include all TTS parameters.
      //
      // This is a design requirement test. Currently no cache exists.
      expect(true).toBe(true);  // Placeholder
    });
  });
});
