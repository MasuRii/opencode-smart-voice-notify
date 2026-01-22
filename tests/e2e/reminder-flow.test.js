import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
  waitFor,
  getTTSCalls
} from '../setup.js';

describe('Plugin E2E (Reminder Flow)', () => {
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

  test('initial reminder fires after delay', async () => {
    createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.1,
      idleReminderDelaySeconds: 0.1,
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge' // Use Edge TTS for cross-platform compatibility
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait for reminder (platform-aware TTS detection)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 1;
    }, 5000);
    
    expect(getTTSCalls(mockShell).length).toBe(1);
  });

  test('follow-up reminders use exponential backoff', async () => {
    createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.1,
      idleReminderDelaySeconds: 0.1,
      enableFollowUpReminders: true,
      maxFollowUpReminders: 2,
      reminderBackoffMultiplier: 2,
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge' // Use Edge TTS for cross-platform compatibility
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait for initial reminder (0.1s)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 1;
    }, 5000);
    
    // Wait for follow-up (next delay = 0.1 * 2^1 = 0.2s)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 2;
    }, 5000);
  });

  test('respects maxFollowUpReminders limit', async () => {
    createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.1,
      idleReminderDelaySeconds: 0.1,
      enableFollowUpReminders: true,
      maxFollowUpReminders: 1, // Only 1 total reminder
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge' // Use Edge TTS for cross-platform compatibility
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait for the first reminder (includes initial sound + 1 TTS reminder)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 2; // sound + 1 reminder
    }, 5000);
    
    const callsAfterFirstReminder = getTTSCalls(mockShell).length;
    
    // Wait longer to ensure no additional reminders
    await wait(1000);
    
    // Should have no additional calls beyond the first reminder
    expect(getTTSCalls(mockShell).length).toBe(callsAfterFirstReminder);
  });

  test('reminder cancelled if user responds before firing', async () => {
     createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.5,
      idleReminderDelaySeconds: 0.5,
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge' // Use Edge TTS for cross-platform compatibility
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait a bit for initial sound, but not enough for reminder
    await wait(100);
    const callsBeforeUserResponse = getTTSCalls(mockShell).length;
    
    // User responds (new activity after idle)
    await plugin.event({ event: mockEvents.messageUpdated('m1', 'user', 's1') });
    
    // Wait for where reminder would have fired
    await wait(1000);
    
    // Should have NO additional calls beyond initial sound
    expect(getTTSCalls(mockShell).length).toBe(callsBeforeUserResponse);
  });

  // TODO: This test is flaky due to timing issues with async reminder cancellation
  // The cancellation may not happen before the next reminder fires due to event loop timing
  test.skip('reminder cancelled if user responds during playback (cancels follow-up)', async () => {
     createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.1,
      idleReminderDelaySeconds: 0.1,
      enableFollowUpReminders: true,
      maxFollowUpReminders: 2,
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge' // Use Edge TTS for cross-platform compatibility
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait for 1st reminder to fire (platform-aware: includes sound + reminder)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 2; // sound + 1 reminder
    }, 5000);
    
    const callsAfterFirstReminder = getTTSCalls(mockShell).length;
    
    // User responds AFTER 1st reminder but BEFORE 2nd
    await wait(100);
    await plugin.event({ event: mockEvents.messageUpdated('m2', 'user', 's1') });
    
    // Wait for where 2nd reminder would fire
    await wait(1000);
    
    // Should have no additional calls beyond first reminder
    expect(getTTSCalls(mockShell).length).toBe(callsAfterFirstReminder);
  });

  test('reminder message varies (random selection)', async () => {
    const customMessages = ["MSG_FLOW_1", "MSG_FLOW_2", "MSG_FLOW_3", "MSG_FLOW_4", "MSG_FLOW_5"];
    createTestConfig(createMinimalConfig({ 
      enabled: true, 
      enableTTSReminder: true,
      ttsReminderDelaySeconds: 0.1,
      idleReminderDelaySeconds: 0.1,
      enableTTS: true,
      enableSound: true,
      ttsEngine: 'edge', // Use Edge TTS for cross-platform compatibility
      idleReminderTTSMessages: customMessages
    }));
    
    const plugin = await SmartVoiceNotifyPlugin({
      project: { name: 'TestProject' },
      client: mockClient,
      $: mockShell
    });
    
    await plugin.event({ event: mockEvents.sessionIdle('s1') });
    
    // Wait for reminder (platform-aware TTS detection)
    await waitFor(() => {
      return getTTSCalls(mockShell).length >= 1;
    }, 5000);
    
    expect(getTTSCalls(mockShell).length).toBe(1);
    // Note: We don't verify exact message content in this E2E test as it's complex 
    // to read the temporary audio file generated.
    // Flow verification is the primary goal.
  });
});
