/**
 * Unit Tests for Webhook Integration Module
 * 
 * Tests for util/webhook.js Discord webhook integration.
 * 
 * @see util/webhook.js
 * @see docs/ARCHITECT_PLAN.md - Phase 4, Task 4.5
 */

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir,
  readTestFile,
  wait
} from '../setup.js';

describe('webhook module', () => {
  let webhook;
  
  beforeEach(async () => {
    createTestTempDir();
    createTestLogsDir();
    
    // Fresh import
    const module = await import('../../util/webhook.js');
    webhook = module.default;
    // Reset rate limit state for each test
    module.resetRateLimitState();
    // Clear queue
    module.clearQueue();
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  describe('validateWebhookUrl()', () => {
    test('validates valid Discord webhook URL', () => {
      const url = 'https://discord.com/api/webhooks/123456789/abcdef';
      const result = webhook.validateWebhookUrl(url);
      expect(result.valid).toBe(true);
    });

    test('validates valid Discordapp webhook URL', () => {
      const url = 'https://discordapp.com/api/webhooks/123456789/abcdef';
      const result = webhook.validateWebhookUrl(url);
      expect(result.valid).toBe(true);
    });

    test('validates valid generic HTTPS URL', () => {
      const url = 'https://example.com/webhook';
      const result = webhook.validateWebhookUrl(url);
      expect(result.valid).toBe(true);
    });

    test('rejects non-string URL', () => {
      const result = webhook.validateWebhookUrl(123);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL is required');
    });

    test('rejects empty URL', () => {
      const result = webhook.validateWebhookUrl('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL is required');
    });

    test('rejects invalid URL format', () => {
      const result = webhook.validateWebhookUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid URL format');
    });

    test('rejects Discord URL with wrong path', () => {
      const result = webhook.validateWebhookUrl('https://discord.com/api/other/123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid Discord webhook URL format');
    });
  });

  describe('buildDiscordEmbed()', () => {
    test('builds a basic embed', () => {
      const options = {
        title: 'Test Title',
        message: 'Test Message',
        eventType: 'idle'
      };
      const embed = webhook.buildDiscordEmbed(options);
      expect(embed.title).toContain('Test Title');
      expect(embed.description).toBe('Test Message');
      expect(embed.color).toBe(webhook.EMBED_COLORS.idle);
      expect(embed.timestamp).toBeDefined();
    });

    test('includes project name in fields', () => {
      const embed = webhook.buildDiscordEmbed({
        title: 'Title',
        projectName: 'MyProject'
      });
      const projectField = embed.fields.find(f => f.name === 'Project');
      expect(projectField.value).toBe('MyProject');
    });

    test('includes session ID in fields (truncated)', () => {
      const sessionId = '1234567890abcdefghijklmnopqrstuvwxyz';
      const embed = webhook.buildDiscordEmbed({
        title: 'Title',
        sessionId: sessionId
      });
      const sessionField = embed.fields.find(f => f.name === 'Session');
      expect(sessionField.value).toContain('12345678');
      expect(sessionField.value).toContain('...');
    });

    test('includes count in fields for multiple events', () => {
      const embed = webhook.buildDiscordEmbed({
        title: 'Title',
        count: 5
      });
      const countField = embed.fields.find(f => f.name === 'Count');
      expect(countField.value).toBe('5');
    });

    test('includes extra fields if provided', () => {
      const extra = {
        fields: [{ name: 'Extra', value: 'Value', inline: false }]
      };
      const embed = webhook.buildDiscordEmbed({
        title: 'Title',
        extra: extra
      });
      const extraField = embed.fields.find(f => f.name === 'Extra');
      expect(extraField.value).toBe('Value');
    });

    test('uses default values for missing options', () => {
      const embed = webhook.buildDiscordEmbed({});
      expect(embed.title).toContain('OpenCode Notification');
      expect(embed.color).toBe(webhook.EMBED_COLORS.default);
    });
  });

  describe('buildWebhookPayload()', () => {
    test('builds a basic payload', () => {
      const options = {
        username: 'Test Bot',
        content: 'Hello World',
        embeds: [{ title: 'Embed' }]
      };
      const payload = webhook.buildWebhookPayload(options);
      expect(payload.username).toBe('Test Bot');
      expect(payload.content).toBe('Hello World');
      expect(payload.embeds).toEqual([{ title: 'Embed' }]);
    });

    test('uses default username', () => {
      const payload = webhook.buildWebhookPayload({});
      expect(payload.username).toBe('OpenCode Notify');
    });

    test('includes avatar_url if provided', () => {
      const payload = webhook.buildWebhookPayload({ avatarUrl: 'http://example.com/avatar.png' });
      expect(payload.avatar_url).toBe('http://example.com/avatar.png');
    });
  });

  describe('rate limiting logic', () => {
    test('isRateLimited returns false initially', () => {
      expect(webhook.isRateLimited()).toBe(false);
    });

    test('getRateLimitWait returns wait time when limited', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({}), {
        status: 429,
        headers: { 'Retry-After': '1' }
      })));
      
      await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', {}, { retryCount: 3 });
      
      const waitTime = webhook.getRateLimitWait();
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(1000);
      
      globalThis.fetch = originalFetch;
    });

    test('getRateLimitState returns current state', () => {
      const state = webhook.getRateLimitState();
      expect(state).toHaveProperty('isRateLimited');
      expect(state).toHaveProperty('retryAfter');
    });

    test('isRateLimited resets when time passes', async () => {
      const originalFetch = globalThis.fetch;
      // Trigger rate limit but don't retry (fail after 1 attempt)
      globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({}), {
        status: 429,
        headers: { 'Retry-After': '1' } // 1 second
      })));
      
      await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', {}, { retryCount: 3 });
      expect(webhook.isRateLimited()).toBe(true);
      
      // Reset state and verify
      webhook.resetRateLimitState();
      expect(webhook.isRateLimited()).toBe(false);
      
      globalThis.fetch = originalFetch;
    });
  });

  describe('queue management', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      // Mock fetch to be slow so items stay in queue long enough to check
      globalThis.fetch = mock(() => new Promise(resolve => setTimeout(() => resolve(new Response(null, { status: 204 })), 50)));
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('enqueueWebhook adds items to queue and processes them', async () => {
      webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i: 1 } });
      webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i: 2 } });
      
      // First item is shifted immediately by processQueue, so size should be 1
      expect(webhook.getQueueSize()).toBe(1);
      
      // Wait for processing to complete (including 250ms inter-message delay)
      await wait(600);
      expect(webhook.getQueueSize()).toBe(0);
    });

    test('clearQueue empties the queue', async () => {
      // Add multiple items quickly
      webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i: 1 } });
      webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i: 2 } });
      webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i: 3 } });
      
      const cleared = webhook.clearQueue();
      // One might have been shifted already
      expect(cleared).toBeGreaterThanOrEqual(2);
      expect(webhook.getQueueSize()).toBe(0);
    });

    test('queue shifts when MAX_QUEUE_SIZE is reached', async () => {
      // Stop processing the queue by making fetch never resolve (or very slow)
      globalThis.fetch = mock(() => new Promise(() => {})); 

      // Max size is 100
      for (let i = 0; i < 110; i++) {
        webhook.enqueueWebhook({ url: 'https://discord.com/api/webhooks/123/abc', payload: { i } });
      }
      
      // One is shifted into "processing", 100 are in queue
      expect(webhook.getQueueSize()).toBe(100);
    });
  });

  describe('sendWebhookRequest()', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('sends successful request', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 204 })));
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(204);
      expect(mockFetch).toHaveBeenCalled();
    });

    test('handles 429 rate limit and retries', async () => {
      let callCount = 0;
      const mockFetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ message: 'Rate limited' }), {
            status: 429,
            headers: { 'Retry-After': '0.01' } // 10ms to keep test fast
          }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' });
      
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
      expect(webhook.isRateLimited()).toBe(false);
    });

    test('handles 500 server error and retries', async () => {
      let callCount = 0;
      const mockFetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response('Server Error', { status: 500 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' });
      
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    test('fails after max retries', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('Server Error', { status: 500 })));
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' });
      
      expect(result.success).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    test('handles request timeout', async () => {
      const mockFetch = mock(() => new Promise((resolve, reject) => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      }));
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' }, { timeout: 10 });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timed out');
      expect(mockFetch).toHaveBeenCalledTimes(4); // Should retry on timeout too
    });

    test('handles general fetch error', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch;

      const result = await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    test('waitForRateLimit pauses execution', async () => {
      let callCount = 0;
      const mockFetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({}), {
            status: 429,
            headers: { 'Retry-After': '1' } // 1 second
          }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      const start = Date.now();
      await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', {}, { debugLog: true });
      const duration = Date.now() - start;
      
      // Should take at least 1000ms
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(callCount).toBe(2);
    });
  });

  describe('high-level helpers', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      // Mock fetch to be slow so items stay in queue long enough to check size
      globalThis.fetch = mock(() => new Promise(resolve => setTimeout(() => resolve(new Response(null, { status: 204 })), 100)));
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('sendWebhookNotification queues message by default', async () => {
      // Send first message - will be shifted immediately for processing
      const result1 = await webhook.sendWebhookNotification('https://discord.com/api/webhooks/1/a', {
        eventType: 'idle',
        title: 'Test 1',
        message: 'Msg 1'
      });
      
      // Send second message - should remain in queue while first is "processing"
      const result2 = await webhook.sendWebhookNotification('https://discord.com/api/webhooks/1/a', {
        eventType: 'idle',
        title: 'Test 2',
        message: 'Msg 2'
      });
      
      expect(result1.queued).toBe(true);
      expect(result2.queued).toBe(true);
      expect(webhook.getQueueSize()).toBe(1);
    });

    test('notifyWebhookIdle formats message correctly', async () => {
      const mockFetch = mock((url, init) => {
        const payload = JSON.parse(init.body);
        expect(payload.embeds[0].title).toContain('Task Complete');
        expect(payload.embeds[0].description).toBe('Task finished');
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      await webhook.notifyWebhookIdle('https://discord.com/api/webhooks/1/a', 'Task finished', { useQueue: false });
      expect(mockFetch).toHaveBeenCalled();
    });

    test('notifyWebhookPermission includes mention and correct color', async () => {
      const mockFetch = mock((url, init) => {
        const payload = JSON.parse(init.body);
        expect(payload.content).toBe('@everyone');
        expect(payload.embeds[0].color).toBe(webhook.EMBED_COLORS.permission);
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      await webhook.notifyWebhookPermission('https://discord.com/api/webhooks/1/a', 'Perm needed', { useQueue: false });
      expect(mockFetch).toHaveBeenCalled();
    });

    test('notifyWebhookError includes mention and correct color', async () => {
      const mockFetch = mock((url, init) => {
        const payload = JSON.parse(init.body);
        expect(payload.content).toBe('@everyone');
        expect(payload.embeds[0].color).toBe(webhook.EMBED_COLORS.error);
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      await webhook.notifyWebhookError('https://discord.com/api/webhooks/1/a', 'Error happened', { useQueue: false });
      expect(mockFetch).toHaveBeenCalled();
    });

    test('notifyWebhookQuestion formats correctly without mention', async () => {
      const mockFetch = mock((url, init) => {
        const payload = JSON.parse(init.body);
        expect(payload.content).toBeUndefined();
        expect(payload.embeds[0].color).toBe(webhook.EMBED_COLORS.question);
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      globalThis.fetch = mockFetch;

      await webhook.notifyWebhookQuestion('https://discord.com/api/webhooks/1/a', 'Any questions?', { useQueue: false });
      expect(mockFetch).toHaveBeenCalled();
    });

    test('handles exception in sendWebhookNotification gracefully', async () => {
      // @ts-ignore - intentionally passing null to cause error
      const result = await webhook.sendWebhookNotification('https://discord.com/api/webhooks/1/a', null);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('debug logging', () => {
    test('writes to debug log when enabled', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 })));
      
      await webhook.sendWebhookRequest('https://discord.com/api/webhooks/1/a', { content: 'test' }, { debugLog: true });
      
      const logContent = readTestFile('logs/smart-voice-notify-debug.log');
      expect(logContent).toContain('[webhook]');
      expect(logContent).toContain('Sending webhook request');
      
      globalThis.fetch = originalFetch;
    });
  });
});
