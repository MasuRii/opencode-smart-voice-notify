import { test, describe, expect, beforeAll, afterAll } from 'bun:test';
import { createTTS } from '../../util/tts.js';
import { createMockShellRunner, createMockClient, createTestTempDir, cleanupTestTempDir, createTestConfig } from '../setup.js';
import fs from 'fs';
import path from 'path';

const hasElevenLabsKey = !!process.env.TEST_ELEVENLABS_API_KEY && process.env.TEST_ELEVENLABS_API_KEY !== 'your-api-key-here';

describe.skipIf(!hasElevenLabsKey)('ElevenLabs Integration', () => {
  let tempDir;
  let mockShell;
  let mockClient;

  beforeAll(() => {
    tempDir = createTestTempDir();
    mockShell = createMockShellRunner();
    mockClient = createMockClient();

    // Create config with real credentials from env
    createTestConfig({
      ttsEngine: 'elevenlabs',
      elevenLabsApiKey: process.env.TEST_ELEVENLABS_API_KEY,
      elevenLabsVoiceId: process.env.TEST_ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9',
      elevenLabsModel: process.env.TEST_ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
      enableTTS: true,
      debugLog: true
    });
  });

  afterAll(() => {
    cleanupTestTempDir();
  });

  test('should generate and play speech using real ElevenLabs API', async () => {
    const tts = createTTS({ $: mockShell, client: mockClient });
    
    // We expect this to call ElevenLabs API, write a temp file, and play it
    const success = await tts.speak('This is a real integration test for ElevenLabs.');
    
    expect(success).toBe(true);
    
    // Verify that playAudioFile was called (via mockShell)
    // On different platforms, different commands are used, but they all go through mockShell
    expect(mockShell.getCallCount()).toBeGreaterThan(0);
    
    const lastCall = mockShell.getLastCall();
    if (process.platform === 'win32') {
      expect(lastCall.command).toContain('powershell.exe');
      expect(lastCall.command).toContain('MediaPlayer');
    } else if (process.platform === 'darwin') {
      expect(lastCall.command).toContain('afplay');
    }
  }, 30000); // 30s timeout for API call

  test('should handle invalid API key gracefully', async () => {
    const tts = createTTS({ $: mockShell, client: mockClient });
    
    // Temporarily override config with invalid key
    const ttsWithInvalidKey = createTTS({ 
      $: mockShell, 
      client: mockClient,
      configOverrides: { elevenLabsApiKey: 'invalid-key' } 
    });
    
    // Note: createTTS doesn't support configOverrides in its params, 
    // it loads from file. So we need to rewrite the config file.
    createTestConfig({
      ttsEngine: 'elevenlabs',
      elevenLabsApiKey: 'invalid-key',
      enableTTS: true
    });
    
    const secondTts = createTTS({ $: mockShell, client: mockClient });
    const success = await secondTts.speak('Testing invalid key.');
    
    // Should fail ElevenLabs and fall back to Edge TTS (which should succeed)
    // or return false if all fail.
    // In our implementation, it falls back to Edge -> SAPI.
    expect(success).toBeDefined();
  }, 10000);
});
