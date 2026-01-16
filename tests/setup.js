/**
 * Test Setup Preload File
 * 
 * This file is loaded before all tests run (via bunfig.toml preload).
 * It sets up the test environment with:
 * - Temporary directory for file isolation
 * - Environment variables for test mode
 * - Global test helpers and utilities
 * 
 * @see docs/ARCHITECT_PLAN.md - Phase 0, Task 0.3
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ============================================================
// TEST ENVIRONMENT CONFIGURATION
// ============================================================

/**
 * Base temporary directory for all test runs.
 * Each test file gets its own subdirectory to prevent conflicts.
 */
const TEST_TEMP_BASE = path.join(os.tmpdir(), 'opencode-smart-voice-notify-tests');

/**
 * Current test's temporary directory (set per-test-file)
 */
let currentTestDir = null;

// ============================================================
// ENVIRONMENT VARIABLES FOR TEST MODE
// ============================================================

// Mark that we're in test mode
process.env.NODE_ENV = 'test';

// Disable debug logging during tests (can be overridden per-test)
process.env.SMART_VOICE_NOTIFY_DEBUG = 'false';

// ============================================================
// TEMPORARY DIRECTORY MANAGEMENT
// ============================================================

/**
 * Creates a unique temporary directory for the current test file.
 * Sets OPENCODE_CONFIG_DIR to redirect all file operations.
 * 
 * @returns {string} Path to the created temp directory
 */
export function createTestTempDir() {
  // Generate unique directory name using timestamp and random suffix
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const tempDir = path.join(TEST_TEMP_BASE, uniqueId);
  
  // Create the directory structure
  fs.mkdirSync(tempDir, { recursive: true });
  
  // Set environment variable to redirect config operations
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  
  // Store reference for cleanup
  currentTestDir = tempDir;
  
  return tempDir;
}

/**
 * Cleans up the current test's temporary directory.
 * Safe to call multiple times.
 */
export function cleanupTestTempDir() {
  if (currentTestDir && fs.existsSync(currentTestDir)) {
    try {
      fs.rmSync(currentTestDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors (Windows file locking, etc.)
    }
    currentTestDir = null;
  }
  
  // Reset environment variable
  delete process.env.OPENCODE_CONFIG_DIR;
}

/**
 * Gets the current test's temporary directory path.
 * Creates one if it doesn't exist.
 * 
 * @returns {string} Path to the current temp directory
 */
export function getTestTempDir() {
  if (!currentTestDir) {
    return createTestTempDir();
  }
  return currentTestDir;
}

// ============================================================
// TEST FIXTURE HELPERS
// ============================================================

/**
 * Creates a test config file in the temp directory.
 * 
 * @param {object} config - Configuration object to write
 * @param {string} [filename='smart-voice-notify.jsonc'] - Config filename
 * @returns {string} Path to the created config file
 */
export function createTestConfig(config, filename = 'smart-voice-notify.jsonc') {
  const tempDir = getTestTempDir();
  const configPath = path.join(tempDir, filename);
  
  // Write as JSONC (with optional comments support via JSON.stringify)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  
  return configPath;
}

/**
 * Creates a minimal test config with sensible defaults for testing.
 * 
 * @param {object} [overrides={}] - Properties to override defaults
 * @returns {object} Test configuration object
 */
export function createMinimalConfig(overrides = {}) {
  return {
    _configVersion: '1.0.0',
    enabled: true,
    notificationMode: 'sound-first',
    enableTTS: false,          // Disable TTS in tests by default
    enableTTSReminder: false,  // Disable reminders in tests by default
    enableSound: false,        // Disable sounds in tests by default
    enableToast: false,        // Disable toasts in tests by default
    debugLog: false,           // Disable debug logging in tests
    ...overrides
  };
}

/**
 * Creates the assets directory with a minimal test audio file.
 * 
 * @returns {string} Path to the created assets directory
 */
export function createTestAssets() {
  const tempDir = getTestTempDir();
  const assetsDir = path.join(tempDir, 'assets');
  
  fs.mkdirSync(assetsDir, { recursive: true });
  
  // Create a minimal valid MP3 file (ID3 header + frame)
  // This is the smallest valid MP3 that most players won't choke on
  const minimalMp3 = Buffer.from([
    0xFF, 0xFB, 0x90, 0x00, // MPEG Audio Frame Header
    0x00, 0x00, 0x00, 0x00, // Padding
  ]);
  
  // Create test sound files
  const soundFiles = [
    'Soft-high-tech-notification-sound-effect.mp3',
    'Machine-alert-beep-sound-effect.mp3',
    'test-sound.mp3'
  ];
  
  for (const file of soundFiles) {
    fs.writeFileSync(path.join(assetsDir, file), minimalMp3);
  }
  
  return assetsDir;
}

/**
 * Creates a mock logs directory.
 * 
 * @returns {string} Path to the created logs directory
 */
export function createTestLogsDir() {
  const tempDir = getTestTempDir();
  const logsDir = path.join(tempDir, 'logs');
  
  fs.mkdirSync(logsDir, { recursive: true });
  
  return logsDir;
}

/**
 * Reads a file from the test temp directory.
 * 
 * @param {string} relativePath - Path relative to temp directory
 * @returns {string|null} File contents or null if not found
 */
export function readTestFile(relativePath) {
  const tempDir = getTestTempDir();
  const filePath = path.join(tempDir, relativePath);
  
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return null;
  }
}

/**
 * Checks if a file exists in the test temp directory.
 * 
 * @param {string} relativePath - Path relative to temp directory
 * @returns {boolean} True if file exists
 */
export function testFileExists(relativePath) {
  const tempDir = getTestTempDir();
  const filePath = path.join(tempDir, relativePath);
  
  return fs.existsSync(filePath);
}

// ============================================================
// MOCK FACTORY UTILITIES
// ============================================================

/**
 * Creates a mock shell runner ($) for testing.
 * Records all commands executed for verification.
 * 
 * @param {object} [options={}] - Mock options
 * @param {function} [options.handler] - Custom handler for commands
 * @returns {object} Mock shell runner with call history
 */
export function createMockShellRunner(options = {}) {
  const calls = [];
  
  const mockRunner = async (strings, ...values) => {
    // Reconstruct the command from template literal
    let command = strings[0];
    for (let i = 0; i < values.length; i++) {
      command += String(values[i]) + strings[i + 1];
    }
    
    const callRecord = {
      command: command.trim(),
      timestamp: Date.now()
    };
    calls.push(callRecord);
    
    // Allow custom handler for specific commands
    if (options.handler) {
      return options.handler(command, callRecord);
    }
    
    // Default: return empty successful result
    return {
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      exitCode: 0,
      text: () => '',
      toString: () => ''
    };
  };
  
  // Add utility methods
  mockRunner.getCalls = () => [...calls];
  mockRunner.getLastCall = () => calls[calls.length - 1];
  mockRunner.getCallCount = () => calls.length;
  mockRunner.reset = () => { calls.length = 0; };
  mockRunner.wasCalledWith = (pattern) => calls.some(c => 
    typeof pattern === 'string' 
      ? c.command.includes(pattern) 
      : pattern.test(c.command)
  );
  
  return mockRunner;
}

/**
 * Creates a mock OpenCode SDK client for testing.
 * 
 * @param {object} [options={}] - Mock options
 * @returns {object} Mock client with common methods
 */
export function createMockClient(options = {}) {
  const toastCalls = [];
  const sessionData = new Map();
  
  return {
    tui: {
      showToast: async ({ body }) => {
        toastCalls.push({
          message: body.message,
          variant: body.variant,
          duration: body.duration,
          timestamp: Date.now()
        });
        return { success: true };
      },
      getToastCalls: () => [...toastCalls],
      resetToastCalls: () => { toastCalls.length = 0; }
    },
    
    session: {
      get: async ({ path: { id } }) => {
        // Return mock session data
        const session = sessionData.get(id) || {
          id,
          parentID: null,
          status: 'idle'
        };
        return { data: session };
      },
      setMockSession: (id, data) => {
        sessionData.set(id, { id, ...data });
      },
      clearMockSessions: () => {
        sessionData.clear();
      }
    },
    
    app: {
      log: async ({ service, level, message, extra }) => {
        // Silent in tests
        return { success: true };
      }
    },
    
    permission: {
      reply: async ({ body }) => {
        return { success: true };
      }
    },
    
    question: {
      reply: async ({ body }) => {
        return { success: true };
      },
      reject: async ({ body }) => {
        return { success: true };
      }
    }
  };
}

/**
 * Creates a mock event for testing plugin event handlers.
 * 
 * @param {string} type - Event type (e.g., 'session.idle', 'permission.updated')
 * @param {object} [properties={}] - Event properties
 * @returns {object} Mock event object
 */
export function createMockEvent(type, properties = {}) {
  return {
    type,
    properties: {
      sessionID: properties.sessionID || `test-session-${Date.now()}`,
      ...properties
    }
  };
}

/**
 * Creates common mock events for testing.
 */
export const mockEvents = {
  sessionIdle: (sessionID) => createMockEvent('session.idle', { sessionID }),
  
  sessionCreated: (sessionID) => createMockEvent('session.created', { sessionID }),
  
  permissionAsked: (id, sessionID) => createMockEvent('permission.asked', {
    id: id || `perm-${Date.now()}`,
    sessionID
  }),
  
  permissionReplied: (requestID, reply = 'once') => createMockEvent('permission.replied', {
    requestID,
    reply
  }),
  
  questionAsked: (id, sessionID, questions = [{ text: 'Test question?' }]) => 
    createMockEvent('question.asked', {
      id: id || `q-${Date.now()}`,
      sessionID,
      questions
    }),
  
  questionReplied: (requestID, answers = [['answer']]) => createMockEvent('question.replied', {
    requestID,
    answers
  }),
  
  questionRejected: (requestID) => createMockEvent('question.rejected', {
    requestID
  }),
  
  messageUpdated: (messageId, role = 'user', sessionID) => createMockEvent('message.updated', {
    sessionID,
    info: {
      id: messageId || `msg-${Date.now()}`,
      role,
      time: { created: Date.now() / 1000 }
    }
  })
};

// ============================================================
// ASYNC TEST UTILITIES
// ============================================================

/**
 * Waits for a specified number of milliseconds.
 * Useful for testing debounced/delayed operations.
 * 
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Waits for a condition to become true.
 * 
 * @param {function} condition - Function returning boolean or promise
 * @param {number} [timeout=5000] - Maximum time to wait
 * @param {number} [interval=50] - Check interval
 * @returns {Promise<void>}
 */
export async function waitFor(condition, timeout = 5000, interval = 50) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) return;
    await wait(interval);
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

// ============================================================
// GLOBAL SETUP/TEARDOWN HOOKS
// ============================================================

// Ensure the base temp directory exists at startup
beforeAll(() => {
  if (!fs.existsSync(TEST_TEMP_BASE)) {
    fs.mkdirSync(TEST_TEMP_BASE, { recursive: true });
  }
});

// Clean up after all tests complete
afterAll(() => {
  // Clean up the entire test temp base if empty
  try {
    const contents = fs.readdirSync(TEST_TEMP_BASE);
    if (contents.length === 0) {
      fs.rmdirSync(TEST_TEMP_BASE);
    }
  } catch (e) {
    // Ignore errors
  }
});

// Reset environment for each test
beforeEach(() => {
  // Reset NODE_ENV to test
  process.env.NODE_ENV = 'test';
});

// Clean up temp directory after each test (if created)
afterEach(() => {
  cleanupTestTempDir();
});

// ============================================================
// CONSOLE OUTPUT CAPTURE (Optional)
// ============================================================

/**
 * Captures console output during test execution.
 * Useful for testing debug logging.
 * 
 * @returns {object} Capture controller with start/stop/get methods
 */
export function createConsoleCapture() {
  const logs = { log: [], warn: [], error: [], info: [], debug: [] };
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };
  let capturing = false;
  
  return {
    start() {
      if (capturing) return;
      capturing = true;
      
      for (const type of Object.keys(original)) {
        console[type] = (...args) => {
          logs[type].push(args);
        };
      }
    },
    
    stop() {
      if (!capturing) return;
      capturing = false;
      
      for (const [type, fn] of Object.entries(original)) {
        console[type] = fn;
      }
    },
    
    get(type) {
      return type ? logs[type] : logs;
    },
    
    clear() {
      for (const type of Object.keys(logs)) {
        logs[type].length = 0;
      }
    }
  };
}

// ============================================================
// EXPORTS SUMMARY
// ============================================================

// All exports are named exports above. Default export for convenience:
export default {
  // Temp directory management
  createTestTempDir,
  cleanupTestTempDir,
  getTestTempDir,
  
  // Fixture helpers
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createTestLogsDir,
  readTestFile,
  testFileExists,
  
  // Mock factories
  createMockShellRunner,
  createMockClient,
  createMockEvent,
  mockEvents,
  
  // Async utilities
  wait,
  waitFor,
  
  // Console capture
  createConsoleCapture
};
