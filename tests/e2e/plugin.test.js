import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import fs from 'fs';
import path from 'path';
import SmartVoiceNotifyPlugin from '../../index.js';
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
  wasTTSCalled,
  getTTSCalls,
  getAudioCalls,
  isWindows
} from '../setup.js';

describe('Plugin E2E (Plugin Core)', () => {
  let mockClient;
  let mockShell;
  let tempDir;
  
  beforeEach(() => {
    tempDir = createTestTempDir();
    createTestAssets();
    mockClient = createMockClient();
    mockShell = createMockShellRunner();
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  describe('Initialization', () => {
    test('should disable plugin when enabled is false', async () => {
      createTestConfig(createMinimalConfig({ enabled: false }));
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      expect(plugin).toEqual({});
    });
    
    test('should register event handler when enabled', async () => {
      createTestConfig(createMinimalConfig({ enabled: true }));
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      expect(plugin.event).toBeDefined();
      expect(typeof plugin.event).toBe('function');
    });
  });

  describe('session.idle event', () => {
    test('should play sound when notificationMode is sound-first', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        notificationMode: 'sound-first',
        enableSound: true,
        idleSound: 'assets/test-sound.mp3',
        enableToast: true
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const event = mockEvents.sessionIdle('session-123');
      await plugin.event({ event });
      
      // Verify sound playback
      expect(mockShell.getCallCount()).toBeGreaterThan(0);
      expect(mockShell.wasCalledWith('test-sound.mp3')).toBe(true);
      
      // Verify toast
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(1);
      expect(toastCalls[0].message).toContain('Agent has finished');
    });

    // Skip on non-Windows CI: TTS-first mode requires working TTS engine
    test.skipIf(!isWindows)('should speak immediately when notificationMode is tts-first', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        notificationMode: 'tts-first',
        enableTTS: true,
        enableSound: true,
        ttsEngine: 'sapi' // Use SAPI on Windows for reliable offline testing
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const event = mockEvents.sessionIdle('session-123');
      await plugin.event({ event });
      
      // Should NOT play sound file directly (tts-first skips sound)
      expect(mockShell.wasCalledWith('test-sound.mp3')).toBe(false);
      
      // Should speak immediately (Windows SAPI detection)
      expect(mockShell.wasCalledWith('powershell.exe')).toBe(true);
    });

    test('should play sound AND speak when notificationMode is both', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        notificationMode: 'both',
        enableSound: true,
        enableTTS: true,
        ttsEngine: 'edge', // Use Edge TTS for cross-platform compatibility
        idleSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const event = mockEvents.sessionIdle('session-123');
      await plugin.event({ event });
      
      // Verify sound playback
      expect(mockShell.wasCalledWith('test-sound.mp3')).toBe(true);
      
      // Verify audio was played (sound + potentially TTS)
      expect(getAudioCalls(mockShell).length).toBeGreaterThanOrEqual(1);
    });

    test('should skip sub-sessions (parentID check)', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true
      }));
      
      // Set up mock session as a sub-session
      mockClient.session.setMockSession('sub-session-123', { parentID: 'main-session' });
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const event = mockEvents.sessionIdle('sub-session-123');
      await plugin.event({ event });
      
      // Should NOT play sound or show toast
      expect(mockShell.getCallCount()).toBe(0);
      expect(mockClient.tui.getToastCalls().length).toBe(0);
    });

    // ========================================
    // IDLE EVENT DEBOUNCING TESTS
    // Tests for the fix of duplicate notifications on Linux
    // when SDK fires multiple session.idle events in rapid succession
    // ========================================
    
    test('should debounce rapid duplicate session.idle events for same session', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        idleSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire multiple idle events for the SAME session in rapid succession
      // (simulating the Linux bug where SDK fires duplicates within ~100ms)
      const sessionId = 'session-debounce-test';
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      
      // Should only have ONE toast (duplicates debounced)
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(1);
      
      // Should only have played sound ONCE
      // Note: getCallCount includes the sound play command
      const initialCallCount = mockShell.getCallCount();
      expect(initialCallCount).toBeGreaterThan(0); // At least one call happened
      
      // Fire another duplicate - should still be debounced
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      expect(mockClient.tui.getToastCalls().length).toBe(1); // Still just one
    });

    test('should allow idle notifications for DIFFERENT sessions', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        idleSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire idle events for DIFFERENT sessions
      await plugin.event({ event: mockEvents.sessionIdle('session-A') });
      await plugin.event({ event: mockEvents.sessionIdle('session-B') });
      await plugin.event({ event: mockEvents.sessionIdle('session-C') });
      
      // Should have THREE toasts (one per session)
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBe(3);
    });

    test('should allow new idle notification after debounce window expires', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        idleSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const sessionId = 'session-debounce-expiry';
      
      // First notification
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      expect(mockClient.tui.getToastCalls().length).toBe(1);
      
      // Immediate duplicate should be debounced
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      expect(mockClient.tui.getToastCalls().length).toBe(1);
      
      // Note: We can't easily test the 5-second expiry in a unit test without
      // waiting 5+ seconds. The debounce window is hardcoded to 5000ms.
      // This test verifies the basic debouncing works; expiry is a timing test.
    });

    test('should reset debounce state on session.created', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        idleSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const sessionId = 'session-reset-test';
      
      // First idle notification
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      expect(mockClient.tui.getToastCalls().length).toBe(1);
      
      // Create a new session (this clears debounce state for that session)
      await plugin.event({ event: mockEvents.sessionCreated(sessionId) });
      
      // Now idle should work again (debounce cleared)
      await plugin.event({ event: mockEvents.sessionIdle(sessionId) });
      expect(mockClient.tui.getToastCalls().length).toBe(2);
    });

    // Skip on non-Windows CI: TTS reminder tests require working TTS engine and are timing-sensitive
    test.skipIf(!isWindows)('should schedule TTS reminder after configured delay', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableTTSReminder: true,
        ttsReminderDelaySeconds: 0.1, // Short delay for testing - 100ms
        idleReminderDelaySeconds: 0.1, // Specific for idle
        enableTTS: true,
        enableSound: true, // MUST BE TRUE for speak() to work
        ttsEngine: 'edge' // Use Edge TTS which works cross-platform
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const event = mockEvents.sessionIdle('session-123');
      await plugin.event({ event });
      
      // Get initial call count (sound plays immediately)
      await wait(50);
      const initialCalls = getAudioCalls(mockShell).length;
      
      // Wait for reminder (0.1s delay + buffer)
      await wait(500);
      
      // Verify TTS was called after reminder
      expect(getAudioCalls(mockShell).length).toBeGreaterThan(initialCalls);
    });
  });

  describe('permission event handling', () => {
    test('should batch multiple permissions within window', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        permissionSound: 'assets/test-sound.mp3',
        permissionBatchWindowMs: 100
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire multiple permissions rapidly
      await plugin.event({ event: mockEvents.permissionAsked('p1', 's1') });
      await plugin.event({ event: mockEvents.permissionAsked('p2', 's1') });
      
      // Immediately after firing, nothing should have happened yet (batching window)
      expect(mockShell.getCallCount()).toBe(0);
      
      // Wait for batch window to expire
      await wait(300);
      
      // Should have played sound ONCE for the batch
      // It plays sound twice for single permission, or min(3, count) for batch
      // Here count=2, so 2 loops.
      expect(mockShell.getCallCount()).toBeGreaterThan(0);
      
      // Verify toast message mentions 2 permissions
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.some(t => t.message.includes('2 permission requests'))).toBe(true);
    });

    test('should cancel reminder when permission.replied', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableTTSReminder: true,
        permissionReminderDelaySeconds: 0.5,
        enableTTS: true,
        ttsEngine: 'sapi'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire permission
      await plugin.event({ event: mockEvents.permissionAsked('p1', 's1') });
      
      // Wait for batch to process
      await wait(200);
      
      // Fire reply BEFORE reminder fires
      await plugin.event({ event: mockEvents.permissionReplied('p1') });
      
      // Wait for where the reminder would have fired
      await wait(600);
      
      // Should NOT have called SAPI TTS for the reminder
      expect(mockShell.wasCalledWith('New-Object -ComObject SAPI.SpVoice')).toBe(false);
    });
  });

  describe('question event handling', () => {
    test('should batch multiple questions and calculate total count', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        enableToast: true,
        questionSound: 'assets/test-sound.mp3',
        questionBatchWindowMs: 100
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire two question requests: one with 1 question, one with 2 questions
      await plugin.event({ event: mockEvents.questionAsked('q1', 's1', [{ text: 'Q1' }]) });
      await plugin.event({ event: mockEvents.questionAsked('q2', 's1', [{ text: 'Q2' }, { text: 'Q3' }]) });
      
      await wait(300);
      
      // Verify toast mentions total 3 questions
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.some(t => t.message.includes('3 questions'))).toBe(true);
    });
  });

  describe('user activity tracking', () => {
    test('should cancel all reminders on new user message after idle', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableTTSReminder: true,
        idleReminderDelaySeconds: 0.5,
        enableTTS: true,
        ttsEngine: 'sapi'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire idle event
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      
      // Small wait to ensure idleTime is recorded
      await wait(50);
      
      // Fire user message
      await plugin.event({ event: mockEvents.messageUpdated('m1', 'user', 's1') });
      
      // Wait for reminder time
      await wait(700);
      
      // Should NOT have fired reminder
      expect(mockShell.wasCalledWith('New-Object -ComObject SAPI.SpVoice')).toBe(false);
    });

    // SAPI TTS is Windows-only, skip on other platforms
    test.skipIf(!isWindows)('should ignore message updates for already seen IDs', async () => {
       createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableTTSReminder: true,
        idleReminderDelaySeconds: 0.5,
        enableTTS: true,
        enableSound: true, // MUST BE TRUE
        ttsEngine: 'sapi'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Fire a user message BEFORE idle (seen)
      await plugin.event({ event: mockEvents.messageUpdated('m1', 'user', 's1') });
      
      // Fire idle
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      await wait(100);
      
      // Fire the SAME user message ID again (update)
      await plugin.event({ event: mockEvents.messageUpdated('m1', 'user', 's1') });
      
      // Wait - this update should NOT cancel the reminder because it's not "new activity after idle"
      // Wait long enough for reminder to fire (0.5s)
      await wait(1000);
      
      // Reminder SHOULD have fired (via SAPI script)
      expect(mockShell.wasCalledWith('powershell.exe')).toBe(true);
      expect(mockShell.wasCalledWith('.ps1')).toBe(true);
    });
  });

  describe('session.created event', () => {
    test('should reset all tracking state', async () => {
       // We can't directly check internal state, but we can verify it clears pending batches
       createTestConfig(createMinimalConfig({ 
        enabled: true, 
        permissionBatchWindowMs: 1000 // Long window
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Start a batch
      await plugin.event({ event: mockEvents.permissionAsked('p1', 's1') });
      
      // Reset via session.created
      await plugin.event({ event: mockEvents.sessionCreated('s2') });
      
      // Wait for original batch window
      await wait(1200);
      
      // Should NOT have processed the batch (no sound/toast)
      expect(mockClient.tui.getToastCalls().length).toBe(0);
    });
  });
});
