import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { generateAIMessage, getSmartMessage, testAIConnection } from '../../util/ai-messages.js';
import { createTestTempDir, cleanupTestTempDir, createTestConfig } from '../setup.js';

describe('AI Message Generation Module', () => {
  let originalFetch;

  beforeEach(() => {
    createTestTempDir();
    originalFetch = globalThis.fetch;
    
    // Set up default test configuration via file instead of mocking module
    createTestConfig({
      enableAIMessages: true,
      aiEndpoint: 'http://localhost:11434/v1',
      aiModel: 'llama3',
      aiApiKey: 'test-key',
      aiTimeout: 1000,
      aiFallbackToStatic: true,
      aiPrompts: {
        idle: 'Generate a message for idle state',
        permission: 'Generate a message for permission state',
        question: 'Generate a message for question state'
      }
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanupTestTempDir();
  });

  describe('generateAIMessage()', () => {
    it('should return null when AI messages are disabled', async () => {
      createTestConfig({ enableAIMessages: false });
      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });

    it('should return null when prompt type is missing in config', async () => {
      const result = await generateAIMessage('unknown-type');
      expect(result).toBeNull();
    });

    it('should make correct API call and return cleaned message', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '"This is a generated message"'
            }
          }]
        })
      }));

      const result = await generateAIMessage('idle');
      
      expect(globalThis.fetch).toHaveBeenCalled();
      const [url, options] = globalThis.fetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/v1/chat/completions');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      
      const body = JSON.parse(options.body);
      expect(body.model).toBe('llama3');
      expect(body.messages[1].content).toBe('Generate a message for idle state');
      
      expect(result).toBe('This is a generated message');
    });

    it('should inject count context for batched notifications', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'Batched message'
            }
          }]
        })
      }));

      await generateAIMessage('permission', { count: 3, type: 'permission' });
      
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1].content).toContain('3 permission requests');
    });

    it('should handle API errors gracefully', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: false,
        status: 500
      }));

      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });

    it('should handle network exceptions gracefully', async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error('Network error')));

      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });

    it('should reject messages that are too short', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'Hi'
            }
          }]
        })
      }));

      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });

    it('should reject messages that are too long', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'a'.repeat(201)
            }
          }]
        })
      }));

      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });

    it('should handle timeout correctly', async () => {
      globalThis.fetch = mock(async (url, options) => {
        const { signal } = options;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve({ ok: true, json: () => ({ choices: [] }) }), 2000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('AbortError'));
          });
        });
      });

      const result = await generateAIMessage('idle');
      expect(result).toBeNull();
    });
  });

  describe('getSmartMessage()', () => {
    const staticMessages = ['Static 1', 'Static 2'];

    it('should return AI message when enabled and successful', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'AI Message'
            }
          }]
        })
      }));

      const result = await getSmartMessage('idle', false, staticMessages);
      expect(result).toBe('AI Message');
    });

    it('should fall back to random static message when AI fails', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: false
      }));

      const result = await getSmartMessage('idle', false, staticMessages);
      expect(staticMessages).toContain(result);
    });

    it('should fall back to random static message when AI disabled', async () => {
      createTestConfig({ enableAIMessages: false });
      const result = await getSmartMessage('idle', false, staticMessages);
      expect(staticMessages).toContain(result);
    });

    it('should return generic message when AI fails and fallback is disabled', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        aiFallbackToStatic: false 
      });
      globalThis.fetch = mock(() => Promise.resolve({
        ok: false
      }));

      const result = await getSmartMessage('idle', false, staticMessages);
      expect(result).toBe('Notification: Please check your screen.');
    });

    it('should handle empty static messages array', async () => {
      createTestConfig({ enableAIMessages: false });
      const result = await getSmartMessage('idle', false, []);
      expect(result).toBe('Notification');
    });
  });

  describe('testAIConnection()', () => {
    it('should return error if AI messages not enabled', async () => {
      createTestConfig({ enableAIMessages: false });
      const result = await testAIConnection();
      expect(result.success).toBe(false);
      expect(result.message).toBe('AI messages not enabled');
    });

    it('should return success with model list on successful connection', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'model1' }, { id: 'model2' }]
        })
      }));

      const result = await testAIConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Connected!');
      expect(result.models).toEqual(['model1', 'model2']);
    });

    it('should return error on non-2xx status', async () => {
      globalThis.fetch = mock(() => Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }));

      const result = await testAIConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('HTTP 404');
    });

    // Timeout test needs longer than the 5000ms abort delay in testAIConnection
    it('should handle timeout', async () => {
      globalThis.fetch = mock(async (url, options) => {
        const { signal } = options;
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const result = await testAIConnection();
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection timed out');
    }, 10000); // Increase timeout to 10s to allow for the 5s abort
  });

  describe('Context-Aware AI (aiContext parameter)', () => {
    it('should inject project name into prompt when enableContextAwareAI is true', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'AI generated message' } }]
        })
      }));

      await generateAIMessage('idle', { projectName: 'MyProject' });
      
      expect(globalThis.fetch).toHaveBeenCalled();
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1].content).toContain('MyProject');
    });

    it('should inject session title into prompt when provided', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'AI generated message' } }]
        })
      }));

      await generateAIMessage('idle', { sessionTitle: 'Fix login bug' });
      
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1].content).toContain('Fix login bug');
    });

    it('should inject session summary into prompt when provided', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'AI generated message' } }]
        })
      }));

      await generateAIMessage('idle', { 
        sessionSummary: { files: 5, additions: 100, deletions: 20 }
      });
      
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1].content).toContain('5 file');
      expect(body.messages[1].content).toContain('+100');
      expect(body.messages[1].content).toContain('-20');
    });

    it('should NOT inject context when enableContextAwareAI is false', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: false,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'AI generated message' } }]
        })
      }));

      await generateAIMessage('idle', { projectName: 'MyProject', sessionTitle: 'My Task' });
      
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      // Should NOT contain context since feature is disabled
      expect(body.messages[1].content).not.toContain('MyProject');
      expect(body.messages[1].content).not.toContain('My Task');
    });

    it('should handle missing context gracefully', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Valid AI message here' } }]
        })
      }));

      // No context provided - should not throw
      const result = await generateAIMessage('idle', {});
      expect(result).toBe('Valid AI message here');
    });

    it('should pass context through getSmartMessage', async () => {
      createTestConfig({ 
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiPrompts: { idle: 'Test prompt' }
      });
      
      globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Context-aware response' } }]
        })
      }));

      const result = await getSmartMessage('idle', false, ['fallback'], {
        projectName: 'TestProject'
      });
      
      expect(result).toBe('Context-aware response');
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1].content).toContain('TestProject');
    });
  });
});