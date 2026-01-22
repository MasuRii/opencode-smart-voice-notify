import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { loadConfig, parseJSONC } from '../../util/config.js';
import { 
  createTestTempDir, 
  cleanupTestTempDir, 
  testFileExists,
  readTestFile
} from '../setup.js';

describe('loadConfig() integration', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTestTempDir();
  });

  afterEach(() => {
    cleanupTestTempDir();
  });

  it('should create a new config when none exists', () => {
    const config = loadConfig('smart-voice-notify');
    
    expect(testFileExists('smart-voice-notify.jsonc')).toBe(true);
    expect(config).toBeDefined();
    expect(config.enabled).toBe(true);
    // Should have version from project package.json
    expect(config._configVersion).toBeDefined();
    expect(typeof config._configVersion).toBe('string');
  });

  it('should read existing valid config', () => {
    const initialConfig = {
      enabled: false,
      notificationMode: 'tts-only',
      _configVersion: '1.0.0'
    };
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, JSON.stringify(initialConfig), 'utf-8');

    const config = loadConfig('smart-voice-notify');
    
    expect(config.enabled).toBe(false);
    expect(config.notificationMode).toBe('tts-only');
  });

  it('should handle invalid JSONC gracefully by returning defaults without overwriting', () => {
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, 'invalid { json: c }', 'utf-8');

    // Should not throw, should return defaults but NOT overwrite the invalid file
    // (preserves user's config for them to fix syntax errors)
    const config = loadConfig('smart-voice-notify');
    
    expect(config.enabled).toBe(true);
    // The invalid file should be preserved (not overwritten)
    const content = readTestFile('smart-voice-notify.jsonc');
    expect(content).toBe('invalid { json: c }');
  });

  it('should perform smart merge on update (add new fields)', () => {
    const existingConfig = {
      enabled: false,
      _configVersion: '1.0.0'
      // missing many fields
    };
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, JSON.stringify(existingConfig), 'utf-8');

    const config = loadConfig('smart-voice-notify');
    
    expect(config.enabled).toBe(false); // Preserved
    expect(config.notificationMode).toBe('sound-first'); // Added from defaults
    expect(config.enableTTS).toBe(true); // Added from defaults
    
    // Check that it wrote back to the file
    const content = readTestFile('smart-voice-notify.jsonc');
    expect(content).toContain('"notificationMode": "sound-first"');
    expect(content).toContain('"enabled": false');
  });

  it('should preserve user values during merge', () => {
    const existingConfig = {
      enabled: false,
      notificationMode: 'both',
      ttsReminderDelaySeconds: 99,
      _configVersion: '1.0.0'
    };
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, JSON.stringify(existingConfig), 'utf-8');

    const config = loadConfig('smart-voice-notify');
    
    expect(config.enabled).toBe(false);
    expect(config.notificationMode).toBe('both');
    expect(config.ttsReminderDelaySeconds).toBe(99);
  });

  it('should copy bundled assets to config directory', () => {
    // Verification depends on assets existing in project root
    loadConfig('smart-voice-notify');
    
    expect(fs.existsSync(path.join(tempDir, 'assets'))).toBe(true);
    // Check for specific bundled files
    const assets = fs.readdirSync(path.join(tempDir, 'assets'));
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.some(f => f.endsWith('.mp3'))).toBe(true);
  });

  it('should update _configVersion and write back to file when version changes', () => {
    const existingConfig = {
      enabled: true,
      _configVersion: '0.0.1'
    };
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, JSON.stringify(existingConfig), 'utf-8');

    const config = loadConfig('smart-voice-notify');
    
    const content = readTestFile('smart-voice-notify.jsonc');
    const parsed = parseJSONC(content);
    
    expect(parsed._configVersion).not.toBe('0.0.1');
    expect(config._configVersion).not.toBe('0.0.1');
    // It should match the version in package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    expect(config._configVersion).toBe(pkg.version);
  });

  it('should handle comments in JSONC files', () => {
    const jsoncContent = `{
      // This is a comment
      "enabled": false,
      /* Multi-line
         comment */
      "notificationMode": "sound-only"
    }`;
    const configPath = path.join(tempDir, 'smart-voice-notify.jsonc');
    fs.writeFileSync(configPath, jsoncContent, 'utf-8');

    const config = loadConfig('smart-voice-notify');
    
    expect(config.enabled).toBe(false);
    expect(config.notificationMode).toBe('sound-only');
  });
});
