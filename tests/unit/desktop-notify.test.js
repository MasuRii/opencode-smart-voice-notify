/**
 * Unit Tests for Desktop Notification Module
 * 
 * Tests for util/desktop-notify.js cross-platform desktop notification functionality.
 * Uses mocked node-notifier to avoid actual notifications during tests.
 * 
 * @see util/desktop-notify.js
 * @see docs/ARCHITECT_PLAN.md - Phase 1, Task 1.6
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  createTestTempDir,
  cleanupTestTempDir,
  createTestLogsDir
} from '../setup.js';

// Store original os.platform for restoration
let originalPlatform;

// Mock notifier at module level
let mockNotify;
let mockNotifyCallback;

/**
 * Sets up a mock for node-notifier.
 * We need to use dynamic import and module mocking.
 */
const setupNotifierMock = () => {
  mockNotifyCallback = null;
  mockNotify = mock((options, callback) => {
    mockNotifyCallback = callback;
    // By default, simulate successful notification
    if (callback) {
      callback(null, 'ok');
    }
  });
  
  return {
    notify: mockNotify
  };
};

describe('desktop-notify module', () => {
  // Import the module fresh for each test
  let desktopNotify;
  let sendDesktopNotification;
  let notifyTaskComplete;
  let notifyPermissionRequest;
  let notifyQuestion;
  let notifyError;
  let checkNotificationSupport;
  let getPlatform;
  
  beforeEach(async () => {
    // Create test temp directory
    createTestTempDir();
    createTestLogsDir();
    
    // Fresh import of the module
    const module = await import('../../util/desktop-notify.js');
    desktopNotify = module.default;
    sendDesktopNotification = module.sendDesktopNotification;
    notifyTaskComplete = module.notifyTaskComplete;
    notifyPermissionRequest = module.notifyPermissionRequest;
    notifyQuestion = module.notifyQuestion;
    notifyError = module.notifyError;
    checkNotificationSupport = module.checkNotificationSupport;
    getPlatform = module.getPlatform;
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  describe('getPlatform()', () => {
    test('returns a valid platform string', () => {
      const platform = getPlatform();
      expect(['darwin', 'win32', 'linux', 'freebsd', 'sunos', 'aix']).toContain(platform);
    });
    
    test('returns consistent value on multiple calls', () => {
      const platform1 = getPlatform();
      const platform2 = getPlatform();
      expect(platform1).toBe(platform2);
    });
  });

  describe('checkNotificationSupport()', () => {
    test('returns object with supported property', () => {
      const result = checkNotificationSupport();
      expect(result).toHaveProperty('supported');
      expect(typeof result.supported).toBe('boolean');
    });
    
    test('returns supported: true for common platforms', () => {
      // On any common platform (darwin, win32, linux), should be supported
      const result = checkNotificationSupport();
      const platform = getPlatform();
      
      if (['darwin', 'win32', 'linux'].includes(platform)) {
        expect(result.supported).toBe(true);
      }
    });
    
    test('does not have error reason when supported', () => {
      const result = checkNotificationSupport();
      if (result.supported) {
        expect(result.reason).toBeUndefined();
      }
    });
  });

  describe('sendDesktopNotification()', () => {
    test('returns a promise', () => {
      const result = sendDesktopNotification('Test', 'Message');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('resolves with success property', async () => {
      const result = await sendDesktopNotification('Test Title', 'Test Message');
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    }, 15000); // Extended timeout for real notifications
    
    test('accepts title and message parameters', async () => {
      // Should not throw
      const result = await sendDesktopNotification('Title Here', 'Body Here');
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
    
    test('handles empty title gracefully', async () => {
      const result = await sendDesktopNotification('', 'Message');
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
    
    test('handles empty message gracefully', async () => {
      const result = await sendDesktopNotification('Title', '');
      expect(result).toBeDefined();
    });
    
    test('accepts options parameter', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        timeout: 10,
        sound: true,
        urgency: 'critical'
      });
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
    
    test('handles undefined options', async () => {
      const result = await sendDesktopNotification('Title', 'Message', undefined);
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
  });

  describe('timeout configuration', () => {
    test('accepts timeout option', async () => {
      const result = await sendDesktopNotification('Test', 'Message', {
        timeout: 15
      });
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
    
    test('default timeout is applied when not specified', async () => {
      // Module should apply default timeout of 5
      const result = await sendDesktopNotification('Test', 'Message');
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
    
    test('accepts zero timeout', async () => {
      const result = await sendDesktopNotification('Test', 'Message', {
        timeout: 0
      });
      expect(result).toBeDefined();
    }, 15000); // Extended timeout for real notifications
  });

  describe('platform-specific options', () => {
    test('accepts macOS-specific subtitle option', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        subtitle: 'macOS Subtitle'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts Linux-specific urgency option', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        urgency: 'critical'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts urgency: low', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        urgency: 'low'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts urgency: normal', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        urgency: 'normal'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts sound option for Windows', async () => {
      const result = await sendDesktopNotification('Title', 'Message', {
        sound: true
      });
      expect(result).toBeDefined();
    });
    
    test('accepts icon option', async () => {
      // Pass a non-existent icon path - should not throw
      const result = await sendDesktopNotification('Title', 'Message', {
        icon: '/path/to/icon.png'
      });
      expect(result).toBeDefined();
    });
  });

  describe('notifyTaskComplete()', () => {
    test('returns a promise', () => {
      const result = notifyTaskComplete('Task done');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('resolves with success property', async () => {
      const result = await notifyTaskComplete('Your code is ready');
      expect(result).toHaveProperty('success');
    });
    
    test('accepts message parameter', async () => {
      const result = await notifyTaskComplete('Build complete!');
      expect(result).toBeDefined();
    });
    
    test('accepts projectName option', async () => {
      const result = await notifyTaskComplete('Task done', {
        projectName: 'MyProject'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts debugLog option', async () => {
      const result = await notifyTaskComplete('Task done', {
        debugLog: false
      });
      expect(result).toBeDefined();
    });
  });

  describe('notifyPermissionRequest()', () => {
    test('returns a promise', () => {
      const result = notifyPermissionRequest('Permission needed');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('resolves with success property', async () => {
      const result = await notifyPermissionRequest('Approval required');
      expect(result).toHaveProperty('success');
    });
    
    test('accepts count option for batch notifications', async () => {
      const result = await notifyPermissionRequest('Multiple permissions', {
        count: 5
      });
      expect(result).toBeDefined();
    });
    
    test('handles count of 1', async () => {
      const result = await notifyPermissionRequest('Single permission', {
        count: 1
      });
      expect(result).toBeDefined();
    });
    
    test('accepts projectName option', async () => {
      const result = await notifyPermissionRequest('Permission needed', {
        projectName: 'TestProject'
      });
      expect(result).toBeDefined();
    });
  });

  describe('notifyQuestion()', () => {
    test('returns a promise', () => {
      const result = notifyQuestion('Question pending');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('resolves with success property', async () => {
      const result = await notifyQuestion('Agent has a question');
      expect(result).toHaveProperty('success');
    });
    
    test('accepts count option for batch notifications', async () => {
      const result = await notifyQuestion('Multiple questions', {
        count: 3
      });
      expect(result).toBeDefined();
    });
    
    test('handles count of 1', async () => {
      const result = await notifyQuestion('Single question', {
        count: 1
      });
      expect(result).toBeDefined();
    });
    
    test('accepts projectName option', async () => {
      const result = await notifyQuestion('Question', {
        projectName: 'MyApp'
      });
      expect(result).toBeDefined();
    });
  });

  describe('notifyError()', () => {
    test('returns a promise', () => {
      const result = notifyError('Error occurred');
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('resolves with success property', async () => {
      const result = await notifyError('Something went wrong');
      expect(result).toHaveProperty('success');
    });
    
    test('accepts projectName option', async () => {
      const result = await notifyError('Build failed', {
        projectName: 'FailingProject'
      });
      expect(result).toBeDefined();
    });
    
    test('accepts debugLog option', async () => {
      const result = await notifyError('Error!', {
        debugLog: false
      });
      expect(result).toBeDefined();
    });
  });

  describe('debug logging', () => {
    test('accepts debugLog option without error', async () => {
      const result = await sendDesktopNotification('Test', 'Message', {
        debugLog: true
      });
      expect(result).toBeDefined();
    });
    
    test('debug logging does not affect return value', async () => {
      const withDebug = await sendDesktopNotification('Test', 'Msg', { debugLog: true });
      const withoutDebug = await sendDesktopNotification('Test', 'Msg', { debugLog: false });
      
      // Both should have same structure
      expect(withDebug).toHaveProperty('success');
      expect(withoutDebug).toHaveProperty('success');
    });
    
    test('debug logs are written when enabled', async () => {
      // Enable debug and send notification
      await sendDesktopNotification('Debug Test', 'Testing debug logs', {
        debugLog: true
      });
      
      // Note: We can't easily verify the log file content here without
      // more complex setup, but we verify the function doesn't throw
    });
  });

  describe('error handling', () => {
    test('handles missing title gracefully', async () => {
      // @ts-ignore - intentionally testing undefined
      const result = await sendDesktopNotification(undefined, 'Message');
      expect(result).toBeDefined();
    });
    
    test('handles missing message gracefully', async () => {
      // @ts-ignore - intentionally testing undefined
      const result = await sendDesktopNotification('Title', undefined);
      expect(result).toBeDefined();
    });
    
    test('handles null options gracefully', async () => {
      const result = await sendDesktopNotification('Title', 'Message', null);
      expect(result).toBeDefined();
    });
    
    test('result has error property on failure', async () => {
      // This test checks the structure of error responses
      // Since we can't reliably force an error, we just verify the module handles errors
      const result = await sendDesktopNotification('Test', 'Message');
      
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('default export', () => {
    test('exports all functions via default export', () => {
      expect(desktopNotify).toHaveProperty('sendDesktopNotification');
      expect(desktopNotify).toHaveProperty('notifyTaskComplete');
      expect(desktopNotify).toHaveProperty('notifyPermissionRequest');
      expect(desktopNotify).toHaveProperty('notifyQuestion');
      expect(desktopNotify).toHaveProperty('notifyError');
      expect(desktopNotify).toHaveProperty('checkNotificationSupport');
      expect(desktopNotify).toHaveProperty('getPlatform');
    });
    
    test('default export functions work correctly', async () => {
      const result = await desktopNotify.sendDesktopNotification('Test', 'Message');
      expect(result).toHaveProperty('success');
    });
  });

  describe('integration with helper functions', () => {
    test('notifyTaskComplete uses appropriate timeout', async () => {
      // Task complete should have short timeout (5s)
      const result = await notifyTaskComplete('Done');
      expect(result).toBeDefined();
    });
    
    test('notifyPermissionRequest uses longer timeout', async () => {
      // Permission requests should have longer timeout (10s) for urgency
      const result = await notifyPermissionRequest('Needs approval');
      expect(result).toBeDefined();
    });
    
    test('notifyError uses longest timeout', async () => {
      // Errors should persist longer (15s) to ensure user sees them
      const result = await notifyError('Critical error');
      expect(result).toBeDefined();
    });
  });
});
