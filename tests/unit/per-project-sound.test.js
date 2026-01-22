import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import { getProjectSound, clearProjectSoundCache } from '../../util/per-project-sound.js';
import { createTestTempDir, cleanupTestTempDir } from '../setup.js';

describe('Per-Project Sound Module', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTestTempDir();
    clearProjectSoundCache();
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  describe('getProjectSound()', () => {
    it('should return null if perProjectSounds is disabled', () => {
      const project = { directory: '/path/to/project' };
      const config = { perProjectSounds: false };
      expect(getProjectSound(project, config)).toBeNull();
    });

    it('should return null if project directory is missing', () => {
      const project = {};
      const config = { perProjectSounds: true };
      expect(getProjectSound(project, config)).toBeNull();
    });

    it('should return null if project is null', () => {
      const config = { perProjectSounds: true };
      expect(getProjectSound(null, config)).toBeNull();
    });

    it('should return a sound path for a valid project', () => {
      const project = { directory: '/path/to/project' };
      const config = { perProjectSounds: true };
      const sound = getProjectSound(project, config);
      expect(sound).toMatch(/^assets\/ding[1-6]\.mp3$/);
    });

    it('should return consistent sound for same project and seed', () => {
      const project = { directory: '/path/to/project' };
      const config = { perProjectSounds: true, projectSoundSeed: 123 };
      
      const sound1 = getProjectSound(project, config);
      const sound2 = getProjectSound(project, config);
      
      expect(sound1).toBe(sound2);
    });

    it('should return different sounds for different projects (statistical)', () => {
      const config = { perProjectSounds: true };
      const sounds = new Set();
      
      // With 6 sounds, 20 different paths should likely hit multiple different sounds
      for (let i = 0; i < 20; i++) {
        sounds.add(getProjectSound({ directory: `/path/to/project${i}` }, config));
      }
      
      expect(sounds.size).toBeGreaterThan(1);
    });

    it('should return different sound if seed changes', () => {
      const project = { directory: '/path/to/project' };
      const config1 = { perProjectSounds: true, projectSoundSeed: 1 };
      const config2 = { perProjectSounds: true, projectSoundSeed: 2 };
      
      const sound1 = getProjectSound(project, config1);
      clearProjectSoundCache(); // Clear cache to force re-calculation with new seed
      const sound2 = getProjectSound(project, config2);
      
      // It's possible for different seed to map to same sound, but usually different
      // If they are the same, we'll try a few more seeds
      if (sound1 === sound2) {
          clearProjectSoundCache();
          const sound3 = getProjectSound(project, { perProjectSounds: true, projectSoundSeed: 3 });
          expect(sound1 === sound2 && sound2 === sound3).toBe(false);
      } else {
          expect(sound1).not.toBe(sound2);
      }
    });

    it('should use cache for subsequent calls', () => {
      const project = { directory: '/path/to/project' };
      const config = { perProjectSounds: true, projectSoundSeed: 1 };
      
      const sound1 = getProjectSound(project, config);
      
      // Change seed, if cached it should still return sound1
      const sound2 = getProjectSound(project, { perProjectSounds: true, projectSoundSeed: 2 });
      
      expect(sound1).toBe(sound2);
    });

    it('should honor cleared cache', () => {
      const project = { directory: '/path/to/project' };
      const config = { perProjectSounds: true };
      
      const sound1 = getProjectSound(project, config);
      clearProjectSoundCache();
      
      const sound2 = getProjectSound(project, { perProjectSounds: false });
      expect(sound2).toBeNull();
    });
    
    it('should handle debug logging when enabled', () => {
        const project = { directory: '/path/to/project' };
        const config = { 
            perProjectSounds: true, 
            debugLog: true 
        };
        
        // This should trigger debugLog and create the log file
        getProjectSound(project, config);
        
        const configDir = process.env.OPENCODE_CONFIG_DIR;
        const logFile = path.join(configDir, 'logs', 'smart-voice-notify-debug.log');
        
        const fs = require('fs');
        expect(fs.existsSync(logFile)).toBe(true);
        const logContent = fs.readFileSync(logFile, 'utf8');
        expect(logContent).toContain('[per-project-sound]');
        expect(logContent).toContain('Assigned new sound');
    });
  });
});
