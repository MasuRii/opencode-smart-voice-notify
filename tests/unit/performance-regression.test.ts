// @ts-nocheck
/**
 * Red-Phase TDD Tests: Performance Regression - Config & TTS Re-creation
 *
 * Root cause: The event handler in src/index.ts reloads config from disk
 * and recreates the TTS instance on EVERY event:
 *
 *   event: async ({ event }) => {
 *     config = getTTSConfig();        // reads config file from disk
 *     tts = createTTS({ $, client }); // creates new TTS instance
 *     ...
 *   }
 *
 * This means each session.idle, permission.asked, etc. event triggers:
 * 1. A filesystem read of the JSONC config file
 * 2. JSONC parsing + deep merge with defaults
 * 3. New TTS instance construction (with internal config re-read)
 *
 * Under heavy event load (e.g., 20+ events/sec from fast LLM output),
 * this causes significant throughput degradation.
 *
 * Expected fix: Cache config and TTS instance at plugin scope,
 * only recreate when config file changes (e.g., via fs.watch or TTL).
 *
 * These tests verify that the current implementation DOES re-create
 * config and TTS on every event (which is the bug). When the fix is
 * applied, the config and TTS creation calls should be cached.
 *
 * @see src/index.ts (event handler, lines ~1095-1098)
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

// ============================================================
// MODULE-LEVEL CALL TRACKING
// We mock ../../src/util/tts.js to intercept getTTSConfig and
// createTTS calls while preserving the real implementations.
// ============================================================

let configLoadCount = 0;
let ttsCreateCount = 0;
let realGetTTSConfig: (() => unknown) | null = null;
let realCreateTTS: ((...args: unknown[]) => unknown) | null = null;

mock.module('../../src/util/tts.js', () => {
  // Capture the real module lazily (resolved after mock registration)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = require('../../src/util/tts.js') as Record<string, unknown>;

  realGetTTSConfig = actual.getTTSConfig as () => unknown;
  realCreateTTS = actual.createTTS as (...args: unknown[]) => unknown;

  return {
    ...actual,
    getTTSConfig: () => {
      configLoadCount++;
      return realGetTTSConfig();
    },
    createTTS: (...args: unknown[]) => {
      ttsCreateCount++;
      return realCreateTTS(...args);
    },
  };
});

// Import plugin AFTER module mock is registered
import SmartVoiceNotifyPlugin from '../../src/index.js';

describe('Performance Regression - Config & TTS Re-creation', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockShell: ReturnType<typeof createMockShellRunner>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTestTempDir();
    createTestAssets();
    mockClient = createMockClient();
    mockShell = createMockShellRunner();
    configLoadCount = 0;
    ttsCreateCount = 0;
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // HELPER: Initialize plugin with minimal config
  // ============================================================

  const initPlugin = async (overrides = {}) => {
    createTestConfig(
      createMinimalConfig({
        enabled: true,
        enableSound: false,  // Disable sound to isolate config/TTS overhead
        enableToast: false,
        enableDesktopNotification: false,
        enableWebhook: false,
        enableTTSReminder: false,
        enableAIMessages: false,
        enableIdleNotification: true,
        enableErrorNotification: true,
        enablePermissionNotification: true,
        enableQuestionNotification: true,
        debugLog: false,
        ...overrides,
      }),
    );

    // Reset counters after config creation (before plugin init)
    configLoadCount = 0;
    ttsCreateCount = 0;

    return SmartVoiceNotifyPlugin({
      project: { id: 'perf-test-project' },
      client: mockClient,
      $: mockShell,
      directory: tempDir,
      worktree: tempDir,
    });
  };

  // ============================================================
  // CONFIG RE-LOADING TESTS
  // ============================================================

  describe('Config re-loading on every event', () => {
    test('should NOT reload config from disk on every session.idle event', async () => {
      const plugin = await initPlugin();

      // Fire first session.idle event
      mockClient.session.setMockSession('session-1', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-1') });

      const firstEventConfigLoads = configLoadCount;

      // Fire second session.idle event (different session to avoid debounce)
      mockClient.session.setMockSession('session-2', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-2') });

      const secondEventConfigLoads = configLoadCount;

      // BUG: Config is re-loaded on every event.
      // The test asserts that config load count should NOT increase per event.
      // Currently FAILS because getTTSConfig() is called in the event handler.
      //
      // Expected after fix: configLoadCount stays the same (config is cached)
      // Current behavior: configLoadCount increases by 1 per event
      expect(secondEventConfigLoads).toBe(firstEventConfigLoads);
    });

    test('should NOT reload config from disk on every permission.asked event', async () => {
      const plugin = await initPlugin();

      // Fire first permission event
      await plugin.event({ event: mockEvents.permissionAsked('perm-1') });
      const firstEventConfigLoads = configLoadCount;

      // Fire second permission event
      await plugin.event({ event: mockEvents.permissionAsked('perm-2') });
      const secondEventConfigLoads = configLoadCount;

      // BUG: Config is re-loaded on every event
      expect(secondEventConfigLoads).toBe(firstEventConfigLoads);
    });

    test('should NOT reload config from disk on every question.asked event', async () => {
      const plugin = await initPlugin();

      // Fire first question event
      await plugin.event({ event: mockEvents.questionAsked('q-1') });
      const firstEventConfigLoads = configLoadCount;

      // Fire second question event
      await plugin.event({ event: mockEvents.questionAsked('q-2') });
      const secondEventConfigLoads = configLoadCount;

      // BUG: Config is re-loaded on every event
      expect(secondEventConfigLoads).toBe(firstEventConfigLoads);
    });

    test('should NOT reload config from disk on message.updated events', async () => {
      const plugin = await initPlugin();

      // Fire first message event
      await plugin.event({ event: mockEvents.messageUpdated('msg-1', 'user') });
      const firstEventConfigLoads = configLoadCount;

      // Fire second message event
      await plugin.event({ event: mockEvents.messageUpdated('msg-2', 'assistant') });
      const secondEventConfigLoads = configLoadCount;

      // BUG: Even passive events like message.updated reload config
      expect(secondEventConfigLoads).toBe(firstEventConfigLoads);
    });

    test('config reload count remains constant with event count', async () => {
      const plugin = await initPlugin();
      const eventCount = 5;

      // Fire N session.idle events with distinct session IDs (avoid debounce)
      for (let i = 0; i < eventCount; i++) {
        const sessionId = `session-${i}`;
        mockClient.session.setMockSession(sessionId, { parentID: null });
        await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      }

      // Config should be loaded once during plugin initialization, then reused.
      // If this grows with eventCount, high-volume event streams will re-read
      // JSONC from disk and regress model throughput.
      expect(configLoadCount).toBe(1);
    });
  });

  // ============================================================
  // TTS INSTANCE RE-CREATION TESTS
  // ============================================================

  describe('TTS instance re-creation on every event', () => {
    test('should NOT recreate TTS instance on every session.idle event', async () => {
      const plugin = await initPlugin();

      // Fire first session.idle event
      mockClient.session.setMockSession('session-1', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-1') });

      const firstEventTTSCreates = ttsCreateCount;

      // Fire second session.idle event
      mockClient.session.setMockSession('session-2', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-2') });

      const secondEventTTSCreates = ttsCreateCount;

      // BUG: TTS is recreated on every event.
      // Expected after fix: ttsCreateCount stays the same (instance cached)
      expect(secondEventTTSCreates).toBe(firstEventTTSCreates);
    });

    test('should NOT recreate TTS instance on every permission.asked event', async () => {
      const plugin = await initPlugin();

      await plugin.event({ event: mockEvents.permissionAsked('perm-1') });
      const firstEventTTSCreates = ttsCreateCount;

      await plugin.event({ event: mockEvents.permissionAsked('perm-2') });
      const secondEventTTSCreates = ttsCreateCount;

      // BUG: TTS is recreated on every event
      expect(secondEventTTSCreates).toBe(firstEventTTSCreates);
    });

    test('TTS creation count should be constant after initial load', async () => {
      const plugin = await initPlugin();
      const eventCount = 5;

      for (let i = 0; i < eventCount; i++) {
        const sessionId = `session-${i}`;
        mockClient.session.setMockSession(sessionId, { parentID: null });
        await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      }

      // After fix: TTS instance is cached, only created once (during plugin init).
      // Currently FAILS: ttsCreateCount is 6 (one per event + 1 during init)
      expect(ttsCreateCount).toBe(1);
    });
  });

  // ============================================================
  // COMBINED OVERHEAD TEST
  // ============================================================

  describe('Combined config + TTS overhead per event', () => {
    test('config should only be loaded once during plugin lifetime', async () => {
      const plugin = await initPlugin();

      // Fire 3 events
      for (let i = 0; i < 3; i++) {
        const sessionId = `session-${i}`;
        mockClient.session.setMockSession(sessionId, { parentID: null });
        await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      }

      // After fix: config is loaded once during plugin init and cached.
      // Currently FAILS: configLoadCount is 8 (2 per event: event handler + createTTS)
      expect(configLoadCount).toBe(1);
      // After fix: TTS instance is created once during plugin init.
      // Currently FAILS: ttsCreateCount is 4 (1 per event + 1 init)
      expect(ttsCreateCount).toBe(1);
    });

    test('session.error event also triggers config load and TTS creation', async () => {
      const plugin = await initPlugin();

      await plugin.event({ event: mockEvents.sessionError('session-err-1') });

      // At minimum, 1 config load and 1 TTS creation occurred
      expect(configLoadCount).toBeGreaterThanOrEqual(1);
      expect(ttsCreateCount).toBeGreaterThanOrEqual(1);
    });
  });
});
