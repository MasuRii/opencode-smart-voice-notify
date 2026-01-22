import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Sound Theme Module
 * 
 * Provides functionality for themed sound packs.
 * Supports directory structure with idle/, permission/, error/, and question/ subdirectories.
 */

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];

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
    fs.appendFileSync(logFile, `[${timestamp}] [sound-theme] ${message}\n`);
  } catch (e) {
    // Silently fail - logging is optional
  }
};

/**
 * List all audio files in a theme subdirectory
 * @param {string} themeDir - Root theme directory
 * @param {string} eventType - Subdirectory name (idle, permission, error, question)
 * @returns {string[]} Absolute paths to audio files
 */
export const listSoundsInTheme = (themeDir, eventType) => {
  if (!themeDir) return [];

  const subDir = path.join(themeDir, eventType);
  if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory()) {
    return [];
  }

  try {
    return fs.readdirSync(subDir)
      .filter(file => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
      .sort() // Sort alphabetically for consistent cross-platform behavior
      .map(file => path.join(subDir, file))
      .filter(filePath => fs.statSync(filePath).isFile());
  } catch (error) {
    return [];
  }
};

/**
 * Pick a sound for the given event type from the theme directory
 * @param {string} eventType - Type of event (idle, permission, error, question)
 * @param {object} config - Plugin configuration
 * @returns {string|null} Path to the selected sound, or null if theme not available
 */
export const pickThemeSound = (eventType, config) => {
  if (!config.soundThemeDir) return null;

  // Resolve absolute path if relative
  let themeDir = config.soundThemeDir;
  if (!path.isAbsolute(themeDir)) {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    themeDir = path.join(configDir, themeDir);
  }

  if (!fs.existsSync(themeDir)) {
    debugLog(`Theme directory not found: ${themeDir}`, config);
    return null;
  }

  const sounds = listSoundsInTheme(themeDir, eventType);
  if (sounds.length === 0) {
    debugLog(`No sounds found for event type '${eventType}' in theme: ${themeDir}`, config);
    return null;
  }

  let selected;
  if (config.randomizeSoundFromTheme) {
    const randomIndex = Math.floor(Math.random() * sounds.length);
    selected = sounds[randomIndex];
    debugLog(`Randomly selected sound for '${eventType}': ${selected} (from ${sounds.length} files)`, config);
  } else {
    selected = sounds[0];
    debugLog(`Selected first sound for '${eventType}': ${selected}`, config);
  }

  return selected;
};

/**
 * Pick a random sound from a directory
 * @param {string} dirPath - Directory path
 * @returns {string|null} Path to a random audio file
 */
export const pickRandomSound = (dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return null;

  try {
    const files = fs.readdirSync(dirPath)
      .filter(file => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(dirPath, file))
      .filter(filePath => fs.statSync(filePath).isFile());

    if (files.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * files.length);
    return files[randomIndex];
  } catch (error) {
    return null;
  }
};

export default {
  listSoundsInTheme,
  pickThemeSound,
  pickRandomSound
};
