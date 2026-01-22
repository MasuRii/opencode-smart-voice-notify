import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Webhook Module for OpenCode Smart Voice Notify
 * 
 * Provides Discord webhook integration for remote notifications.
 * Sends formatted notifications to Discord channels when the agent
 * needs attention (idle, permission, error, question events).
 * 
 * Features:
 * - Discord webhook format with rich embeds
 * - Rate limiting with automatic retry
 * - In-memory queue for reliability
 * - Fire-and-forget operation (non-blocking)
 * - Debug logging
 * 
 * @module util/webhook
 * @see docs/ARCHITECT_PLAN.md - Phase 4, Task 4.1
 */

// ========================================
// QUEUE CONFIGURATION
// ========================================

/**
 * In-memory queue for webhook messages.
 * Provides basic reliability - if a send fails, it can be retried.
 * Note: This is not persistent; queue is lost on process restart.
 */
const webhookQueue = [];

/**
 * Maximum queue size to prevent memory issues.
 */
const MAX_QUEUE_SIZE = 100;

/**
 * Flag to indicate if queue processing is running.
 */
let isProcessingQueue = false;

// ========================================
// RATE LIMITING
// ========================================

/**
 * Rate limit state tracking.
 * Discord rate limits webhooks, so we need to handle 429 responses.
 */
let rateLimitState = {
  isRateLimited: false,
  retryAfter: 0,
  retryTimestamp: 0
};

/**
 * Default retry delay in milliseconds when rate limited without Retry-After header.
 */
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * Maximum number of retry attempts for a single message.
 */
const MAX_RETRIES = 3;

// ========================================
// DEBUG LOGGING
// ========================================

/**
 * Debug logging to file.
 * Only logs when enabled.
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
    fs.appendFileSync(logFile, `[${timestamp}] [webhook] ${message}\n`);
  } catch (e) {
    // Silently fail - logging should never break the plugin
  }
};

// ========================================
// DISCORD EMBED COLORS
// ========================================

/**
 * Discord embed colors for different event types.
 * Colors are specified as decimal integers.
 */
export const EMBED_COLORS = {
  idle: 0x00ff00,      // Green - task complete
  permission: 0xffaa00, // Orange/Amber - needs attention
  error: 0xff0000,     // Red - error
  question: 0x0099ff,  // Blue - question
  default: 0x7289da    // Discord blurple
};

/**
 * Emoji prefixes for different event types.
 */
const EVENT_EMOJIS = {
  idle: '✅',
  permission: '⚠️',
  error: '❌',
  question: '❓',
  default: '🔔'
};

// ========================================
// CORE FUNCTIONS
// ========================================

/**
 * Validate a webhook URL.
 * Currently supports Discord webhook URLs.
 * 
 * @param {string} url - URL to validate
 * @returns {{ valid: boolean, reason?: string }} Validation result
 */
export const validateWebhookUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is required' };
  }
  
  // Basic URL validation
  try {
    const parsed = new URL(url);
    
    // Check for Discord webhook pattern
    if (parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com') {
      if (parsed.pathname.includes('/api/webhooks/')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid Discord webhook URL format' };
    }
    
    // Allow generic webhooks for future expansion
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return { valid: true };
    }
    
    return { valid: false, reason: 'Invalid URL protocol' };
  } catch (e) {
    return { valid: false, reason: 'Invalid URL format' };
  }
};

/**
 * Build a Discord embed object for a notification.
 * 
 * @param {object} options - Embed options
 * @param {string} options.eventType - Event type (idle, permission, error, question)
 * @param {string} options.title - Embed title
 * @param {string} options.message - Embed description/message
 * @param {string} [options.projectName] - Project name for context
 * @param {string} [options.sessionId] - Session ID for reference
 * @param {number} [options.count] - Count for batched notifications
 * @param {object} [options.extra] - Additional fields to add
 * @returns {object} Discord embed object
 */
export const buildDiscordEmbed = (options) => {
  const {
    eventType = 'default',
    title,
    message,
    projectName,
    sessionId,
    count,
    extra = {}
  } = options;
  
  const emoji = EVENT_EMOJIS[eventType] || EVENT_EMOJIS.default;
  const color = EMBED_COLORS[eventType] || EMBED_COLORS.default;
  
  const embed = {
    title: `${emoji} ${title || 'OpenCode Notification'}`,
    description: message || '',
    color: color,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'OpenCode Smart Voice Notify'
    }
  };
  
  // Add fields for additional context
  const fields = [];
  
  if (projectName) {
    fields.push({
      name: 'Project',
      value: projectName,
      inline: true
    });
  }
  
  if (eventType) {
    fields.push({
      name: 'Event',
      value: eventType.charAt(0).toUpperCase() + eventType.slice(1),
      inline: true
    });
  }
  
  if (count && count > 1) {
    fields.push({
      name: 'Count',
      value: String(count),
      inline: true
    });
  }
  
  if (sessionId) {
    fields.push({
      name: 'Session',
      value: sessionId.substring(0, 8) + '...',
      inline: true
    });
  }
  
  // Add any extra fields
  if (extra.fields && Array.isArray(extra.fields)) {
    fields.push(...extra.fields);
  }
  
  if (fields.length > 0) {
    embed.fields = fields;
  }
  
  return embed;
};

/**
 * Build a Discord webhook payload.
 * 
 * @param {object} options - Payload options
 * @param {string} [options.username='OpenCode Notify'] - Webhook username
 * @param {string} [options.avatarUrl] - Avatar URL for the webhook
 * @param {string} [options.content] - Plain text content (for mentions)
 * @param {object[]} [options.embeds] - Array of embed objects
 * @returns {object} Discord webhook payload
 */
export const buildWebhookPayload = (options) => {
  const {
    username = 'OpenCode Notify',
    avatarUrl,
    content,
    embeds = []
  } = options;
  
  const payload = {
    username: username
  };
  
  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }
  
  if (content) {
    payload.content = content;
  }
  
  if (embeds.length > 0) {
    payload.embeds = embeds;
  }
  
  return payload;
};

/**
 * Check if we're currently rate limited.
 * 
 * @returns {boolean} True if rate limited
 */
export const isRateLimited = () => {
  if (!rateLimitState.isRateLimited) {
    return false;
  }
  
  // Check if rate limit has expired
  if (Date.now() >= rateLimitState.retryTimestamp) {
    rateLimitState.isRateLimited = false;
    return false;
  }
  
  return true;
};

/**
 * Get the time until rate limit expires.
 * 
 * @returns {number} Milliseconds until rate limit expires (0 if not limited)
 */
export const getRateLimitWait = () => {
  if (!isRateLimited()) {
    return 0;
  }
  return Math.max(0, rateLimitState.retryTimestamp - Date.now());
};

/**
 * Wait for rate limit to expire.
 * 
 * @param {boolean} [debug=false] - Enable debug logging
 * @returns {Promise<void>}
 */
const waitForRateLimit = async (debug = false) => {
  const waitTime = getRateLimitWait();
  if (waitTime > 0) {
    debugLog(`Rate limited, waiting ${waitTime}ms`, debug);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
};

/**
 * Send a webhook message to Discord.
 * Handles rate limiting and retries automatically.
 * 
 * @param {string} url - Webhook URL
 * @param {object} payload - Webhook payload (Discord format)
 * @param {object} [options={}] - Send options
 * @param {number} [options.retryCount=0] - Current retry attempt
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @param {number} [options.timeout=10000] - Request timeout in ms
 * @returns {Promise<{ success: boolean, error?: string, statusCode?: number }>}
 */
export const sendWebhookRequest = async (url, payload, options = {}) => {
  const {
    retryCount = 0,
    debugLog: debug = false,
    timeout = 10000
  } = options;
  
  try {
    // Validate URL
    const validation = validateWebhookUrl(url);
    if (!validation.valid) {
      debugLog(`Invalid webhook URL: ${validation.reason}`, debug);
      return { success: false, error: validation.reason };
    }
    
    // Wait for rate limit if necessary
    await waitForRateLimit(debug);
    
    debugLog(`Sending webhook request (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`, debug);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retryMs = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : DEFAULT_RETRY_DELAY_MS;
        
        rateLimitState.isRateLimited = true;
        rateLimitState.retryAfter = retryMs;
        rateLimitState.retryTimestamp = Date.now() + retryMs;
        
        debugLog(`Rate limited (429), retry after ${retryMs}ms`, debug);
        
        // Retry if we haven't exceeded max retries
        if (retryCount < MAX_RETRIES) {
          await waitForRateLimit(debug);
          return sendWebhookRequest(url, payload, {
            ...options,
            retryCount: retryCount + 1
          });
        }
        
        return { 
          success: false, 
          error: 'Rate limited, max retries exceeded',
          statusCode: 429
        };
      }
      
      // Success cases
      if (response.status === 204 || response.status === 200) {
        debugLog('Webhook sent successfully', debug);
        return { success: true, statusCode: response.status };
      }
      
      // Other error cases
      const errorBody = await response.text().catch(() => 'Unknown error');
      debugLog(`Webhook failed: ${response.status} - ${errorBody}`, debug);
      
      // Retry on 5xx errors
      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        debugLog(`Server error (${response.status}), retrying...`, debug);
        await new Promise(resolve => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS));
        return sendWebhookRequest(url, payload, {
          ...options,
          retryCount: retryCount + 1
        });
      }
      
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${errorBody}`,
        statusCode: response.status
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    // Handle timeout/abort
    if (error.name === 'AbortError') {
      debugLog(`Webhook request timed out after ${timeout}ms`, debug);
      
      // Retry on timeout
      if (retryCount < MAX_RETRIES) {
        return sendWebhookRequest(url, payload, {
          ...options,
          retryCount: retryCount + 1
        });
      }
      
      return { success: false, error: 'Request timed out' };
    }
    
    debugLog(`Webhook exception: ${error.message}`, debug);
    return { success: false, error: error.message };
  }
};

// ========================================
// QUEUE FUNCTIONS
// ========================================

/**
 * Add a message to the webhook queue.
 * 
 * @param {object} item - Queue item
 * @param {string} item.url - Webhook URL
 * @param {object} item.payload - Webhook payload
 * @param {object} [item.options] - Send options
 * @returns {boolean} True if added, false if queue is full
 */
export const enqueueWebhook = (item) => {
  if (webhookQueue.length >= MAX_QUEUE_SIZE) {
    // Remove oldest item to make room
    webhookQueue.shift();
  }
  
  webhookQueue.push({
    ...item,
    queuedAt: Date.now()
  });
  
  // Start processing if not already running
  if (!isProcessingQueue) {
    processQueue();
  }
  
  return true;
};

/**
 * Process the webhook queue.
 * Sends queued messages one at a time, respecting rate limits.
 * 
 * @returns {Promise<void>}
 */
const processQueue = async () => {
  if (isProcessingQueue || webhookQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (webhookQueue.length > 0) {
    const item = webhookQueue.shift();
    
    if (!item) continue;
    
    await sendWebhookRequest(item.url, item.payload, item.options);
    
    // Small delay between messages to avoid hitting rate limits
    if (webhookQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  
  isProcessingQueue = false;
};

/**
 * Get the current queue size.
 * 
 * @returns {number} Number of items in queue
 */
export const getQueueSize = () => webhookQueue.length;

/**
 * Clear the webhook queue.
 * 
 * @returns {number} Number of items cleared
 */
export const clearQueue = () => {
  const count = webhookQueue.length;
  webhookQueue.length = 0;
  return count;
};

// ========================================
// HIGH-LEVEL API
// ========================================

/**
 * Send a webhook notification.
 * This is the main function for sending notifications via webhook.
 * Uses the queue for reliability and handles formatting automatically.
 * 
 * @param {string} url - Webhook URL
 * @param {object} notification - Notification details
 * @param {string} notification.eventType - Event type (idle, permission, error, question)
 * @param {string} notification.title - Notification title
 * @param {string} notification.message - Notification message
 * @param {string} [notification.projectName] - Project name
 * @param {string} [notification.sessionId] - Session ID
 * @param {number} [notification.count] - Count for batched notifications
 * @param {object} [options={}] - Additional options
 * @param {string} [options.username] - Webhook username
 * @param {boolean} [options.mention=false] - Whether to mention @everyone
 * @param {boolean} [options.useQueue=true] - Whether to use the queue
 * @param {boolean} [options.debugLog=false] - Enable debug logging
 * @returns {Promise<{ success: boolean, error?: string, queued?: boolean }>}
 */
export const sendWebhookNotification = async (url, notification, options = {}) => {
  const {
    username = 'OpenCode Notify',
    mention = false,
    useQueue = true,
    debugLog: debug = false
  } = options;
  
  try {
    // Build embed
    const embed = buildDiscordEmbed(notification);
    
    // Build payload
    const payload = buildWebhookPayload({
      username: username,
      content: mention ? '@everyone' : undefined,
      embeds: [embed]
    });
    
    debugLog(`Preparing webhook: ${notification.eventType} - ${notification.title}`, debug);
    
    // Use queue or send directly
    if (useQueue) {
      enqueueWebhook({
        url: url,
        payload: payload,
        options: { debugLog: debug }
      });
      
      debugLog('Webhook queued for delivery', debug);
      return { success: true, queued: true };
    } else {
      return await sendWebhookRequest(url, payload, { debugLog: debug });
    }
  } catch (error) {
    debugLog(`Webhook notification error: ${error.message}`, debug);
    return { success: false, error: error.message };
  }
};

/**
 * Send an idle notification webhook.
 * Pre-configured for task completion notifications.
 * 
 * @param {string} url - Webhook URL
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @returns {Promise<{ success: boolean, error?: string, queued?: boolean }>}
 */
export const notifyWebhookIdle = async (url, message, options = {}) => {
  return sendWebhookNotification(url, {
    eventType: 'idle',
    title: options.projectName 
      ? `${options.projectName} - Task Complete`
      : 'Task Complete',
    message: message,
    projectName: options.projectName,
    sessionId: options.sessionId
  }, options);
};

/**
 * Send a permission notification webhook.
 * Pre-configured for permission request notifications.
 * 
 * @param {string} url - Webhook URL
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @returns {Promise<{ success: boolean, error?: string, queued?: boolean }>}
 */
export const notifyWebhookPermission = async (url, message, options = {}) => {
  return sendWebhookNotification(url, {
    eventType: 'permission',
    title: options.count > 1 
      ? `${options.count} Permissions Required`
      : 'Permission Required',
    message: message,
    projectName: options.projectName,
    sessionId: options.sessionId,
    count: options.count
  }, {
    ...options,
    mention: options.mention !== undefined ? options.mention : true // Default to mention for permissions
  });
};

/**
 * Send an error notification webhook.
 * Pre-configured for error notifications.
 * 
 * @param {string} url - Webhook URL
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @returns {Promise<{ success: boolean, error?: string, queued?: boolean }>}
 */
export const notifyWebhookError = async (url, message, options = {}) => {
  return sendWebhookNotification(url, {
    eventType: 'error',
    title: options.projectName 
      ? `${options.projectName} - Error`
      : 'Agent Error',
    message: message,
    projectName: options.projectName,
    sessionId: options.sessionId
  }, {
    ...options,
    mention: options.mention !== undefined ? options.mention : true // Default to mention for errors
  });
};

/**
 * Send a question notification webhook.
 * Pre-configured for question notifications.
 * 
 * @param {string} url - Webhook URL
 * @param {string} message - Notification message
 * @param {object} [options={}] - Additional options
 * @returns {Promise<{ success: boolean, error?: string, queued?: boolean }>}
 */
export const notifyWebhookQuestion = async (url, message, options = {}) => {
  return sendWebhookNotification(url, {
    eventType: 'question',
    title: options.count > 1 
      ? `${options.count} Questions Need Your Input`
      : 'Question',
    message: message,
    projectName: options.projectName,
    sessionId: options.sessionId,
    count: options.count
  }, options);
};

// ========================================
// TESTING UTILITIES
// ========================================

/**
 * Reset rate limit state.
 * Used for testing.
 */
export const resetRateLimitState = () => {
  rateLimitState.isRateLimited = false;
  rateLimitState.retryAfter = 0;
  rateLimitState.retryTimestamp = 0;
};

/**
 * Get rate limit state.
 * Used for testing and debugging.
 * 
 * @returns {object} Current rate limit state
 */
export const getRateLimitState = () => ({ ...rateLimitState });

// Default export for convenience
export default {
  // Core functions
  sendWebhookRequest,
  sendWebhookNotification,
  validateWebhookUrl,
  buildDiscordEmbed,
  buildWebhookPayload,
  
  // Rate limiting
  isRateLimited,
  getRateLimitWait,
  resetRateLimitState,
  getRateLimitState,
  
  // Queue functions
  enqueueWebhook,
  getQueueSize,
  clearQueue,
  
  // High-level helpers
  notifyWebhookIdle,
  notifyWebhookPermission,
  notifyWebhookError,
  notifyWebhookQuestion,
  
  // Constants
  EMBED_COLORS
};
