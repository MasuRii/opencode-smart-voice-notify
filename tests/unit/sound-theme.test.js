import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createTestTempDir, cleanupTestTempDir } from '../setup.js';
import { listSoundsInTheme, pickThemeSound, pickRandomSound } from '../../util/sound-theme.js';

describe('Sound Theme Module', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTestTempDir();
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  /**
   * Helper to create a mock theme structure
   */
  const createMockTheme = (themeName, structure) => {
    const themeDir = path.join(tempDir, themeName);
    fs.mkdirSync(themeDir, { recursive: true });

    for (const [subDir, files] of Object.entries(structure)) {
      const subDirPath = path.join(themeDir, subDir);
      fs.mkdirSync(subDirPath, { recursive: true });
      for (const file of files) {
        fs.writeFileSync(path.join(subDirPath, file), 'mock audio data');
      }
    }
    return themeDir;
  };

  describe('listSoundsInTheme()', () => {
    it('should return empty array if themeDir is empty', () => {
      expect(listSoundsInTheme('', 'idle')).toEqual([]);
    });

    it('should return empty array if subdirectory does not exist', () => {
      const themeDir = createMockTheme('test-theme', { idle: ['sound1.mp3'] });
      expect(listSoundsInTheme(themeDir, 'permission')).toEqual([]);
    });

    it('should list only audio files in the subdirectory', () => {
      const themeDir = createMockTheme('test-theme', {
        idle: ['sound1.mp3', 'sound2.wav', 'not-audio.txt', 'image.png']
      });
      const sounds = listSoundsInTheme(themeDir, 'idle');
      expect(sounds).toHaveLength(2);
      expect(sounds.some(s => s.endsWith('sound1.mp3'))).toBe(true);
      expect(sounds.some(s => s.endsWith('sound2.wav'))).toBe(true);
    });

    it('should handle case-insensitive extensions', () => {
      const themeDir = createMockTheme('test-theme', {
        idle: ['sound1.MP3', 'sound2.WAV']
      });
      const sounds = listSoundsInTheme(themeDir, 'idle');
      expect(sounds).toHaveLength(2);
    });
  });

  describe('pickThemeSound()', () => {
    it('should return null if soundThemeDir is not configured', () => {
      expect(pickThemeSound('idle', {})).toBeNull();
    });

    it('should return null if theme directory does not exist', () => {
      expect(pickThemeSound('idle', { soundThemeDir: 'non-existent' })).toBeNull();
    });

    it('should return null if event subdirectory has no sounds', () => {
      const themeDir = createMockTheme('test-theme', { idle: [] });
      expect(pickThemeSound('idle', { soundThemeDir: themeDir })).toBeNull();
    });

    it('should return the first sound if randomization is disabled', () => {
      const themeDir = createMockTheme('test-theme', {
        idle: ['a.mp3', 'b.mp3', 'c.mp3']
      });
      const sound = pickThemeSound('idle', {
        soundThemeDir: themeDir,
        randomizeSoundFromTheme: false
      });
      expect(sound).toContain('a.mp3');
    });

    it('should return a random sound if randomization is enabled', () => {
      const themeDir = createMockTheme('test-theme', {
        idle: ['a.mp3', 'b.mp3', 'c.mp3']
      });
      const sound = pickThemeSound('idle', {
        soundThemeDir: themeDir,
        randomizeSoundFromTheme: true
      });
      expect(['a.mp3', 'b.mp3', 'c.mp3'].some(s => sound.includes(s))).toBe(true);
    });

    it('should resolve relative paths using OPENCODE_CONFIG_DIR', () => {
      const themeDir = path.join(tempDir, 'my-theme');
      fs.mkdirSync(path.join(themeDir, 'idle'), { recursive: true });
      fs.writeFileSync(path.join(themeDir, 'idle', 'test.mp3'), 'data');

      // OPENCODE_CONFIG_DIR is tempDir, so 'my-theme' is relative to tempDir
      const sound = pickThemeSound('idle', {
        soundThemeDir: 'my-theme'
      });
      expect(sound).toContain(path.join(tempDir, 'my-theme', 'idle', 'test.mp3'));
    });
    
    it('should return null if subdirectory exists but is empty', () => {
        const themeDir = path.join(tempDir, 'empty-theme');
        fs.mkdirSync(path.join(themeDir, 'idle'), { recursive: true });
        
        const sound = pickThemeSound('idle', {
            soundThemeDir: themeDir
        });
        expect(sound).toBeNull();
    });
  });

  describe('pickRandomSound()', () => {
    it('should return null for invalid directory', () => {
      expect(pickRandomSound(null)).toBeNull();
      expect(pickRandomSound('non-existent')).toBeNull();
    });

    it('should pick a random sound from the given directory', () => {
      const dir = path.join(tempDir, 'random-sounds');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, '1.mp3'), 'data');
      fs.writeFileSync(path.join(dir, '2.wav'), 'data');
      fs.writeFileSync(path.join(dir, 'ignore.txt'), 'data');

      const sound = pickRandomSound(dir);
      expect(sound).not.toBeNull();
      expect(sound.endsWith('.mp3') || sound.endsWith('.wav')).toBe(true);
    });
    
    it('should return null if directory has no audio files', () => {
        const dir = path.join(tempDir, 'no-audio');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'test.txt'), 'data');
        
        expect(pickRandomSound(dir)).toBeNull();
    });
  });
});
