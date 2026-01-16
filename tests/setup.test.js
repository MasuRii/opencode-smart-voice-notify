/**
 * Setup Infrastructure Smoke Test
 * 
 * Verifies that the test setup preload works correctly.
 * This test validates all the helper functions and mock factories.
 * 
 * @see docs/ARCHITECT_PLAN.md - Phase 0, Task 0.3
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';

import {
  createTestTempDir,
  cleanupTestTempDir,
  getTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createTestLogsDir,
  readTestFile,
  testFileExists,
  createMockShellRunner,
  createMockClient,
  createMockEvent,
  mockEvents,
  wait,
  waitFor,
  createConsoleCapture
} from './setup.js';

describe('Test Setup Infrastructure', () => {
  
  describe('Temporary Directory Management', () => {
    
    test('createTestTempDir creates a unique directory', () => {
      const tempDir = createTestTempDir();
      
      expect(tempDir).toBeTruthy();
      expect(fs.existsSync(tempDir)).toBe(true);
      expect(process.env.OPENCODE_CONFIG_DIR).toBe(tempDir);
    });
    
    test('getTestTempDir returns the same directory', () => {
      const dir1 = createTestTempDir();
      const dir2 = getTestTempDir();
      
      expect(dir1).toBe(dir2);
    });
    
    test('cleanupTestTempDir removes the directory', () => {
      const tempDir = createTestTempDir();
      expect(fs.existsSync(tempDir)).toBe(true);
      
      cleanupTestTempDir();
      
      expect(fs.existsSync(tempDir)).toBe(false);
      expect(process.env.OPENCODE_CONFIG_DIR).toBeUndefined();
    });
  });
  
  describe('Test Fixture Helpers', () => {
    
    beforeEach(() => {
      createTestTempDir();
    });
    
    test('createTestConfig writes a config file', () => {
      const config = { enabled: true, testValue: 42 };
      const configPath = createTestConfig(config);
      
      expect(fs.existsSync(configPath)).toBe(true);
      
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.enabled).toBe(true);
      expect(parsed.testValue).toBe(42);
    });
    
    test('createMinimalConfig returns sensible test defaults', () => {
      const config = createMinimalConfig();
      
      expect(config._configVersion).toBe('1.0.0');
      expect(config.enabled).toBe(true);
      expect(config.enableTTS).toBe(false);
      expect(config.enableSound).toBe(false);
      expect(config.enableToast).toBe(false);
    });
    
    test('createMinimalConfig accepts overrides', () => {
      const config = createMinimalConfig({ enabled: false, customKey: 'value' });
      
      expect(config.enabled).toBe(false);
      expect(config.customKey).toBe('value');
      expect(config.enableTTS).toBe(false);  // Default preserved
    });
    
    test('createTestAssets creates audio files', () => {
      const assetsDir = createTestAssets();
      
      expect(fs.existsSync(assetsDir)).toBe(true);
      expect(fs.existsSync(path.join(assetsDir, 'test-sound.mp3'))).toBe(true);
      expect(fs.existsSync(path.join(assetsDir, 'Soft-high-tech-notification-sound-effect.mp3'))).toBe(true);
    });
    
    test('createTestLogsDir creates logs directory', () => {
      const logsDir = createTestLogsDir();
      
      expect(fs.existsSync(logsDir)).toBe(true);
    });
    
    test('readTestFile reads file content', () => {
      createTestConfig({ key: 'value' });
      
      const content = readTestFile('smart-voice-notify.jsonc');
      
      expect(content).toBeTruthy();
      expect(content).toContain('key');
    });
    
    test('readTestFile returns null for missing file', () => {
      const content = readTestFile('nonexistent.txt');
      
      expect(content).toBeNull();
    });
    
    test('testFileExists returns correct status', () => {
      createTestConfig({});
      
      expect(testFileExists('smart-voice-notify.jsonc')).toBe(true);
      expect(testFileExists('nonexistent.txt')).toBe(false);
    });
  });
  
  describe('Mock Shell Runner', () => {
    
    test('records executed commands', async () => {
      const $ = createMockShellRunner();
      
      await $`echo "hello"`;
      await $`ls -la`;
      
      expect($.getCallCount()).toBe(2);
      expect($.getCalls()[0].command).toBe('echo "hello"');
      expect($.getCalls()[1].command).toBe('ls -la');
    });
    
    test('wasCalledWith checks command history', async () => {
      const $ = createMockShellRunner();
      
      await $`git status`;
      
      expect($.wasCalledWith('git')).toBe(true);
      expect($.wasCalledWith('npm')).toBe(false);
      expect($.wasCalledWith(/status/)).toBe(true);
    });
    
    test('reset clears command history', async () => {
      const $ = createMockShellRunner();
      
      await $`command1`;
      await $`command2`;
      
      expect($.getCallCount()).toBe(2);
      
      $.reset();
      
      expect($.getCallCount()).toBe(0);
    });
    
    test('custom handler can return mock data', async () => {
      const $ = createMockShellRunner({
        handler: (cmd) => ({
          stdout: Buffer.from('custom output'),
          text: () => 'custom output'
        })
      });
      
      const result = await $`some command`;
      
      expect(result.text()).toBe('custom output');
    });
  });
  
  describe('Mock Client', () => {
    
    test('showToast records calls', async () => {
      const client = createMockClient();
      
      await client.tui.showToast({ body: { message: 'Test', variant: 'info', duration: 5000 } });
      
      const calls = client.tui.getToastCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].message).toBe('Test');
      expect(calls[0].variant).toBe('info');
    });
    
    test('session.get returns mock data', async () => {
      const client = createMockClient();
      
      client.session.setMockSession('test-123', { status: 'running', parentID: null });
      
      const result = await client.session.get({ path: { id: 'test-123' } });
      
      expect(result.data.id).toBe('test-123');
      expect(result.data.status).toBe('running');
      expect(result.data.parentID).toBeNull();
    });
    
    test('session.get returns default for unknown session', async () => {
      const client = createMockClient();
      
      const result = await client.session.get({ path: { id: 'unknown' } });
      
      expect(result.data.id).toBe('unknown');
      expect(result.data.status).toBe('idle');
    });
  });
  
  describe('Mock Events', () => {
    
    test('createMockEvent creates proper structure', () => {
      const event = createMockEvent('session.idle', { sessionID: 'abc123' });
      
      expect(event.type).toBe('session.idle');
      expect(event.properties.sessionID).toBe('abc123');
    });
    
    test('mockEvents.sessionIdle creates idle event', () => {
      const event = mockEvents.sessionIdle('sess-1');
      
      expect(event.type).toBe('session.idle');
      expect(event.properties.sessionID).toBe('sess-1');
    });
    
    test('mockEvents.permissionAsked creates permission event', () => {
      const event = mockEvents.permissionAsked('perm-1', 'sess-1');
      
      expect(event.type).toBe('permission.asked');
      expect(event.properties.id).toBe('perm-1');
      expect(event.properties.sessionID).toBe('sess-1');
    });
    
    test('mockEvents.questionAsked creates question event with questions array', () => {
      const event = mockEvents.questionAsked('q-1', 'sess-1', [
        { text: 'Question 1?' },
        { text: 'Question 2?' }
      ]);
      
      expect(event.type).toBe('question.asked');
      expect(event.properties.id).toBe('q-1');
      expect(event.properties.questions.length).toBe(2);
    });
    
    test('mockEvents.messageUpdated creates message event', () => {
      const event = mockEvents.messageUpdated('msg-1', 'user', 'sess-1');
      
      expect(event.type).toBe('message.updated');
      expect(event.properties.info.id).toBe('msg-1');
      expect(event.properties.info.role).toBe('user');
    });
  });
  
  describe('Async Utilities', () => {
    
    test('wait pauses execution', async () => {
      const start = Date.now();
      await wait(50);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(45);  // Allow some variance
    });
    
    test('waitFor resolves when condition is true', async () => {
      let value = false;
      setTimeout(() => { value = true; }, 50);
      
      await waitFor(() => value, 1000, 10);
      
      expect(value).toBe(true);
    });
    
    test('waitFor throws on timeout', async () => {
      await expect(waitFor(() => false, 100, 10)).rejects.toThrow('Condition not met');
    });
  });
  
  describe('Console Capture', () => {
    
    test('captures console output', () => {
      const capture = createConsoleCapture();
      
      capture.start();
      console.log('test message');
      console.warn('warning');
      capture.stop();
      
      const logs = capture.get();
      expect(logs.log.length).toBe(1);
      expect(logs.warn.length).toBe(1);
      expect(logs.log[0][0]).toBe('test message');
    });
    
    test('restores console after stop', () => {
      const capture = createConsoleCapture();
      const originalLog = console.log;
      
      capture.start();
      expect(console.log).not.toBe(originalLog);
      
      capture.stop();
      expect(console.log).toBe(originalLog);
    });
  });
  
  describe('Environment Variables', () => {
    
    test('NODE_ENV is set to test', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });
    
    test('OPENCODE_CONFIG_DIR is set when temp dir created', () => {
      const tempDir = createTestTempDir();
      
      expect(process.env.OPENCODE_CONFIG_DIR).toBe(tempDir);
    });
  });
});
