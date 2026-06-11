// @ts-nocheck
/**
 * Red-Phase TDD Tests for Upstream SDK v2 Event Type Support
 *
 * The upstream @opencode-ai/plugin SDK v1.17.3 introduced v2 event formats:
 * - `permission.v2.asked` with { id, sessionID, action, resources, save?, metadata?, source? }
 * - `question.v2.asked` with { id, sessionID, questions: QuestionV2Info[], tool? }
 *
 * The plugin currently handles:
 * - `permission.asked` (v1 format with { id, sessionID, permission, patterns })
 * - `question.asked` (v1 format with { id, sessionID, questions: QuestionInfo[] })
 *
 * When OpenCode migrates to v2 event format, the plugin will silently ignore
 * these events (no notifications). The `(string & {})` escape hatch in
 * EventType allows v2 events to be dispatched without TypeScript errors,
 * but the event handler's `if (event.type === "permission.asked")` check
 * does NOT match "permission.v2.asked".
 *
 * Expected fix: Add handlers for `permission.v2.asked` and `question.v2.asked`
 * that map the new property shapes to the existing notification pipeline.
 *
 * These tests verify that the v2 events are currently NOT handled.
 * When handlers are added, these tests should pass.
 *
 * @see src/types/opencode-sdk.ts (EventType definition)
 * @see src/index.ts (event handler type checks)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createMockShellRunner,
  createMockClient,
  mockEvents,
  createMockEvent,
  wait,
} from '../setup.js';
import SmartVoiceNotifyPlugin from '../../src/index.js';

describe('Upstream SDK v2 Event Types', () => {
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
        enableSound: true,
        enableToast: true,
        enableDesktopNotification: false,
        enableWebhook: false,
        enableTTSReminder: false,
        enableAIMessages: false,
        enableIdleNotification: true,
        enablePermissionNotification: true,
        enableQuestionNotification: true,
        enableErrorNotification: true,
        debugLog: false,
        idleSound: 'assets/test-sound.mp3',
        permissionSound: 'assets/test-sound.mp3',
        questionSound: 'assets/test-sound.mp3',
        errorSound: 'assets/test-sound.mp3',
        ...overrides,
      }),
    );

    return SmartVoiceNotifyPlugin({
      project: { id: 'v2-test-project' },
      client: mockClient,
      $: mockShell,
      directory: tempDir,
      worktree: tempDir,
    });
  };

  // ============================================================
  // permission.v2.asked
  // ============================================================

  describe('permission.v2.asked event handling', () => {
    test('should trigger notification for permission.v2.asked event', async () => {
      const plugin = await initPlugin();

      // Simulate a v2 permission event with the new property format
      const v2PermissionEvent = createMockEvent('permission.v2.asked', {
        id: 'perm-v2-001',
        sessionID: 'session-v2-1',
        action: 'file.write',
        resources: ['/tmp/test-file.txt'],
        save: false,
        metadata: { tool: 'write' },
        source: 'agent',
      });

      await plugin.event({ event: v2PermissionEvent });

      // Currently FAILS: the event handler checks for
      // `event.type === "permission.updated" || event.type === "permission.asked"`
      // but NOT `event.type === "permission.v2.asked"`
      //
      // So no toast, no sound, no desktop notification is triggered
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
      expect(toastCalls[0].message).toContain('Permission');
    });

    test('should batch multiple permission.v2.asked events', async () => {
      const plugin = await initPlugin();

      // Fire two v2 permission events rapidly (within batch window)
      const event1 = createMockEvent('permission.v2.asked', {
        id: 'perm-v2-batch-1',
        sessionID: 'session-v2-batch',
        action: 'file.write',
        resources: ['/tmp/file1.txt'],
      });
      const event2 = createMockEvent('permission.v2.asked', {
        id: 'perm-v2-batch-2',
        sessionID: 'session-v2-batch',
        action: 'file.read',
        resources: ['/tmp/file2.txt'],
      });

      await plugin.event({ event: event1 });
      await plugin.event({ event: event2 });

      // Wait for batch window to expire
      await wait(1200);

      // Currently FAILS: v2 events are not processed at all
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
    });

    test('permission.v2.asked should be handled identically to permission.asked', async () => {
      const plugin = await initPlugin();

      // Fire a v1 permission event
      await plugin.event({ event: mockEvents.permissionAsked('perm-v1-test') });
      await wait(1200);
      const v1ToastCount = mockClient.tui.getToastCalls().length;

      // Reset and fire a v2 permission event
      mockClient.tui.resetToastCalls();
      const v2Event = createMockEvent('permission.v2.asked', {
        id: 'perm-v2-test',
        sessionID: 'session-v2-test',
        action: 'file.write',
        resources: ['/tmp/test.txt'],
      });
      await plugin.event({ event: v2Event });
      await wait(1200);
      const v2ToastCount = mockClient.tui.getToastCalls().length;

      // Both should trigger notifications
      // Currently FAILS: v2 event produces 0 toast calls
      expect(v2ToastCount).toBe(v1ToastCount);
    });
  });

  // ============================================================
  // question.v2.asked
  // ============================================================

  describe('question.v2.asked event handling', () => {
    test('should trigger notification for question.v2.asked event', async () => {
      const plugin = await initPlugin();

      // Simulate a v2 question event
      const v2QuestionEvent = createMockEvent('question.v2.asked', {
        id: 'q-v2-001',
        sessionID: 'session-v2-q1',
        questions: [
          {
            id: 'q1',
            text: 'Which file should I modify?',
            options: ['file1.ts', 'file2.ts'],
          },
        ],
        tool: 'question',
      });

      await plugin.event({ event: v2QuestionEvent });

      // Currently FAILS: the event handler checks for
      // `event.type === "question.asked"` but NOT `event.type === "question.v2.asked"`
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
      expect(toastCalls[0].message).toContain('question');
    });

    test('should batch multiple question.v2.asked events', async () => {
      const plugin = await initPlugin();

      const event1 = createMockEvent('question.v2.asked', {
        id: 'q-v2-batch-1',
        sessionID: 'session-v2-q-batch',
        questions: [{ id: 'q1', text: 'Question 1?' }],
      });
      const event2 = createMockEvent('question.v2.asked', {
        id: 'q-v2-batch-2',
        sessionID: 'session-v2-q-batch',
        questions: [{ id: 'q2', text: 'Question 2?' }],
      });

      await plugin.event({ event: event1 });
      await plugin.event({ event: event2 });

      // Wait for batch window to expire
      await wait(1200);

      // Currently FAILS: v2 question events are not processed
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
    });

    test('question.v2.asked should be handled identically to question.asked', async () => {
      const plugin = await initPlugin();

      // Fire a v1 question event
      await plugin.event({ event: mockEvents.questionAsked('q-v1-test') });
      await wait(1200);
      const v1ToastCount = mockClient.tui.getToastCalls().length;

      // Reset and fire a v2 question event
      mockClient.tui.resetToastCalls();
      const v2Event = createMockEvent('question.v2.asked', {
        id: 'q-v2-test',
        sessionID: 'session-v2-q-test',
        questions: [{ id: 'q1', text: 'Test?' }],
      });
      await plugin.event({ event: v2Event });
      await wait(1200);
      const v2ToastCount = mockClient.tui.getToastCalls().length;

      // Both should trigger notifications
      // Currently FAILS: v2 event produces 0 toast calls
      expect(v2ToastCount).toBe(v1ToastCount);
    });
  });

  // ============================================================
  // EventType type system: v2 types should be in the union
  // ============================================================

  describe('EventType type system validation', () => {
    test('plugin should accept permission.v2.asked as a valid event type', () => {
      // This test verifies that the event can be constructed without
      // TypeScript compilation errors. The (string & {}) escape hatch
      // in EventType allows any string, so this should pass.
      const event = createMockEvent('permission.v2.asked', {
        id: 'type-test',
        action: 'file.write',
      });

      expect(event.type).toBe('permission.v2.asked');
    });

    test('plugin should accept question.v2.asked as a valid event type', () => {
      const event = createMockEvent('question.v2.asked', {
        id: 'type-test',
        questions: [],
      });

      expect(event.type).toBe('question.v2.asked');
    });
  });

  // ============================================================
  // CLEANUP/DISPOSE TEST
  // ============================================================

  describe('Plugin dispose/cleanup support', () => {
    test('plugin should provide a dispose method for cleanup', async () => {
      const plugin = await initPlugin();

      // Fire an event to set up internal state (timers, caches, etc.)
      mockClient.session.setMockSession('session-dispose', { parentID: null });
      await plugin.event({ event: mockEvents.sessionIdle('session-dispose') });

      // Currently FAILS: plugin does not have a dispose method
      // The SDK v1.17.3 supports a `dispose` hook for cleanup on unload.
      // Without it, timers and caches leak on plugin hot-reload.
      expect(plugin.dispose).toBeDefined();
      expect(typeof plugin.dispose).toBe('function');
    });
  });
});
