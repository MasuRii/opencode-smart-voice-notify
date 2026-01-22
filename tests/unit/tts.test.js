import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import path from 'path';
import fs from 'fs';

// Mock proxies to control from tests
const mockElevenLabsConvert = mock(() => Promise.resolve({
  [Symbol.asyncIterator]: async function* () {
    yield Buffer.from('audio');
  }
}));

const mockEdgeTTSSetMetadata = mock(() => Promise.resolve());
const mockEdgeTTSToFile = mock(() => Promise.resolve({ audioFilePath: 'edge-tts.mp3' }));

// Mock the dependencies before importing tts.js
mock.module('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: class {
    constructor() {
      this.textToSpeech = {
        convert: mockElevenLabsConvert
      };
    }
  }
}));

mock.module('msedge-tts', () => ({
  MsEdgeTTS: class {
    constructor() {
      this.setMetadata = mockEdgeTTSSetMetadata;
      this.toFile = mockEdgeTTSToFile;
    }
  },
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3'
  }
}));

import { getTTSConfig, createTTS } from '../../util/tts.js';
import { 
  createTestTempDir, 
  cleanupTestTempDir, 
  getTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createMockShellRunner,
  createMockClient,
  testFileExists
} from '../setup.js';

describe('tts.js', () => {
  describe('getTTSConfig()', () => {
    beforeEach(() => {
      createTestTempDir();
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should return default configuration when no config file exists', () => {
      const config = getTTSConfig();
      expect(config).toBeDefined();
      expect(config.ttsEngine).toBe('elevenlabs');
      expect(config.enableTTS).toBe(true);
      expect(config.notificationMode).toBe('sound-first');
    });

    it('should respect user overrides from config file', () => {
      const userConfig = {
        ttsEngine: 'openai',
        enableTTS: false,
        openaiTtsEndpoint: 'http://localhost:8880'
      };
      createTestConfig(userConfig);

      const config = getTTSConfig();
      expect(config.ttsEngine).toBe('openai');
      expect(config.enableTTS).toBe(false);
      expect(config.openaiTtsEndpoint).toBe('http://localhost:8880');
    });

    it('should include all required tts message arrays', () => {
      const config = getTTSConfig();
      expect(Array.isArray(config.idleTTSMessages)).toBe(true);
      expect(Array.isArray(config.permissionTTSMessages)).toBe(true);
      expect(Array.isArray(config.questionTTSMessages)).toBe(true);
      expect(Array.isArray(config.idleReminderTTSMessages)).toBe(true);
      expect(Array.isArray(config.permissionReminderTTSMessages)).toBe(true);
      expect(Array.isArray(config.questionReminderTTSMessages)).toBe(true);
    });
  });

  describe('createTTS()', () => {
    let mockShell;
    let mockClient;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      mockClient = createMockClient();
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should initialize with config', () => {
      const tts = createTTS({ $: mockShell, client: mockClient });
      expect(tts.config).toBeDefined();
      expect(tts.config.ttsEngine).toBe('elevenlabs');
    });

    it('should create logs directory if debugLog is enabled', () => {
      createTestConfig({ debugLog: true });
      createTTS({ $: mockShell, client: mockClient });
      
      expect(testFileExists('logs')).toBe(true);
    });

    it('should have required methods', () => {
      const tts = createTTS({ $: mockShell, client: mockClient });
      expect(typeof tts.speak).toBe('function');
      expect(typeof tts.announce).toBe('function');
      expect(typeof tts.wakeMonitor).toBe('function');
      expect(typeof tts.forceVolume).toBe('function');
      expect(typeof tts.playAudioFile).toBe('function');
    });
  });

  describe('playAudioFile()', () => {
    let mockShell;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      tts = createTTS({ $: mockShell, client: createMockClient() });
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should call powershell on win32', async () => {
      // Assuming we are on win32 as per environment
      if (process.platform === 'win32') {
        await tts.playAudioFile('test.mp3');
        expect(mockShell.getCallCount()).toBe(1);
        expect(mockShell.getLastCall().command).toContain('powershell.exe');
        expect(mockShell.getLastCall().command).toContain('MediaPlayer');
        expect(mockShell.getLastCall().command).toContain('test.mp3');
      }
    });

    it('should respect loops parameter on win32', async () => {
      if (process.platform === 'win32') {
        await tts.playAudioFile('test.mp3', 3);
        expect(mockShell.getCallCount()).toBe(1); // One powershell call with a loop inside
        expect(mockShell.getLastCall().command).toContain('-lt 3');
      }
    });
  });

  describe('speakWithOpenAI()', () => {
    let mockShell;
    let mockClient;
    let tts;
    let originalFetch;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      mockClient = createMockClient();
      originalFetch = global.fetch;
    });

    afterEach(() => {
      cleanupTestTempDir();
      global.fetch = originalFetch;
    });

    it('should return false if no endpoint is configured', async () => {
      createTestConfig({ openaiTtsEndpoint: '' });
      tts = createTTS({ $: mockShell, client: mockClient });
      
      // Mock edge to fail so we don't get true from fallback
      mockEdgeTTSToFile.mockImplementation(() => Promise.reject(new Error('Edge failed')));
      // Mock sapi to fail as well
      mockShell = createMockShellRunner({
        handler: () => ({ exitCode: 1, stderr: 'SAPI failed' })
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      const success = await tts.speak('Hello', { ttsEngine: 'openai' });
      expect(success).toBe(false);
    });

    it('should make a POST request to the correct endpoint', async () => {
      createTestConfig({ 
        openaiTtsEndpoint: 'http://localhost:8880',
        ttsEngine: 'openai',
        enableTTS: true,
        enableSound: true
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      global.fetch = mock(() => Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      }));

      await tts.speak('Hello');

      expect(global.fetch).toHaveBeenCalled();
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('http://localhost:8880/v1/audio/speech');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body).input).toBe('Hello');
    });

    it('should include Authorization header if API key is provided', async () => {
      createTestConfig({ 
        openaiTtsEndpoint: 'http://localhost:8880',
        openaiTtsApiKey: 'sk-123',
        ttsEngine: 'openai',
        enableTTS: true,
        enableSound: true
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      global.fetch = mock(() => Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      }));

      await tts.speak('Hello');

      const options = global.fetch.mock.calls[0][1];
      expect(options.headers['Authorization']).toBe('Bearer sk-123');
    });

    it('should return false if fetch fails', async () => {
      createTestConfig({ 
        openaiTtsEndpoint: 'http://localhost:8880',
        ttsEngine: 'openai',
        enableTTS: true,
        enableSound: true
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      global.fetch = mock(() => Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Error')
      }));
      
      // Mock edge and sapi to fail so we don't get true from fallback
      mockEdgeTTSToFile.mockImplementation(() => Promise.reject(new Error('Edge failed')));
      // On win32, sapi will be tried. It will fail if powershell fails or is mocked to fail.
      mockShell = createMockShellRunner({
        handler: () => ({ exitCode: 1, stderr: 'SAPI failed' })
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      const success = await tts.speak('Hello');
      expect(success).toBe(false);
    });
  });

  describe('speakWithElevenLabs()', () => {
    let mockShell;
    let mockClient;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      mockClient = createMockClient();
      mockElevenLabsConvert.mockClear();
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should call ElevenLabs API when configured', async () => {
      createTestConfig({ 
        elevenLabsApiKey: 'valid-key',
        ttsEngine: 'elevenlabs',
        enableTTS: true,
        enableSound: true
      });
      tts = createTTS({ $: mockShell, client: mockClient });
      
      await tts.speak('Hello');
      expect(mockElevenLabsConvert).toHaveBeenCalled();
    });
  });

  describe('ElevenLabs Quota Handling', () => {
    let mockShell;
    let mockClient;
    let tts;

    beforeEach(async () => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      mockClient = createMockClient();
      mockElevenLabsConvert.mockClear();
      mockEdgeTTSToFile.mockClear();
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should fall back to Edge TTS when ElevenLabs returns 401 (quota exceeded)', async () => {
      createTestConfig({ 
        elevenLabsApiKey: 'valid-key',
        ttsEngine: 'elevenlabs',
        enableTTS: true,
        enableSound: true
      });
      tts = createTTS({ $: mockShell, client: mockClient });

      // Make the convert method fail with 401
      mockElevenLabsConvert.mockImplementation(() => {
        const err = new Error('Quota exceeded');
        err.statusCode = 401;
        return Promise.reject(err);
      });

      // It should try ElevenLabs, fail, show toast, then try Edge TTS
      await tts.speak('Hello');

      expect(mockClient.tui.getToastCalls().some(c => c.message.includes('ElevenLabs quota exceeded'))).toBe(true);
      expect(mockEdgeTTSToFile).toHaveBeenCalled();

      // Subsequent calls should skip ElevenLabs immediately
      mockElevenLabsConvert.mockClear();
      await tts.speak('Hello again');
      expect(mockElevenLabsConvert).not.toHaveBeenCalled();
    });
  });

  describe('wakeMonitor()', () => {
    let mockShell;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      tts = createTTS({ $: mockShell, client: createMockClient() });
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should skip wake if idle time is below threshold', async () => {
      if (process.platform === 'win32') {
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('IdleCheck')) return { stdout: Buffer.from('10') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });

        await tts.wakeMonitor();
        expect(mockShell.wasCalledWith('SendWait')).toBe(false);
      }
    });

    it('should wake if idle time is above threshold', async () => {
      if (process.platform === 'win32') {
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('IdleCheck')) return { stdout: Buffer.from('60') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });

        await tts.wakeMonitor();
        expect(mockShell.wasCalledWith('SendWait')).toBe(true);
      }
    });

    it('should force wake if force parameter is true', async () => {
      if (process.platform === 'win32') {
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('IdleCheck')) return { stdout: Buffer.from('10') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });

        await tts.wakeMonitor(true);
        expect(mockShell.wasCalledWith('SendWait')).toBe(true);
      }
    });
  });

  describe('forceVolume()', () => {
    let mockShell;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      // Create config with forceVolume enabled (default is now false per Issue #8)
      createTestConfig(createMinimalConfig({ forceVolume: true, volumeThreshold: 50 }));
      mockShell = createMockShellRunner();
      tts = createTTS({ $: mockShell, client: createMockClient() });
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should skip if volume is above threshold', async () => {
      if (process.platform === 'win32') {
        createTestConfig(createMinimalConfig({ forceVolume: true, volumeThreshold: 50 }));
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('Win32VolCheck')) return { stdout: Buffer.from('80') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });

        await tts.forceVolume();
        expect(mockShell.wasCalledWith('SendKeys([char]175)')).toBe(false);
      }
    });

    it('should force volume if below threshold', async () => {
      if (process.platform === 'win32') {
        createTestConfig(createMinimalConfig({ forceVolume: true, volumeThreshold: 50 }));
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('Win32VolCheck')) return { stdout: Buffer.from('20') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });

        await tts.forceVolume();
        expect(mockShell.wasCalledWith('SendKeys([char]175)')).toBe(true);
      }
    });
  });

  describe('speakWithSAPI()', () => {
    let mockShell;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      mockShell = createMockShellRunner();
      tts = createTTS({ $: mockShell, client: createMockClient() });
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should generate and execute PowerShell script on win32', async () => {
      if (process.platform === 'win32') {
        await tts.speak('Hello', { ttsEngine: 'sapi' });
        
        expect(mockShell.wasCalledWith('powershell.exe')).toBe(true);
        expect(mockShell.getLastCall().command).toContain('-File');
        // The script path is in os.tmpdir(), but we can't easily check contents here
        // unless we mock fs.writeFileSync which might be too much.
      }
    });
  });

  describe('announce()', () => {
    let mockShell;
    let tts;

    beforeEach(() => {
      createTestTempDir();
      // Create config with forceVolume enabled (default is now false per Issue #8)
      createTestConfig(createMinimalConfig({ forceVolume: true, volumeThreshold: 50, wakeMonitor: true }));
      mockShell = createMockShellRunner();
      tts = createTTS({ $: mockShell, client: createMockClient() });
    });

    afterEach(() => {
      cleanupTestTempDir();
    });

    it('should call wakeMonitor and forceVolume before speaking', async () => {
      if (process.platform === 'win32') {
        // Create config with forceVolume and wakeMonitor enabled
        createTestConfig(createMinimalConfig({ forceVolume: true, volumeThreshold: 50, wakeMonitor: true, idleThresholdSeconds: 60 }));
        // Mock to trigger wake and force volume
        mockShell = createMockShellRunner({
          handler: (cmd) => {
            if (cmd.includes('IdleCheck')) return { stdout: Buffer.from('60') };
            if (cmd.includes('Win32VolCheck')) return { stdout: Buffer.from('20') };
            return { exitCode: 0 };
          }
        });
        tts = createTTS({ $: mockShell, client: createMockClient() });
        
        await tts.announce('Hello');
        
        expect(mockShell.wasCalledWith('SendWait')).toBe(true);
        expect(mockShell.wasCalledWith('SendKeys([char]175)')).toBe(true);
      }
    });
  });
});
