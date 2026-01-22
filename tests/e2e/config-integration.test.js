import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
  getTestTempDir,
  testFileExists,
  isWindows,
  getTTSCalls,
  wasTTSCalled,
  getAudioCalls
} from '../setup.js';

describe('Plugin E2E (Config Integration)', () => {
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

  describe('enabled: false', () => {
    test('should completely disable plugin when enabled is false', async () => {
      createTestConfig(createMinimalConfig({ enabled: false }));
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      expect(plugin).toEqual({});
      
      // Even if we somehow got a handle to the event function, it shouldn't have been registered
      // But we can't test that if it returns {}.
    });
  });

  describe('notificationMode integration', () => {
    test('should respect "sound-only" mode', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        notificationMode: 'sound-only',
        enableSound: true,
        enableTTS: true, // Should be ignored in sound-only mode
        idleSound: 'assets/test-sound.mp3',
        enableTTSReminder: true // Should also be ignored
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      
      // Verify sound played
      expect(mockShell.wasCalledWith('test-sound.mp3')).toBe(true);
      
      // Clear calls
      mockShell.reset();
      
      // Wait for reminder (default is 30s, createMinimalConfig might override)
      // Actually createMinimalConfig in setup.js defaults to:
      // enableTTSReminder: false
      // So I explicitly enabled it above.
      
      await wait(500); 
      
      // Should NOT have fired any TTS (platform-aware check)
      expect(wasTTSCalled(mockShell)).toBe(false);
    });

    test('should respect "both" mode', async () => {
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
      
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      
      // Verify sound played
      expect(mockShell.wasCalledWith('test-sound.mp3')).toBe(true);
      
      // Verify TTS was called (platform-aware check)
      // Edge TTS generates audio and plays via playAudioFile
      // On Windows this uses MediaPlayer, on Linux paplay/aplay, on macOS afplay
      expect(wasTTSCalled(mockShell)).toBe(true);
    });
  });

  describe('delay configurations', () => {
    test('should respect custom batch windows', async () => {
      const customWindow = 250;
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableSound: true,
        permissionBatchWindowMs: customWindow,
        permissionSound: 'assets/test-sound.mp3'
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      const startTime = Date.now();
      await plugin.event({ event: mockEvents.permissionAsked('p1', 's1') });
      
      // Wait for slightly less than the window
      await wait(customWindow - 100);
      expect(mockShell.getCallCount()).toBe(0);
      
      // Wait for slightly more than the window
      await wait(200);
      expect(mockShell.getCallCount()).toBeGreaterThan(0);
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(customWindow);
    });

    // Skip on non-Windows CI: TTS reminder timing tests are inherently flaky in CI environments
    // due to network dependency (Edge TTS) or platform-specific engines (SAPI)
    test.skipIf(!isWindows)('should respect custom reminder delays', async () => {
      const customDelay = 0.1; // 100ms - shorter delay for faster test
      createTestConfig(createMinimalConfig({ 
        enabled: true, 
        enableTTSReminder: true,
        ttsReminderDelaySeconds: customDelay, // Global default
        idleReminderDelaySeconds: customDelay, // Specific for idle
        enableTTS: true,
        enableSound: true, // Required for sound-first mode to trigger reminder flow
        ttsEngine: 'edge' // Use Edge TTS which works cross-platform
      }));
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      
      // Get initial audio call count (sound plays immediately in sound-first mode)
      await wait(50);
      const initialCalls = getAudioCalls(mockShell).length;
      expect(initialCalls).toBeGreaterThanOrEqual(1); // Sound played
      
      // Wait for reminder to fire (after delay + buffer)
      await wait(300);
      const afterDelayCalls = getAudioCalls(mockShell).length;
      // Should have more calls after reminder fires
      expect(afterDelayCalls).toBeGreaterThan(initialCalls);
    });
  });

  describe('graceful degradation / recovery', () => {
    test('should handle missing config file by creating defaults', async () => {
      // Don't call createTestConfig() - leave directory empty
      
      const plugin = await SmartVoiceNotifyPlugin({
        project: { name: 'TestProject' },
        client: mockClient,
        $: mockShell
      });
      
      // Verify plugin initialized (default is enabled: true)
      expect(plugin.event).toBeDefined();
      
      // Verify config file was created
      const configPath = 'smart-voice-notify.jsonc';
      expect(testFileExists(configPath)).toBe(true);
      
      // Verify it functions
      await plugin.event({ event: mockEvents.sessionIdle('s1') });
      
      // Default notificationMode is 'sound-first', but createMinimalConfig (which I didn't use)
      // might have different defaults than the actual util/config.js.
      // Let's see if it shows a toast (default enableToast is true in actual config)
      const toastCalls = mockClient.tui.getToastCalls();
      expect(toastCalls.length).toBeGreaterThan(0);
    });
  });
});
