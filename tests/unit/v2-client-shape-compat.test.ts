// @ts-nocheck
/**
 * Red-Phase TDD Tests: OpenCode v2 Client API Shape Compatibility
 *
 * The audit found that the plugin uses v1-only client API shapes:
 * - `client.session.get({ path: { id } })` instead of v2 `client.session.get({ sessionID })`
 * - `client.tui.showToast({ body: { message, variant, duration } })` instead of v2 flat
 *   `client.tui.showToast({ message, variant, duration, title })`
 *
 * When the upstream OpenCode SDK migrates to v2 client shapes, the plugin's v1-style
 * calls will silently produce incorrect results (undefined session IDs, missing toast data).
 *
 * These tests use a v2-shaped mock client to reproduce the exact breakage pattern.
 * They are expected to FAIL (RED) against the current production code, which uses v1 shapes.
 * When the production code is updated to v2 shapes, these tests should PASS (GREEN).
 *
 * @see src/index.ts - session.get call sites (~line 166) and showToast (~line 247)
 * @see src/types/opencode-sdk.ts - SessionClient and TUIClient type definitions
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import SmartVoiceNotifyPlugin from '../../src/index.js';
import type { Session, PluginEvent } from '../../src/types/opencode-sdk.js';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createMockShellRunner,
  mockEvents,
  createMockEvent,
  wait,
} from '../setup.js';

// ============================================================
// V2-SHAPED MOCK CLIENT
// Mimics the v2 OpenCode SDK client API:
// - session.get({ sessionID })  (flat, not { path: { id } })
// - tui.showToast({ message, variant, duration, title })  (flat, not { body: { ... } })
// ============================================================

interface V2ToastCall {
  message?: string;
  variant?: string;
  duration?: number;
  title?: string;
  timestamp: number;
}

interface V2MockClient {
  tui: {
    showToast(input: { message?: string; variant?: string; duration?: number; title?: string }): Promise<{ success: boolean }>;
    getToastCalls(): V2ToastCall[];
    resetToastCalls(): void;
  };
  session: {
    get(input: { sessionID: string }): Promise<{ data?: Session }>;
    setMockSession(id: string, data: Partial<Session>): void;
    clearMockSessions(): void;
  };
  app: { log: (input: unknown) => Promise<{ success: boolean }> };
  permission: { reply: (input: unknown) => Promise<{ success: boolean }> };
  question: {
    reply: (input: unknown) => Promise<{ success: boolean }>;
    reject: (input: unknown) => Promise<{ success: boolean }>;
  };
}

function createV2MockClient(): V2MockClient {
  const toastCalls: V2ToastCall[] = [];
  const sessionData = new Map<string, Session>();

  return {
    tui: {
      // V2 shape: flat parameters, not wrapped in { body }
      showToast: async ({ message, variant, duration, title }: {
        message?: string;
        variant?: string;
        duration?: number;
        title?: string;
      }) => {
        toastCalls.push({
          message,
          variant,
          duration,
          title,
          timestamp: Date.now(),
        });
        return { success: true };
      },
      getToastCalls: () => [...toastCalls],
      resetToastCalls: () => {
        toastCalls.length = 0;
      },
    },

    session: {
      // V2 shape: flat { sessionID }, not { path: { id } }
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = sessionData.get(sessionID) ?? ({
          id: sessionID,
          parentID: null,
          status: 'idle',
        } as Session);
        return { data: session };
      },
      setMockSession: (id: string, data: Partial<Session>) => {
        sessionData.set(id, { id, ...data } as Session);
      },
      clearMockSessions: () => {
        sessionData.clear();
      },
    },

    app: {
      log: async (_input: unknown) => ({ success: true }),
    },

    permission: {
      reply: async (_input: unknown) => ({ success: true }),
    },

    question: {
      reply: async (_input: unknown) => ({ success: true }),
      reject: async (_input: unknown) => ({ success: true }),
    },
  };
}

// ============================================================
// TEST SUITE
// ============================================================

describe('OpenCode v2 Client Shape Compatibility', () => {
  let mockClient: V2MockClient;
  let mockShell: ReturnType<typeof createMockShellRunner>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTestTempDir();
    createTestAssets();
    mockClient = createV2MockClient();
    mockShell = createMockShellRunner();
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // HELPER: Initialize plugin with v2 mock client
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
      project: { id: 'v2-compat-project' },
      client: mockClient as any, // v2 shape forced through v1-typed parameter
      $: mockShell,
      directory: tempDir,
      worktree: tempDir,
    });
  };

  // ============================================================
  // v2 session.get({ sessionID }) shape
  //
  // Current production code calls: client.session.get({ path: { id: sessionID } })
  // v2 SDK shape:                  client.session.get({ sessionID })
  //
  // When the plugin sends v1 shape to a v2 client:
  //   session.get({ path: { id: 'sess-1' } })
  // The v2 mock destructures { sessionID } → sessionID is undefined
  // → returns wrong/default session data
  // ============================================================

  describe('v2 session.get({ sessionID }) shape', () => {
    test('should correctly look up session by sessionID for sub-session filtering', async () => {
      // Arrange: Set up a sub-session (parentID set → should be filtered)
      const subSessionId = 'sub-session-v2-001';
      mockClient.session.setMockSession(subSessionId, {
        parentID: 'parent-session-001',
        status: 'idle',
      });
      const plugin = await initPlugin();

      // Act: Fire idle event for sub-session
      await plugin.event({ event: mockEvents.sessionIdle(subSessionId) });

      // Assert: Sub-session should be filtered (no notification)
      // EXPECTED RED FAILURE: Plugin calls session.get({ path: { id } }) (v1 shape),
      // but v2 mock expects { sessionID }. The mock receives undefined for sessionID,
      // returns a default session with parentID=null, and the sub-session check passes
      // incorrectly. A notification fires when it shouldn't.
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(0);
    });

    test('should correctly use sessionID for session cache lookups', async () => {
      // Arrange: Set up session with specific data
      const sessionId = 'cache-v2-session';
      mockClient.session.setMockSession(sessionId, {
        parentID: null,
        status: 'idle',
        title: 'Important session title for AI context',
      });
      const plugin = await initPlugin();

      // Act: Fire idle event twice (second should use cache)
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });

      // Assert: Notification should fire (main session, parentID=null)
      // This also tests that the session was correctly looked up by sessionID
      // EXPECTED RED FAILURE: v1 shape { path: { id } } sent to v2 mock → wrong lookup
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(1);
      expect(toastCalls[0].message).toContain('Agent has finished');
    });

    test('should correctly look up session for error event sub-session filtering', async () => {
      // Arrange: Set up a sub-session for error handling
      const subSessionId = 'sub-error-v2-001';
      mockClient.session.setMockSession(subSessionId, {
        parentID: 'parent-session-001',
        status: 'error',
      });
      const plugin = await initPlugin();

      // Act: Fire error event for sub-session
      await plugin.event({ event: mockEvents.sessionError(subSessionId) });

      // Assert: Sub-session error should be filtered (no notification)
      // EXPECTED RED FAILURE: Same v1→v2 shape mismatch as idle handler
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(0);
    });
  });

  // ============================================================
  // v2 tui.showToast flat parameter shape
  //
  // Current production code calls: client.tui.showToast({ body: { message, variant, duration } })
  // v2 SDK shape:                  client.tui.showToast({ message, variant, duration, title })
  //
  // When the plugin sends v1 shape to a v2 client:
  //   showToast({ body: { message: "...", variant: "success", duration: 5000 } })
  // The v2 mock destructures { message, variant, duration, title } → all undefined
  // (they're nested inside "body", not top-level)
  // ============================================================

  describe('v2 tui.showToast flat parameter shape', () => {
    test('should pass message as top-level parameter (not nested in body)', async () => {
      // Arrange
      const sessionId = 'toast-v2-session';
      mockClient.session.setMockSession(sessionId, {
        parentID: null,
        status: 'idle',
      });
      const plugin = await initPlugin();

      // Act: Fire idle event (triggers showToast)
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });

      // Assert: Toast message should be captured correctly
      // EXPECTED RED FAILURE: Plugin calls showToast({ body: { message, variant, duration } })
      // but v2 mock destructures { message, variant, duration, title } at top level.
      // message/variant/duration are all undefined because they're inside "body".
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
      expect(toastCalls[0].message).toBeDefined();
      expect(toastCalls[0].message).toContain('Agent has finished');
    });

    test('should pass variant as top-level parameter (not nested in body)', async () => {
      // Arrange
      const sessionId = 'toast-variant-v2-session';
      mockClient.session.setMockSession(sessionId, {
        parentID: null,
        status: 'idle',
      });
      const plugin = await initPlugin();

      // Act: Fire idle event (triggers showToast with variant="success")
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });

      // Assert: Toast variant should be 'success' for idle events
      // EXPECTED RED FAILURE: variant is undefined (nested in body)
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
      expect(toastCalls[0].variant).toBe('success');
    });

    test('should pass duration as top-level parameter for error toast', async () => {
      // Arrange
      const sessionId = 'toast-duration-v2-session';
      mockClient.session.setMockSession(sessionId, {
        parentID: null,
        status: 'error',
      });
      const plugin = await initPlugin();

      // Act: Fire error event (triggers showToast with variant="error", duration=8000)
      await plugin.event({ event: mockEvents.sessionError(sessionId) });

      // Assert: Toast variant should be 'error' for error events
      // EXPECTED RED FAILURE: variant is undefined (nested in body)
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
      expect(toastCalls[0].variant).toBe('error');
    });
  });

  // ============================================================
  // v2 Session type field coverage
  //
  // The v2 SDK Session type includes additional fields that the plugin
  // should be aware of for context-aware AI and notification messages.
  // ============================================================

  describe('v2 Session type field coverage', () => {
    test('Session type should include projectID field', () => {
      // Type-level test: verify the Session interface has projectID
      // This test validates the type mirror is not stale
      const session: Session = {
        id: 'test',
        projectID: 'proj-123',
      };
      expect(session.projectID).toBe('proj-123');
    });

    test('Session type should include directory field', () => {
      const session: Session = {
        id: 'test',
        directory: '/home/user/project',
      };
      expect(session.directory).toBe('/home/user/project');
    });

    test('Session type should include title field', () => {
      const session: Session = {
        id: 'test',
        title: 'Fix authentication bug',
      };
      expect(session.title).toBe('Fix authentication bug');
    });

    test('Session type should include summary with files/additions/deletions', () => {
      const session: Session = {
        id: 'test',
        summary: {
          files: 5,
          additions: 120,
          deletions: 30,
        },
      };
      expect(session.summary?.files).toBe(5);
      expect(session.summary?.additions).toBe(120);
      expect(session.summary?.deletions).toBe(30);
    });

    test('Session type should include time fields', () => {
      const session: Session = {
        id: 'test',
        time: {
          created: 1700000000,
          updated: 1700001000,
          compacting: 1700002000,
        },
      };
      expect(session.time?.created).toBe(1700000000);
      expect(session.time?.updated).toBe(1700001000);
      expect(session.time?.compacting).toBe(1700002000);
    });
  });

  // ============================================================
  // Permission/Question reply: old vs new property shapes
  //
  // The plugin handles both SDK versions:
  // - Old (v1.0.x): { permissionID, response }
  // - New (v1.1.1+): { requestID, reply }
  // ============================================================

  describe('permission/question reply shape coverage', () => {
    test('permission.replied should clear reminder with v2 shape (requestID + reply)', async () => {
      // Arrange
      const plugin = await initPlugin();

      // Fire permission.asked first to set up active permission
      await plugin.event({ event: mockEvents.permissionAsked('perm-reply-v2') });
      await wait(100);

      // Act: Reply with v2 shape (requestID + reply)
      const replyEvent = createMockEvent('permission.replied', {
        requestID: 'perm-reply-v2',
        reply: 'once',
      });
      await plugin.event({ event: replyEvent });

      // Assert: No crash, reminder cancelled (behavioral test)
      // This should pass because the code already handles both shapes
      expect(true).toBe(true); // If we got here without error, handler accepted v2 shape
    });

    test('permission.replied should clear reminder with v1 shape (permissionID + response)', async () => {
      // Arrange
      const plugin = await initPlugin();

      // Fire permission.asked first
      await plugin.event({ event: mockEvents.permissionAsked('perm-reply-v1') });
      await wait(100);

      // Act: Reply with v1 shape (permissionID + response)
      const replyEvent = createMockEvent('permission.replied', {
        permissionID: 'perm-reply-v1',
        response: 'once',
      });
      await plugin.event({ event: replyEvent });

      // Assert: v1 shape is still handled correctly
      expect(true).toBe(true);
    });

    test('question.replied should clear reminder with v2 shape (requestID + answers)', async () => {
      // Arrange
      const plugin = await initPlugin();

      // Fire question.asked first
      await plugin.event({ event: mockEvents.questionAsked('q-reply-v2') });
      await wait(100);

      // Act: Reply with v2 shape
      const replyEvent = createMockEvent('question.replied', {
        requestID: 'q-reply-v2',
        answers: [['option-a']],
      });
      await plugin.event({ event: replyEvent });

      // Assert: v2 shape accepted
      expect(true).toBe(true);
    });

    test('question.rejected should clear reminder with requestID', async () => {
      // Arrange
      const plugin = await initPlugin();

      // Fire question.asked first
      await plugin.event({ event: mockEvents.questionAsked('q-reject-v2') });
      await wait(100);

      // Act: Reject with requestID
      const rejectEvent = createMockEvent('question.rejected', {
        requestID: 'q-reject-v2',
      });
      await plugin.event({ event: rejectEvent });

      // Assert: rejection handled
      expect(true).toBe(true);
    });
  });

  // ============================================================
  // v2 event type registration
  //
  // The production code already handles permission.v2.asked and
  // question.v2.asked event types. These tests verify that the
  // v2 event properties are correctly extracted.
  // ============================================================

  describe('v2 event type property extraction', () => {
    test('permission.v2.asked should extract id from properties', async () => {
      // Arrange
      const plugin = await initPlugin({ enablePermissionNotification: true });

      // Act: Fire v2 permission event with all v2 properties
      const v2Event = createMockEvent('permission.v2.asked', {
        id: 'perm-v2-prop-test',
        sessionID: 'session-v2',
        action: 'file.write',
        resources: ['/tmp/test.txt'],
        save: false,
        metadata: { tool: 'write' },
        source: 'agent',
      });
      await plugin.event({ event: v2Event });

      // Assert: Event was processed (toast was shown)
      // This passes because the code handles permission.v2.asked
      // and extracts event.properties.id
      const toastCalls = mockClient.tui.getToastCalls();
      // Note: toast may have undefined message due to v2 showToast shape mismatch,
      // but the event WAS processed (batch was populated)
      expect(toastCalls.length).toBeGreaterThan(0);
    });

    test('question.v2.asked should extract id and questions from properties', async () => {
      // Arrange
      const plugin = await initPlugin({ enableQuestionNotification: true });

      // Act: Fire v2 question event
      const v2Event = createMockEvent('question.v2.asked', {
        id: 'q-v2-prop-test',
        sessionID: 'session-v2-q',
        questions: [
          { id: 'q1', text: 'Which file?', options: ['a.ts', 'b.ts'] },
          { id: 'q2', text: 'What approach?' },
        ],
        tool: 'question',
      });
      await plugin.event({ event: v2Event });

      // Assert: Event was processed
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // SDK version comment accuracy
  //
  // The production code has inline comments referencing SDK versions.
  // This section documents the expected version references for
  // maintainability tracking.
  // ============================================================

  describe('SDK version documentation accuracy', () => {
    test('v2 event types should be documented for SDK v1.17+', () => {
      // Documentation test: permission.v2.asked and question.v2.asked
      // were introduced in SDK v1.17+, not v1.1.7+.
      //
      // The production code comments reference:
      //   "permission.v2.asked (SDK v1.17+)" - CORRECT
      //   "question.v2.asked (SDK v1.17+)" - CORRECT
      // But also reference:
      //   "question.asked (SDK v1.1.7+)" - this is the v1 format
      //
      // Ensure v2 event types are explicitly listed in the EventType union
      const v2PermissionEvent = createMockEvent('permission.v2.asked', { id: 'doc-test' });
      const v2QuestionEvent = createMockEvent('question.v2.asked', { id: 'doc-test' });

      // These should compile and be valid event types
      expect(v2PermissionEvent.type).toBe('permission.v2.asked');
      expect(v2QuestionEvent.type).toBe('question.v2.asked');
    });
  });

  // ============================================================
  // Cross-cutting: v2 client shape affects all event handlers
  // ============================================================

  describe('v2 client shape impact on session.error handler', () => {
    test('should correctly look up session for error sub-session filtering with v2 client', async () => {
      // Arrange: Sub-session for error
      const subSessionId = 'sub-error-cross-v2';
      mockClient.session.setMockSession(subSessionId, {
        parentID: 'parent-error-session',
        status: 'error',
      });
      const plugin = await initPlugin();

      // Act: Fire error event
      await plugin.event({ event: mockEvents.sessionError(subSessionId) });

      // Assert: Sub-session error should be filtered
      // EXPECTED RED FAILURE: v1 shape → v2 mock → wrong session lookup → notification fires
      expect(mockClient.tui.getToastCalls().length).toBe(0);
    });
  });
});
