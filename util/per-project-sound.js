import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Per-Project Sound Module
 * 
 * Provides logic for assigning unique sounds to different projects.
 * Hashes project directory + seed to pick a consistent sound from assets.
 */

const projectSoundCache = new Map();

/**
 * Internal debug logger
 * @param {string} message 
 * @param {object} config 
 */
const debugLog = (message, config) => {
  if (!config || !config.debugLog) return;
  
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const logsDir = path.join(configDir, 'logs');
  const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [per-project-sound] ${message}\n`);
  } catch (e) {
    // Silently fail - logging is optional
  }
};

/**
 * Get a unique sound for a project by hashing its path.
 * @param {object} project - The project object (should contain directory)
 * @param {object} config - Plugin configuration
 * @returns {string | null} Relative path to the project-specific sound, or null if disabled/unavailable
 */
export const getProjectSound = (project, config) => {
  if (!config || !config.perProjectSounds || !project?.directory) {
    return null;
  }

  const projectPath = project.directory;
  
  // Use cache to ensure consistency within session
  if (projectSoundCache.has(projectPath)) {
    const cachedSound = projectSoundCache.get(projectPath);
    debugLog(`Returning cached sound for project: ${projectPath} -> ${cachedSound}`, config);
    return cachedSound;
  }

  try {
    // Hash the path + seed
    const seed = config.projectSoundSeed || 0;
    // We use MD5 because it's fast and sufficient for this purpose
    const hash = crypto.createHash('md5').update(projectPath + seed).digest('hex');
    
    // Map hash to 1-6 (opencode-notificator pattern)
    // Using first 8 chars of hash for a stable number
    const soundIndex = (parseInt(hash.substring(0, 8), 16) % 6) + 1;
    const soundFile = `assets/ding${soundIndex}.mp3`;
    
    debugLog(`Assigned new sound for project: ${projectPath} (seed: ${seed}) -> ${soundFile}`, config);
    
    // Cache and return
    projectSoundCache.set(projectPath, soundFile);
    return soundFile;
  } catch (e) {
    debugLog(`Error assigning project sound: ${e.message}`, config);
    return null;
  }
};

/**
 * Clear the project sound cache (used for testing)
 */
export const clearProjectSoundCache = () => {
  projectSoundCache.clear();
};

export default {
  getProjectSound,
  clearProjectSoundCache
};
