import notifier from 'node-notifier';
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Desktop Notification Module for OpenCode Smart Voice Notify
 * 
 * Provides cross-platform native desktop notifications using node-notifier.
 * Supports Windows Toast, macOS Notification Center, and Linux notify-send.
 * 
 * Platform-specific behaviors:
 * - Windows: Uses SnoreToast for Windows 8+ toast notifications
 * - macOS: Uses terminal-notifier for Notification Center
 * - Linux: Uses notify-send (requires libnotify-bin package)
 * 
 * @module util/desktop-notify
 * @see docs/ARCHITECT_PLAN.md - Phase 1, Task 1.2
 */

/**
 * Debug logging to file.
 * Only logs when config.debugLog is enabled.
 * Writes to ~/.config/opencode/logs/smart-voice-notify-debug.log
 * 
 * @param {string} message - Message to log
 * @param {boolean} enabled - Whether debug logging is enabled
 */
const debugLog = (message, enabled = false) => {
  if (!enabled) return;
  
  try {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const logsDir = path.join(configDir, 'logs');
    
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [desktop-notify] ${message}\n`);
  } catch (e) {
    // Silently fail - logging should never break the plugin
  }
};

/**
 * Get the current platform identifier.
 * @returns {'darwin' | 'win32' | 'linux'} Platform string
 */
export const getPlatform = () => os.platform();

/**
 * Check if desktop notifications are likely to work on this platform.
 * 
 * @returns {{ supported: boolean, reason?: string }} Support status and reason if not supported
 */
export const checkNotificationSupport = () => {
  const platform = getPlatform();
  
  switch (platform) {
    case 'darwin':
      // macOS always supports notifications via terminal-notifier (bundled)
      return { supported: true };
      
    case 'win32':
      // Windows 8+ supports toast notifications via SnoreToast (bundled)
      return { supported: true };
      
    case 'linux':
      // Linux requires notify-send from libnotify-bin package
      // We don't check for its existence here - node-notifier handles the fallback
      return { supported: true };
      
    default:
      return { supported: false, reason: `Unsupported platform: ${platform}` };
  }
};

/**
 * Build platform-specific notification options.
 * Normalizes options across different platforms while respecting their unique capabilities.
 * 
 * @param {string} title - Notification title
 * @param {string} message - Notification body/message
 * @param {object} options - Additional options
 * @param {number} [options.timeout=5] - Notification timeout in seconds
 * @param {boolean} [options.sound=false] - Whether to play a sound (platform-specific)
 * @param {string} [options.icon] - Absolute path to notification icon
 * @param {string} [options.subtitle] - Subtitle (macOS only)
 * @param {string} [options.urgency] - Urgency level: 'low', 'normal', 'critical' (Linux only)
 * @returns {object} Platform-normalized notification options
 */
const buildPlatformOptions = (title, message, options = {}) => {
  const platform = getPlatform();
  const { timeout = 5, sound = false, icon, subtitle, urgency } = options;
  
  // Base options common to all platforms
  const baseOptions = {
    title: title || 'OpenCode',
    message: message || '',
    sound: sound,
    wait: false // Don't block - fire and forget
  };
  
  // Add icon if provided and exists
  if (icon && fs.existsSync(icon)) {
    baseOptions.icon = icon;
  }
  
  // Platform-specific options
  switch (platform) {
    case 'darwin':
      // macOS Notification Center options
      return {
        ...baseOptions,
        timeout: timeout,
        subtitle: subtitle || undefined
      };
      
    case 'win32':
      // Windows Toast options
      return {
        ...baseOptions,
        // Windows doesn't use timeout the same way - notifications persist until dismissed
        // sound can be true/false or a system sound name
        sound: sound
      };
      
    case 'linux':
      // Linux notify-send options
      return {
        ...baseOptions,
        timeout: timeout, // Timeout in seconds
        urgency: urgency || 'normal', // low, normal, critical
        'app-name': 'OpenCode Smart Notify'
      };
      
    default:
      return baseOptions;
  }
};

/**
 * Send a native desktop notification.
 * 
 * This is the main function for sending cross-platform desktop notifications.
 * It handles platform-specific options and gracefully fails if notifications
 * are not supported or the notifier encounters an error.
 * 
 * @param {string} title - Notification title
 * @param {string} message - Notification body/message
 * @param {object} [options={}] - Notification options
 * @param {number} [options.timeout=5] - Notification timeout in seconds
 * @param {boolean} [options.sound=false] - Whether to play a sound
 * @param {string} [options.icon] - Absolute path to notification icon
 * @param {string} [options.subtitle] - Subtitle (macOS only)
 * @param {string} [options.urgency='normal'] - Urgency level (Linux only)
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string }>} Result object
 * 
 * @example
 * // Simple notification
 * await sendDesktopNotification('Task Complete', 'Your code is ready for review');
 * 
 * @example
 * // With options
 * await sendDesktopNotification('Permission Required', 'Agent needs approval', {
 *   timeout: 10,
 *   urgency: 'critical',
 *   sound: true
 * });
 */
export const sendDesktopNotification = async (title, message, options = {}) => {
  // Handle null/undefined options gracefully
  const opts = options || {};
  const debug = opts.debugLog || false;
  
  try {
    // Check platform support
    const support = checkNotificationSupport();
    if (!support.supported) {
      debugLog(`Notification not supported: ${support.reason}`, debug);
      return { success: false, error: support.reason };
    }
    
    // Build platform-specific options
    const notifyOptions = buildPlatformOptions(title, message, opts);
    
    debugLog(`Sending notification: "${title}" - "${message}" (platform: ${getPlatform()})`, debug);
    
    // Send notification using promise wrapper
    return new Promise((resolve) => {
      notifier.notify(notifyOptions, (error, response) => {
        if (error) {
          debugLog(`Notification error: ${error.message}`, debug);
          resolve({ success: false, error: error.message });
        } else {
          debugLog(`Notification sent successfully (response: ${response})`, debug);
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    debugLog(`Notification exception: ${error.message}`, debug);
    return { success: false, error: error.message };
  }
};

/**
 * Send a notification for session idle (task completion).
 * Pre-configured for task completion notifications.
 * 
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @param {string} [options.projectName] - Project name to include in title
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string }>} Result object
 */
export const notifyTaskComplete = async (message, options = {}) => {
  const title = options.projectName 
    ? `✅ ${options.projectName} - Task Complete`
    : '✅ OpenCode - Task Complete';
    
  return sendDesktopNotification(title, message, {
    timeout: 5,
    sound: false, // We handle sound separately in the main plugin
    ...options
  });
};

/**
 * Send a notification for permission requests.
 * Pre-configured for permission request notifications (more urgent).
 * 
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @param {string} [options.projectName] - Project name to include in title
 * @param {number} [options.count=1] - Number of permission requests
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string }>} Result object
 */
export const notifyPermissionRequest = async (message, options = {}) => {
  const count = options.count || 1;
  const title = options.projectName 
    ? `⚠️ ${options.projectName} - Permission Required`
    : count > 1 
      ? `⚠️ ${count} Permissions Required`
      : '⚠️ OpenCode - Permission Required';
      
  return sendDesktopNotification(title, message, {
    timeout: 10, // Longer timeout for permissions
    urgency: 'critical', // Higher urgency on Linux
    sound: false, // We handle sound separately
    ...options
  });
};

/**
 * Send a notification for question requests (SDK v1.1.7+).
 * Pre-configured for question notifications.
 * 
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @param {string} [options.projectName] - Project name to include in title
 * @param {number} [options.count=1] - Number of questions
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string }>} Result object
 */
export const notifyQuestion = async (message, options = {}) => {
  const count = options.count || 1;
  const title = options.projectName 
    ? `❓ ${options.projectName} - Question`
    : count > 1 
      ? `❓ ${count} Questions Need Your Input`
      : '❓ OpenCode - Question';
      
  return sendDesktopNotification(title, message, {
    timeout: 8,
    urgency: 'normal',
    sound: false, // We handle sound separately
    ...options
  });
};

/**
 * Send a notification for error events.
 * Pre-configured for error notifications (most urgent).
 * 
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @param {string} [options.projectName] - Project name to include in title
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string }>} Result object
 */
export const notifyError = async (message, options = {}) => {
  const title = options.projectName 
    ? `❌ ${options.projectName} - Error`
    : '❌ OpenCode - Error';
      
  return sendDesktopNotification(title, message, {
    timeout: 15, // Longer timeout for errors
    urgency: 'critical',
    sound: false, // We handle sound separately
    ...options
  });
};

// Default export for convenience
export default {
  sendDesktopNotification,
  notifyTaskComplete,
  notifyPermissionRequest,
  notifyQuestion,
  notifyError,
  checkNotificationSupport,
  getPlatform
};
