/**
 * Unit Tests for Configuration Module
 * 
 * Tests for util/config.js configuration loading and merging functionality.
 * Focuses on Task 1.7: Testing new desktop notification config fields.
 * 
 * @see util/config.js
 * @see docs/ARCHITECT_PLAN.md - Phase 1, Task 1.7
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestConfig,
  createTestAssets,
  readTestFile
} from '../setup.js';
import fs from 'fs';
import path from 'path';

describe('config module', () => {
  let loadConfig;
  let parseJSONC;
  let deepMerge;
  let findNewFields;
  let getDefaultConfigObject;
  let formatJSON;
  
  beforeEach(async () => {
    // Create test temp directory before each test
    createTestTempDir();
    createTestAssets();
    
    // Fresh import of the module (loadConfig uses OPENCODE_CONFIG_DIR env var)
    const module = await import('../../util/config.js');
    loadConfig = module.loadConfig;
    parseJSONC = module.parseJSONC;
    deepMerge = module.deepMerge;
    findNewFields = module.findNewFields;
    getDefaultConfigObject = module.getDefaultConfigObject;
    formatJSON = module.formatJSON;
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  // ============================================================
  // UTILITY FUNCTIONS (Task T.1)
  // ============================================================

  describe('parseJSONC', () => {
    test('strips single-line comments', () => {
      const jsonc = '{\n  // comment\n  "key": "value"\n}';
      const result = parseJSONC(jsonc);
      expect(result).toEqual({ key: "value" });
    });

    test('strips multi-line comments', () => {
      const jsonc = '{\n  /* comment \n multi-line */\n  "key": "value"\n}';
      const result = parseJSONC(jsonc);
      expect(result).toEqual({ key: "value" });
    });

    test('preserves strings containing //', () => {
      const jsonc = '{"url": "https://example.com"}';
      const result = parseJSONC(jsonc);
      expect(result).toEqual({ url: "https://example.com" });
    });

    test('handles empty input', () => {
      expect(() => parseJSONC('')).toThrow();
    });

    test('handles trailing comma gracefully (Bun JSON5 behavior)', () => {
      const jsonc = '{\n  // comment\n  "key": "value",\n}'; // Trailing comma - Bun's parser accepts this
      const result = parseJSONC(jsonc);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe('deepMerge', () => {
    test('user values override defaults', () => {
      const defaults = { a: 1, b: 2 };
      const user = { b: 3 };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ a: 1, b: 3 });
    });

    test('new keys from defaults are added', () => {
      const defaults = { a: 1, b: 2 };
      const user = { a: 0 };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ a: 0, b: 2 });
    });

    test('nested objects are recursively merged', () => {
      const defaults = { nested: { a: 1, b: 2 } };
      const user = { nested: { b: 3 } };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ nested: { a: 1, b: 3 } });
    });

    test('arrays are NOT merged (user wins)', () => {
      const defaults = { list: [1, 2] };
      const user = { list: [3] };
      const result = deepMerge(defaults, user);
      expect(result).toEqual({ list: [3] });
    });

    test('null/undefined user values use defaults', () => {
      const defaults = { a: 1 };
      expect(deepMerge(defaults, null)).toEqual({ a: 1 });
      expect(deepMerge(defaults, undefined)).toEqual({ a: 1 });
    });

    test('handles circular references gracefully', () => {
      const defaults = { a: 1 };
      const user = { b: 2 };
      user.self = user;
      // Should not throw, but behavior for circular is "keep user's value"
      const result = deepMerge(defaults, user);
      expect(result.b).toBe(2);
      expect(result.self).toBe(user);
    });
  });

  describe('findNewFields', () => {
    test('identifies top-level new fields', () => {
      const defaults = { a: 1, b: 2 };
      const user = { a: 1 };
      const result = findNewFields(defaults, user);
      expect(result).toEqual(['b']);
    });

    test('identifies nested new fields with dot notation', () => {
      const defaults = { nested: { a: 1, b: 2 } };
      const user = { nested: { a: 1 } };
      const result = findNewFields(defaults, user);
      expect(result).toEqual(['nested.b']);
    });

    test('returns empty array when no new fields', () => {
      const defaults = { a: 1 };
      const user = { a: 1, b: 2 };
      const result = findNewFields(defaults, user);
      expect(result).toEqual([]);
    });

    test('handles arrays correctly (not recursed)', () => {
      const defaults = { list: [1, 2] };
      const user = { list: [1] };
      const result = findNewFields(defaults, user);
      expect(result).toEqual([]);
    });
  });

  describe('getDefaultConfigObject', () => {
    test('returns object with all expected keys', () => {
      const config = getDefaultConfigObject();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('notificationMode');
      expect(config).toHaveProperty('idleTTSMessages');
    });

    test('all default values are valid types', () => {
      const config = getDefaultConfigObject();
      expect(typeof config.enabled).toBe('boolean');
      expect(Array.isArray(config.idleTTSMessages)).toBe(true);
    });

    test('_configVersion is null by default', () => {
      const config = getDefaultConfigObject();
      expect(config._configVersion).toBeNull();
    });
  });

  describe('formatJSON', () => {
    test('outputs valid JSON string', () => {
      const data = { a: 1 };
      const result = formatJSON(data);
      expect(JSON.parse(result)).toEqual(data);
    });

    test('applies indentation correctly', () => {
      const data = { a: 1 };
      const result = formatJSON(data, 4);
      // First line should not be indented, subsequent lines should
      expect(result).toContain('\n    ');
    });
  });

  // ============================================================
  // NEW DESKTOP NOTIFICATION CONFIG FIELDS (Task 1.7)
  // ============================================================

  describe('enableDesktopNotification default value', () => {
    test('returns true when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.enableDesktopNotification).toBe(true);
    });
    
    test('returns true when config file exists without the field', () => {
      // Create a config without the enableDesktopNotification field
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true,
        notificationMode: 'sound-first'
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.enableDesktopNotification).toBe(true);
    });
    
    test('preserves user value when set to false', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableDesktopNotification: false
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.enableDesktopNotification).toBe(false);
    });
    
    test('preserves user value when explicitly set to true', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableDesktopNotification: true
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.enableDesktopNotification).toBe(true);
    });
  });

  describe('desktopNotificationTimeout default value', () => {
    test('returns 5 when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.desktopNotificationTimeout).toBe(5);
    });
    
    test('returns 5 when config file exists without the field', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true,
        notificationMode: 'sound-first'
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.desktopNotificationTimeout).toBe(5);
    });
    
    test('preserves user value when set to different number', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        desktopNotificationTimeout: 10
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.desktopNotificationTimeout).toBe(10);
    });
    
    test('preserves user value when set to 0', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        desktopNotificationTimeout: 0
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.desktopNotificationTimeout).toBe(0);
    });
    
    test('preserves user value when set to 1', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        desktopNotificationTimeout: 1
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.desktopNotificationTimeout).toBe(1);
    });
  });

  describe('showProjectInNotification default value', () => {
    test('returns true when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.showProjectInNotification).toBe(true);
    });
    
    test('returns true when config file exists without the field', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true,
        notificationMode: 'sound-first'
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.showProjectInNotification).toBe(true);
    });
    
    test('preserves user value when set to false', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        showProjectInNotification: false
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.showProjectInNotification).toBe(false);
    });
    
    test('preserves user value when explicitly set to true', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        showProjectInNotification: true
      });
      
      const config = loadConfig('smart-voice-notify');
      expect(config.showProjectInNotification).toBe(true);
    });
  });

  // ============================================================
  // GRANULAR NOTIFICATION CONTROL (User Message Request)
  // ============================================================

  describe('granular notification control default values', () => {
    test('returns true for all granular enable flags when no config file exists', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.enableIdleNotification).toBe(true);
      expect(config.enablePermissionNotification).toBe(true);
      expect(config.enableQuestionNotification).toBe(true);
      expect(config.enableErrorNotification).toBe(false);
      expect(config.enableIdleReminder).toBe(true);
      expect(config.enablePermissionReminder).toBe(true);
      expect(config.enableQuestionReminder).toBe(true);
      expect(config.enableErrorReminder).toBe(false);
    });

    test('preserves user granular enable flags', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableIdleNotification: false,
        enablePermissionNotification: true,
        enableErrorNotification: false,
        enableIdleReminder: false
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.enableIdleNotification).toBe(false);
      expect(config.enablePermissionNotification).toBe(true);
      expect(config.enableQuestionNotification).toBe(true); // Default
      expect(config.enableErrorNotification).toBe(false);
      expect(config.enableIdleReminder).toBe(false);
      expect(config.enablePermissionReminder).toBe(true); // Default
    });
  });

  // ============================================================
  // WEBHOOK NOTIFICATION CONFIG FIELDS (Task 4.2)
  // ============================================================

  describe('webhook config fields', () => {
    test('all webhook fields have correct defaults', () => {
      const config = loadConfig('smart-voice-notify');
      expect(config.enableWebhook).toBe(false);
      expect(config.webhookMentionOnPermission).toBe(false);
      expect(config.perProjectSounds).toBe(false);
      expect(config.projectSoundSeed).toBe(0);
    });

    test('preserves user webhook settings', () => {
      const customEvents = ["idle", "error"];
      createTestConfig({
        _configVersion: '1.0.0',
        enableWebhook: true,
        webhookUrl: "https://discord.com/api/webhooks/123",
        webhookUsername: "Custom Bot",
        webhookEvents: customEvents,
        webhookMentionOnPermission: true
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.enableWebhook).toBe(true);
      expect(config.webhookUrl).toBe("https://discord.com/api/webhooks/123");
      expect(config.webhookUsername).toBe("Custom Bot");
      expect(config.webhookEvents).toEqual(customEvents);
      expect(config.webhookMentionOnPermission).toBe(true);
    });

    test('preserves partial webhook config', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableWebhook: true,
        webhookUrl: "https://discord.com/api/webhooks/123"
        // Other fields missing
      });

      const config = loadConfig('smart-voice-notify');
      expect(config.enableWebhook).toBe(true);
      expect(config.webhookUrl).toBe("https://discord.com/api/webhooks/123");
      // Missing fields should use defaults
      expect(config.webhookUsername).toBe("OpenCode Notify");
      expect(config.webhookEvents).toEqual(["idle", "permission", "error", "question"]);
      expect(config.webhookMentionOnPermission).toBe(false);
    });
  });

  describe('deep merge preserves user values for new fields', () => {
    test('preserves all existing user config values when adding new fields', () => {
      // Create a config with user-customized values (simulating an old version)
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: false,
        notificationMode: 'tts-first',
        enableTTS: false,
        ttsEngine: 'edge',
        edgeVoice: 'en-US-AriaNeural',
        idleReminderDelaySeconds: 60
        // Desktop notification fields are missing - should be added
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // Verify user values are preserved
      expect(config.enabled).toBe(false);
      expect(config.notificationMode).toBe('tts-first');
      expect(config.enableTTS).toBe(false);
      expect(config.ttsEngine).toBe('edge');
      expect(config.edgeVoice).toBe('en-US-AriaNeural');
      expect(config.idleReminderDelaySeconds).toBe(60);
      
      // Verify new fields are added with defaults
      expect(config.enableDesktopNotification).toBe(true);
      expect(config.desktopNotificationTimeout).toBe(5);
      expect(config.showProjectInNotification).toBe(true);
      
      // Verify webhook fields are added with defaults
      expect(config.enableWebhook).toBe(false);
      expect(config.webhookUrl).toBe("");
    });
    
    test('preserves user arrays without merging them', () => {
      const customMessages = ['Custom message 1', 'Custom message 2'];
      
      createTestConfig({
        _configVersion: '1.0.0',
        idleTTSMessages: customMessages
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // User's array should completely replace default
      expect(config.idleTTSMessages).toEqual(customMessages);
      expect(config.idleTTSMessages.length).toBe(2);
    });
    
    test('preserves nested user objects while adding new nested fields', () => {
      const customPrompts = {
        idle: 'Custom idle prompt',
        permission: 'Custom permission prompt'
        // Other prompts missing - should be added
      };
      
      createTestConfig({
        _configVersion: '1.0.0',
        aiPrompts: customPrompts
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // User values preserved
      expect(config.aiPrompts.idle).toBe('Custom idle prompt');
      expect(config.aiPrompts.permission).toBe('Custom permission prompt');
      
      // Missing nested fields added from defaults
      expect(config.aiPrompts.question).toBeDefined();
      expect(config.aiPrompts.idleReminder).toBeDefined();
      expect(config.aiPrompts.permissionReminder).toBeDefined();
      expect(config.aiPrompts.questionReminder).toBeDefined();
    });
    
    test('preserves partial desktop notification config values', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableDesktopNotification: false,
        desktopNotificationTimeout: 15
        // showProjectInNotification missing
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // User values preserved
      expect(config.enableDesktopNotification).toBe(false);
      expect(config.desktopNotificationTimeout).toBe(15);
      
      // Missing field added with default
      expect(config.showProjectInNotification).toBe(true);
    });
    
    test('preserves null user value (user explicitly set null)', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enableDesktopNotification: null
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // When user explicitly sets a field to null, it should be preserved
      // This is intentional - deepMerge respects user's explicit choices
      expect(config.enableDesktopNotification).toBe(null);
    });
    
    test('uses default when field is missing (undefined)', () => {
      createTestConfig({
        _configVersion: '1.0.0',
        enabled: true
        // enableDesktopNotification is not defined at all
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // When field is missing, default should be applied
      expect(config.enableDesktopNotification).toBe(true);
    });
  });

  // ============================================================
  // ADDITIONAL CONFIG TESTS
  // ============================================================

  describe('loadConfig behavior', () => {
    test('creates config file when none exists', () => {
      const tempDir = process.env.OPENCODE_CONFIG_DIR;
      const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
      
      // File should not exist before loadConfig
      expect(fs.existsSync(configPath)).toBe(false);
      
      // Load config
      loadConfig('smart-voice-notify');
      
      // File should now exist
      expect(fs.existsSync(configPath)).toBe(true);
    });
    
    test('returns config object with all expected fields', () => {
      const config = loadConfig('smart-voice-notify');
      
      // Check essential fields exist
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('notificationMode');
      expect(config).toHaveProperty('enableTTS');
      expect(config).toHaveProperty('ttsEngine');
      expect(config).toHaveProperty('enableDesktopNotification');
      expect(config).toHaveProperty('desktopNotificationTimeout');
      expect(config).toHaveProperty('showProjectInNotification');
      expect(config).toHaveProperty('enableWebhook');
      expect(config).toHaveProperty('webhookUrl');
      expect(config).toHaveProperty('enableSound');
      expect(config).toHaveProperty('enableToast');
      expect(config).toHaveProperty('debugLog');
    });
    
    test('config file contains JSONC comments', () => {
      loadConfig('smart-voice-notify');
      
      const content = readTestFile('smart-voice-notify.jsonc');
      expect(content).toContain('//');
      expect(content).toContain('DESKTOP NOTIFICATION SETTINGS');
      expect(content).toContain('WEBHOOK NOTIFICATION SETTINGS');
    });
    
    test('handles invalid JSONC gracefully by creating new config', () => {
      const tempDir = process.env.OPENCODE_CONFIG_DIR;
      const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
      
      // Create an invalid JSONC file
      fs.writeFileSync(configPath, '{ invalid json content', 'utf-8');
      
      // loadConfig should handle gracefully and return defaults
      const config = loadConfig('smart-voice-notify');
      
      expect(config.enabled).toBe(true);
      expect(config.enableDesktopNotification).toBe(true);
    });
    
    test('updates _configVersion on load', () => {
      // Create config with old version
      createTestConfig({
        _configVersion: '0.0.1',
        enabled: true
      });
      
      const config = loadConfig('smart-voice-notify');
      
      // Version should be updated to current package version
      expect(config._configVersion).not.toBe('0.0.1');
      expect(config._configVersion).toBeDefined();
    });
  });

  describe('default values for all fields', () => {
    test('all default values have correct types', () => {
      const config = loadConfig('smart-voice-notify');
      
      // Booleans
      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.enableTTS).toBe('boolean');
      expect(typeof config.enableTTSReminder).toBe('boolean');
      expect(typeof config.enableFollowUpReminders).toBe('boolean');
      expect(typeof config.wakeMonitor).toBe('boolean');
      expect(typeof config.forceVolume).toBe('boolean');
      expect(typeof config.enableToast).toBe('boolean');
      expect(typeof config.enableSound).toBe('boolean');
      expect(typeof config.enableDesktopNotification).toBe('boolean');
      expect(typeof config.showProjectInNotification).toBe('boolean');
      expect(typeof config.debugLog).toBe('boolean');
      expect(typeof config.enableAIMessages).toBe('boolean');
      expect(typeof config.aiFallbackToStatic).toBe('boolean');
      expect(typeof config.enableWebhook).toBe('boolean');
      expect(typeof config.webhookMentionOnPermission).toBe('boolean');
      expect(typeof config.perProjectSounds).toBe('boolean');
      
      // Numbers
      expect(typeof config.ttsReminderDelaySeconds).toBe('number');
      expect(typeof config.idleReminderDelaySeconds).toBe('number');
      expect(typeof config.permissionReminderDelaySeconds).toBe('number');
      expect(typeof config.maxFollowUpReminders).toBe('number');
      expect(typeof config.reminderBackoffMultiplier).toBe('number');
      expect(typeof config.volumeThreshold).toBe('number');
      expect(typeof config.desktopNotificationTimeout).toBe('number');
      expect(typeof config.idleThresholdSeconds).toBe('number');
      expect(typeof config.permissionBatchWindowMs).toBe('number');
      expect(typeof config.questionBatchWindowMs).toBe('number');
      expect(typeof config.questionReminderDelaySeconds).toBe('number');
      expect(typeof config.aiTimeout).toBe('number');
      expect(typeof config.projectSoundSeed).toBe('number');
      
      // Strings
      expect(typeof config.notificationMode).toBe('string');
      expect(typeof config.ttsEngine).toBe('string');
      expect(typeof config.elevenLabsVoiceId).toBe('string');
      expect(typeof config.elevenLabsModel).toBe('string');
      expect(typeof config.edgeVoice).toBe('string');
      expect(typeof config.edgePitch).toBe('string');
      expect(typeof config.edgeRate).toBe('string');
      expect(typeof config.idleSound).toBe('string');
      expect(typeof config.permissionSound).toBe('string');
      expect(typeof config.questionSound).toBe('string');
      expect(typeof config.webhookUrl).toBe('string');
      expect(typeof config.webhookUsername).toBe('string');
      
      // Arrays
      expect(Array.isArray(config.idleTTSMessages)).toBe(true);
      expect(Array.isArray(config.permissionTTSMessages)).toBe(true);
      expect(Array.isArray(config.questionTTSMessages)).toBe(true);
      expect(Array.isArray(config.idleReminderTTSMessages)).toBe(true);
      expect(Array.isArray(config.permissionReminderTTSMessages)).toBe(true);
      expect(Array.isArray(config.questionReminderTTSMessages)).toBe(true);
      expect(Array.isArray(config.webhookEvents)).toBe(true);
      
      // Objects
      expect(typeof config.aiPrompts).toBe('object');
      expect(config.aiPrompts).not.toBe(null);
    });
    
    test('notification mode has valid default value', () => {
      const config = loadConfig('smart-voice-notify');
      expect(['sound-first', 'tts-first', 'both', 'sound-only']).toContain(config.notificationMode);
    });
    
    test('tts engine has valid default value', () => {
      const config = loadConfig('smart-voice-notify');
      expect(['elevenlabs', 'edge', 'sapi', 'openai']).toContain(config.ttsEngine);
    });
  });
});
