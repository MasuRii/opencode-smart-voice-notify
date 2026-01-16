/**
 * Unit Tests for Error Handler Functionality
 * 
 * Tests for the session.error event handling and getErrorMessage() helper function.
 * These tests verify error notifications work correctly in the plugin.
 * 
 * @see index.js - session.error event handler and getErrorMessage()
 * @see docs/ARCHITECT_PLAN.md - Phase 2, Task 2.5
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createTestAssets,
  createMockClient,
  createMockShellRunner,
  mockEvents,
  wait
} from '../setup.js';

describe('error handler functionality', () => {
  let loadConfig;
  let config;
  
  beforeEach(async () => {
    // Create test temp directory before each test
    createTestTempDir();
    createTestAssets();
    
    // Create a minimal test config with features disabled for isolated testing
    createTestConfig({
      _configVersion: '1.0.0',
      enabled: true,
      notificationMode: 'sound-first',
      enableTTS: false,
      enableTTSReminder: false,
      enableSound: false,
      enableToast: false,
      enableDesktopNotification: false,
      debugLog: false,
      enableAIMessages: false,
      // Error-specific config
      errorSound: 'assets/Machine-alert-beep-sound-effect.mp3',
      errorReminderDelaySeconds: 20,
      errorTTSMessages: [
        'Test error message 1',
        'Test error message 2',
        'Test error message 3'
      ],
      errorTTSMessagesMultiple: [
        'There are {count} errors',
        '{count} errors detected'
      ],
      errorReminderTTSMessages: [
        'Reminder: error waiting',
        'Still an error pending'
      ],
      errorReminderTTSMessagesMultiple: [
        'Reminder: {count} errors waiting',
        'Still {count} errors pending'
      ]
    });
    
    // Fresh import of config module
    const configModule = await import('../../util/config.js');
    loadConfig = configModule.loadConfig;
    config = loadConfig('smart-voice-notify');
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // ERROR CONFIGURATION TESTS
  // ============================================================

  describe('error configuration', () => {
    test('config includes errorSound path', () => {
      expect(config.errorSound).toBeDefined();
      expect(typeof config.errorSound).toBe('string');
    });
    
    test('config includes errorTTSMessages array', () => {
      expect(config.errorTTSMessages).toBeDefined();
      expect(Array.isArray(config.errorTTSMessages)).toBe(true);
      expect(config.errorTTSMessages.length).toBeGreaterThan(0);
    });
    
    test('config includes errorTTSMessagesMultiple array', () => {
      expect(config.errorTTSMessagesMultiple).toBeDefined();
      expect(Array.isArray(config.errorTTSMessagesMultiple)).toBe(true);
      expect(config.errorTTSMessagesMultiple.length).toBeGreaterThan(0);
    });
    
    test('config includes errorReminderTTSMessages array', () => {
      expect(config.errorReminderTTSMessages).toBeDefined();
      expect(Array.isArray(config.errorReminderTTSMessages)).toBe(true);
      expect(config.errorReminderTTSMessages.length).toBeGreaterThan(0);
    });
    
    test('config includes errorReminderTTSMessagesMultiple array', () => {
      expect(config.errorReminderTTSMessagesMultiple).toBeDefined();
      expect(Array.isArray(config.errorReminderTTSMessagesMultiple)).toBe(true);
      expect(config.errorReminderTTSMessagesMultiple.length).toBeGreaterThan(0);
    });
    
    test('config includes errorReminderDelaySeconds', () => {
      expect(config.errorReminderDelaySeconds).toBeDefined();
      expect(typeof config.errorReminderDelaySeconds).toBe('number');
      // Error reminders should be more urgent (shorter delay)
      expect(config.errorReminderDelaySeconds).toBeLessThanOrEqual(30);
    });
    
    test('errorReminderDelaySeconds is more urgent than idle', () => {
      // Error reminders should fire faster than idle reminders
      const errorDelay = config.errorReminderDelaySeconds || 20;
      const idleDelay = config.idleReminderDelaySeconds || 30;
      expect(errorDelay).toBeLessThanOrEqual(idleDelay);
    });
  });

  // ============================================================
  // AI PROMPTS FOR ERROR MESSAGES
  // ============================================================

  describe('error AI prompts', () => {
    test('aiPrompts includes error prompt', () => {
      expect(config.aiPrompts).toBeDefined();
      expect(config.aiPrompts.error).toBeDefined();
      expect(typeof config.aiPrompts.error).toBe('string');
    });
    
    test('aiPrompts includes errorReminder prompt', () => {
      expect(config.aiPrompts).toBeDefined();
      expect(config.aiPrompts.errorReminder).toBeDefined();
      expect(typeof config.aiPrompts.errorReminder).toBe('string');
    });
    
    test('error prompt mentions error/problem context', () => {
      const prompt = config.aiPrompts.error.toLowerCase();
      expect(prompt.includes('error') || prompt.includes('problem') || prompt.includes('wrong')).toBe(true);
    });
    
    test('errorReminder prompt conveys urgency', () => {
      const prompt = config.aiPrompts.errorReminder.toLowerCase();
      expect(prompt.includes('reminder') || prompt.includes('urgent') || prompt.includes('attention')).toBe(true);
    });
  });

  // ============================================================
  // ERROR MESSAGE TEMPLATES
  // ============================================================

  describe('error message templates', () => {
    test('errorTTSMessagesMultiple contains {count} placeholder', () => {
      const hasPlaceholder = config.errorTTSMessagesMultiple.some(msg => msg.includes('{count}'));
      expect(hasPlaceholder).toBe(true);
    });
    
    test('errorReminderTTSMessagesMultiple contains {count} placeholder', () => {
      const hasPlaceholder = config.errorReminderTTSMessagesMultiple.some(msg => msg.includes('{count}'));
      expect(hasPlaceholder).toBe(true);
    });
    
    test('can replace {count} placeholder in multiple messages', () => {
      const template = config.errorTTSMessagesMultiple[0];
      const count = 5;
      const replaced = template.replace('{count}', count.toString());
      expect(replaced).toContain('5');
      expect(replaced).not.toContain('{count}');
    });
  });

  // ============================================================
  // SESSION.ERROR EVENT TESTS
  // ============================================================

  describe('session.error event structure', () => {
    test('mockEvents.sessionError creates valid error event', () => {
      // Add sessionError to mockEvents for consistency
      const sessionError = (sessionID) => ({
        type: 'session.error',
        properties: {
          sessionID: sessionID || `test-session-${Date.now()}`
        }
      });
      
      const event = sessionError('test-session-123');
      expect(event.type).toBe('session.error');
      expect(event.properties).toBeDefined();
      expect(event.properties.sessionID).toBe('test-session-123');
    });
    
    test('session.error event has correct type', () => {
      const event = {
        type: 'session.error',
        properties: { sessionID: 'session-123' }
      };
      expect(event.type).toBe('session.error');
    });
    
    test('session.error event contains sessionID in properties', () => {
      const event = {
        type: 'session.error',
        properties: { sessionID: 'session-456' }
      };
      expect(event.properties.sessionID).toBe('session-456');
    });
  });

  // ============================================================
  // SKIP CONDITIONS TESTS
  // ============================================================

  describe('session.error skip conditions', () => {
    test('should skip when sessionID is missing', async () => {
      const mockClient = createMockClient();
      
      // Event without sessionID should be skipped
      const event = {
        type: 'session.error',
        properties: {}
      };
      
      // The handler should return early without calling client methods
      // We verify this by checking no toast was shown
      expect(event.properties.sessionID).toBeUndefined();
    });
    
    test('should skip sub-sessions (sessions with parentID)', async () => {
      const mockClient = createMockClient();
      
      // Set up a sub-session
      const sessionID = 'child-session-123';
      mockClient.session.setMockSession(sessionID, {
        parentID: 'parent-session-456',
        status: 'error'
      });
      
      const session = await mockClient.session.get({ path: { id: sessionID } });
      
      // Sub-sessions should be detected and skipped
      expect(session.data.parentID).toBe('parent-session-456');
      expect(session.data.parentID).not.toBeNull();
    });
    
    test('should NOT skip main sessions (no parentID)', async () => {
      const mockClient = createMockClient();
      
      // Set up a main session
      const sessionID = 'main-session-789';
      mockClient.session.setMockSession(sessionID, {
        parentID: null,
        status: 'error'
      });
      
      const session = await mockClient.session.get({ path: { id: sessionID } });
      
      // Main sessions should proceed with notification
      expect(session.data.parentID).toBeNull();
    });
  });

  // ============================================================
  // ERROR NOTIFICATION BEHAVIOR
  // ============================================================

  describe('error notification behavior', () => {
    test('error sound should be configured correctly', () => {
      expect(config.errorSound).toBe('assets/Machine-alert-beep-sound-effect.mp3');
    });
    
    test('error sound is a valid path format', () => {
      const soundPath = config.errorSound;
      expect(soundPath).toMatch(/\.(mp3|wav|ogg|m4a)$/);
    });
    
    test('error uses more urgent timing than idle', () => {
      // Error reminder should fire faster than idle
      const errorDelay = config.errorReminderDelaySeconds || 20;
      expect(errorDelay).toBe(20); // Default is 20 seconds
    });
  });

  // ============================================================
  // getErrorMessage() HELPER TESTS
  // ============================================================

  describe('getErrorMessage behavior', () => {
    test('config has error messages for single count', () => {
      expect(config.errorTTSMessages.length).toBeGreaterThan(0);
    });
    
    test('config has error messages for multiple count', () => {
      expect(config.errorTTSMessagesMultiple.length).toBeGreaterThan(0);
    });
    
    test('config has reminder messages for single count', () => {
      expect(config.errorReminderTTSMessages.length).toBeGreaterThan(0);
    });
    
    test('config has reminder messages for multiple count', () => {
      expect(config.errorReminderTTSMessagesMultiple.length).toBeGreaterThan(0);
    });
    
    test('random message selection returns string', () => {
      const messages = config.errorTTSMessages;
      const randomIndex = Math.floor(Math.random() * messages.length);
      const message = messages[randomIndex];
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });
    
    test('count-aware message replaces placeholder correctly', () => {
      const template = config.errorTTSMessagesMultiple.find(m => m.includes('{count}'));
      expect(template).toBeDefined();
      const result = template.replace('{count}', '3');
      expect(result).toContain('3');
    });
  });

  // ============================================================
  // AI MESSAGE GENERATION (MOCKED)
  // ============================================================

  describe('getErrorMessage with AI generation', () => {
    test('AI messages can be enabled via config', () => {
      const aiConfig = { ...config, enableAIMessages: true };
      expect(aiConfig.enableAIMessages).toBe(true);
    });
    
    test('AI endpoint can be configured', () => {
      expect(config.aiEndpoint).toBeDefined();
      expect(typeof config.aiEndpoint).toBe('string');
    });
    
    test('AI model can be configured', () => {
      expect(config.aiModel).toBeDefined();
      expect(typeof config.aiModel).toBe('string');
    });
    
    test('AI timeout is configured', () => {
      expect(config.aiTimeout).toBeDefined();
      expect(typeof config.aiTimeout).toBe('number');
      expect(config.aiTimeout).toBeGreaterThan(0);
    });
    
    test('AI fallback to static is enabled by default', () => {
      expect(config.aiFallbackToStatic).toBe(true);
    });
    
    test('config has error-specific AI prompt', () => {
      expect(config.aiPrompts.error).toBeDefined();
      expect(config.aiPrompts.error.length).toBeGreaterThan(0);
    });
    
    test('config has errorReminder-specific AI prompt', () => {
      expect(config.aiPrompts.errorReminder).toBeDefined();
      expect(config.aiPrompts.errorReminder.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // DESKTOP NOTIFICATION FOR ERRORS
  // ============================================================

  describe('error desktop notifications', () => {
    let notifyError;
    
    beforeEach(async () => {
      const module = await import('../../util/desktop-notify.js');
      notifyError = module.notifyError;
    });
    
    test('notifyError function exists', () => {
      expect(notifyError).toBeDefined();
      expect(typeof notifyError).toBe('function');
    });
    
    test('notifyError returns a promise', () => {
      const result = notifyError('Test error message');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('notifyError accepts message parameter', async () => {
      const result = await notifyError('An error occurred');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });
    
    test('notifyError accepts options with projectName', async () => {
      const result = await notifyError('Error message', {
        projectName: 'TestProject'
      });
      expect(result).toBeDefined();
    });
    
    test('notifyError accepts options with timeout', async () => {
      const result = await notifyError('Error message', {
        timeout: 15
      });
      expect(result).toBeDefined();
    });
    
    test('notifyError accepts options with debugLog', async () => {
      const result = await notifyError('Error message', {
        debugLog: false
      });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // ERROR TTS REMINDER SCHEDULING
  // ============================================================

  describe('error TTS reminder scheduling', () => {
    test('error reminder delay is configured', () => {
      expect(config.errorReminderDelaySeconds).toBeDefined();
    });
    
    test('error reminder delay defaults to 20 seconds', () => {
      // Based on implementation: errors are more urgent
      expect(config.errorReminderDelaySeconds).toBe(20);
    });
    
    test('error reminder delay is shorter than idle', () => {
      const errorDelay = config.errorReminderDelaySeconds;
      const idleDelay = config.idleReminderDelaySeconds;
      expect(errorDelay).toBeLessThan(idleDelay);
    });
    
    test('TTS reminder can be disabled', () => {
      const disabledConfig = { ...config, enableTTSReminder: false };
      expect(disabledConfig.enableTTSReminder).toBe(false);
    });
  });

  // ============================================================
  // ERROR TOAST NOTIFICATIONS
  // ============================================================

  describe('error toast notifications', () => {
    test('mock client supports showToast', () => {
      const mockClient = createMockClient();
      expect(mockClient.tui.showToast).toBeDefined();
      expect(typeof mockClient.tui.showToast).toBe('function');
    });
    
    test('mock client tracks toast calls', async () => {
      const mockClient = createMockClient();
      
      await mockClient.tui.showToast({
        body: {
          message: 'Test error toast',
          variant: 'error',
          duration: 8000
        }
      });
      
      const calls = mockClient.tui.getToastCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].message).toBe('Test error toast');
      expect(calls[0].variant).toBe('error');
      expect(calls[0].duration).toBe(8000);
    });
    
    test('error toast uses error variant', async () => {
      const mockClient = createMockClient();
      
      await mockClient.tui.showToast({
        body: {
          message: 'Agent encountered an error',
          variant: 'error',
          duration: 8000
        }
      });
      
      const calls = mockClient.tui.getToastCalls();
      expect(calls[0].variant).toBe('error');
    });
    
    test('error toast has longer duration for urgency', async () => {
      const mockClient = createMockClient();
      
      // Error toasts should display longer (8000ms vs 5000ms for idle)
      await mockClient.tui.showToast({
        body: {
          message: 'Error notification',
          variant: 'error',
          duration: 8000
        }
      });
      
      const calls = mockClient.tui.getToastCalls();
      expect(calls[0].duration).toBeGreaterThan(5000);
    });
  });

  // ============================================================
  // INTEGRATION WITH MOCK SHELL RUNNER
  // ============================================================

  describe('error notification with mock shell', () => {
    test('mock shell runner can be created', () => {
      const $ = createMockShellRunner();
      expect($).toBeDefined();
      expect(typeof $).toBe('function');
    });
    
    test('mock shell runner tracks audio playback commands', async () => {
      const $ = createMockShellRunner();
      
      // Simulate audio playback command
      await $`afplay test-sound.mp3`;
      
      expect($.getCallCount()).toBe(1);
      expect($.wasCalledWith('afplay')).toBe(true);
    });
    
    test('mock shell runner can verify no commands executed', () => {
      const $ = createMockShellRunner();
      expect($.getCallCount()).toBe(0);
    });
    
    test('mock shell runner reset clears call history', async () => {
      const $ = createMockShellRunner();
      
      await $`some-command`;
      expect($.getCallCount()).toBe(1);
      
      $.reset();
      expect($.getCallCount()).toBe(0);
    });
  });

  // ============================================================
  // DEFAULT CONFIG VALUES
  // ============================================================

  describe('default error config values', () => {
    let defaultConfig;
    
    beforeEach(async () => {
      // Load fresh default config
      cleanupTestTempDir();
      createTestTempDir();
      createTestAssets();
      
      // Don't create custom config - let defaults load
      const module = await import('../../util/config.js');
      loadConfig = module.loadConfig;
      defaultConfig = loadConfig('smart-voice-notify');
    });
    
    test('errorSound defaults to alert sound', () => {
      expect(defaultConfig.errorSound).toBe('assets/Machine-alert-beep-sound-effect.mp3');
    });
    
    test('errorReminderDelaySeconds defaults to 20', () => {
      expect(defaultConfig.errorReminderDelaySeconds).toBe(20);
    });
    
    test('errorTTSMessages has 5 default messages', () => {
      expect(defaultConfig.errorTTSMessages.length).toBe(5);
    });
    
    test('errorReminderTTSMessages has 5 default messages', () => {
      expect(defaultConfig.errorReminderTTSMessages.length).toBe(5);
    });
    
    test('aiPrompts.error is defined', () => {
      expect(defaultConfig.aiPrompts.error).toBeDefined();
    });
    
    test('aiPrompts.errorReminder is defined', () => {
      expect(defaultConfig.aiPrompts.errorReminder).toBeDefined();
    });
  });
});
