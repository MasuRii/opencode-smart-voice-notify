import { test, describe, expect, beforeAll, afterAll } from 'bun:test';
import { createTTS } from '../../util/tts.js';
import { createMockShellRunner, createMockClient, createTestTempDir, cleanupTestTempDir, createTestConfig } from '../setup.js';

const hasOpenAIEndpoint = !!process.env.TEST_OPENAI_TTS_ENDPOINT && process.env.TEST_OPENAI_TTS_ENDPOINT !== 'https://api.example.com';

describe.skipIf(!hasOpenAIEndpoint)('OpenAI TTS Integration', () => {
  let tempDir;
  let mockShell;
  let mockClient;

  beforeAll(() => {
    tempDir = createTestTempDir();
    mockShell = createMockShellRunner();
    mockClient = createMockClient();

    // Create config with real credentials from env
    createTestConfig({
      ttsEngine: 'openai',
      openaiTtsEndpoint: process.env.TEST_OPENAI_TTS_ENDPOINT,
      openaiTtsApiKey: process.env.TEST_OPENAI_TTS_API_KEY,
      openaiTtsModel: process.env.TEST_OPENAI_TTS_MODEL || 'tts-1',
      openaiTtsVoice: process.env.TEST_OPENAI_TTS_VOICE || 'alloy',
      enableTTS: true,
      debugLog: true
    });
  });

  afterAll(() => {
    cleanupTestTempDir();
  });

  test('should generate and play speech using real OpenAI-compatible API', async () => {
    const tts = createTTS({ $: mockShell, client: mockClient });
    
    const success = await tts.speak('This is a real integration test for OpenAI TTS.');
    
    expect(success).toBe(true);
    expect(mockShell.getCallCount()).toBeGreaterThan(0);
  }, 30000);
});
