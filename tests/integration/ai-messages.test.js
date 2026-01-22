import { test, describe, expect, beforeAll, afterAll } from 'bun:test';
import { generateAIMessage, testAIConnection } from '../../util/ai-messages.js';
import { createTestTempDir, cleanupTestTempDir, createTestConfig } from '../setup.js';

const hasAIEndpoint = !!process.env.TEST_AI_ENDPOINT && process.env.TEST_AI_ENDPOINT !== 'http://127.0.0.1:8000/v1';

describe.skipIf(!hasAIEndpoint)('AI Message Generation Integration', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = createTestTempDir();

    // Create config with real credentials from env
    createTestConfig({
      enableAIMessages: true,
      aiEndpoint: process.env.TEST_AI_ENDPOINT,
      aiModel: process.env.TEST_AI_MODEL || 'llama3',
      aiApiKey: process.env.TEST_AI_API_KEY,
      aiTimeout: parseInt(process.env.TEST_AI_TIMEOUT || '15000', 10),
      aiPrompts: {
        idle: 'The agent has finished the task. Generate a short, friendly completion message.'
      },
      debugLog: true
    });
  });

  afterAll(() => {
    cleanupTestTempDir();
  });

  test('should connect to AI endpoint successfully', async () => {
    const result = await testAIConnection();
    expect(result.success).toBe(true);
    expect(result.message).toContain('Connected');
  }, 10000);

  test('should generate a message using real LLM', async () => {
    const message = await generateAIMessage('idle');
    
    expect(message).toBeTypeOf('string');
    expect(message.length).toBeGreaterThan(5);
    expect(message.length).toBeLessThan(200);
    // AI should not include quotes as per system prompt
    expect(message).not.toStartWith('"');
    expect(message).not.toEndWith('"');
  }, 30000);

  test('should inject count context correctly into AI prompt', async () => {
    // This is hard to verify the prompt itself, but we can verify it doesn't fail
    const message = await generateAIMessage('permission', { count: 3, type: 'permission' });
    
    expect(message).toBeTypeOf('string');
    expect(message.length).toBeGreaterThan(5);
  }, 30000);
});
