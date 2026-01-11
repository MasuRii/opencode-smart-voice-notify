/**
 * AI Message Generation Module
 * 
 * Generates dynamic notification messages using OpenAI-compatible AI endpoints.
 * Supports: Ollama, LM Studio, LocalAI, vLLM, llama.cpp, Jan.ai, etc.
 * 
 * Uses native fetch() - no external dependencies required.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getTTSConfig } from './tts.js';

// ========================================
// MODULE-LEVEL STATE FOR AI FAILURE TRACKING
// Used for one-time toast notification when AI fails
// ========================================
let aiHasFailedThisSession = false;
let lastAIFailureReason = '';

/**
 * Get the debug log file path
 */
const getLogFile = () => {
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  return path.join(configDir, 'logs', 'smart-voice-notify-debug.log');
};

/**
 * Write debug message to log file (no console output)
 * @param {string} message - Message to log
 */
const debugLog = (message) => {
  const config = getTTSConfig();
  if (!config.debugLog) return;
  
  try {
    const logFile = getLogFile();
    const logsDir = path.dirname(logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [ai-messages] ${message}\n`);
  } catch (e) {
    // Silently fail - logging should never break the plugin
  }
};

/**
 * Get AI failure info for one-time toast display
 * @returns {{ hasFailed: boolean, reason: string }}
 */
export function getAIFailureInfo() {
  return { hasFailed: aiHasFailedThisSession, reason: lastAIFailureReason };
}

/**
 * Mark that the AI failure toast has been shown (resets the failure flag)
 */
export function markAIFailureToastShown() {
  aiHasFailedThisSession = false;
  lastAIFailureReason = '';
}

/**
 * Reset AI failure state (call on session.created)
 */
export function resetAIFailureState() {
  aiHasFailedThisSession = false;
  lastAIFailureReason = '';
}

/**
 * Generate a message using an OpenAI-compatible AI endpoint
 * @param {string} promptType - The type of prompt ('idle', 'permission', 'question', 'idleReminder', 'permissionReminder', 'questionReminder')
 * @param {object} context - Optional context about the notification (for future use)
 * @returns {Promise<string|null>} Generated message or null if failed
 */
export async function generateAIMessage(promptType, context = {}) {
  const config = getTTSConfig();
  
  // Check if AI messages are enabled
  if (!config.enableAIMessages) {
    return null;
  }
  
  debugLog(`generateAIMessage: starting - promptType=${promptType}, context=${JSON.stringify(context)}`);
  
  // Get the prompt for this type
  let prompt = config.aiPrompts?.[promptType];
  if (!prompt) {
    debugLog(`generateAIMessage: no prompt configured for type '${promptType}'`);
    return null;
  }
  
  // Inject count context if multiple items
  if (context.count && context.count > 1) {
    // Use type-specific terminology
    let itemType = 'items';
    if (context.type === 'question') {
      itemType = 'questions';
    } else if (context.type === 'permission') {
      itemType = 'permission requests';
    }
    prompt = `${prompt} Important: There are ${context.count} ${itemType} (not just one) waiting for the user's attention. Mention the count in your message.`;
  }
  
  // Build endpoint URL (ensure it ends with /chat/completions)
  let endpoint = config.aiEndpoint || 'http://localhost:11434/v1';
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
  }
  
  const model = config.aiModel || 'llama3';
  const timeoutMs = config.aiTimeout || 15000;
  
  debugLog(`generateAIMessage: request config - endpoint=${endpoint}, model=${model}, timeout=${timeoutMs}ms`);
  
  try {
    // Build headers
    const headers = { 'Content-Type': 'application/json' };
    if (config.aiApiKey) {
      headers['Authorization'] = `Bearer ${config.aiApiKey}`;
      debugLog(`generateAIMessage: using API key (length=${config.aiApiKey.length})`);
    } else {
      debugLog(`generateAIMessage: no API key configured (OK for Ollama/LM Studio)`);
    }
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    debugLog(`generateAIMessage: sending request to ${endpoint}...`);
    const startTime = Date.now();
    
    // Make the request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates short notification messages. Output only the message text, nothing else. No quotes, no explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,  // High value to accommodate thinking models (e.g., Gemini 2.5) that use internal reasoning tokens
        temperature: 0.7
      })
    });
    
    clearTimeout(timeout);
    const elapsed = Date.now() - startTime;
    
    if (!response.ok) {
      // Try to get error details from response body
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = '(could not read response body)';
      }
      
      const reason = `HTTP ${response.status} ${response.statusText}: ${errorBody.slice(0, 200)}`;
      debugLog(`generateAIMessage: HTTP error after ${elapsed}ms - ${reason}`);
      
      aiHasFailedThisSession = true;
      lastAIFailureReason = `HTTP ${response.status}: ${response.statusText}`;
      return null;
    }
    
    debugLog(`generateAIMessage: response received in ${elapsed}ms, parsing JSON...`);
    
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      const reason = `Failed to parse JSON response: ${jsonError.message}`;
      debugLog(`generateAIMessage: ${reason}`);
      aiHasFailedThisSession = true;
      lastAIFailureReason = reason;
      return null;
    }
    
    // Extract the message content
    const message = data.choices?.[0]?.message?.content?.trim();
    
    if (!message) {
      const reason = 'AI returned empty or invalid response structure';
      debugLog(`generateAIMessage: ${reason} - response: ${JSON.stringify(data).slice(0, 300)}`);
      aiHasFailedThisSession = true;
      lastAIFailureReason = reason;
      return null;
    }
    
    // Clean up the message (remove quotes if AI added them)
    let cleanMessage = message.replace(/^["']|["']$/g, '').trim();
    
    // Validate message length (sanity check)
    if (cleanMessage.length < 5 || cleanMessage.length > 200) {
      const reason = `Message length invalid: ${cleanMessage.length} chars (expected 5-200)`;
      debugLog(`generateAIMessage: ${reason} - message: "${cleanMessage.slice(0, 50)}..."`);
      aiHasFailedThisSession = true;
      lastAIFailureReason = reason;
      return null;
    }
    
    debugLog(`generateAIMessage: SUCCESS in ${elapsed}ms - "${cleanMessage}"`);
    return cleanMessage;
    
  } catch (error) {
    let reason;
    if (error.name === 'AbortError') {
      reason = `Request timeout after ${timeoutMs}ms`;
    } else if (error.code === 'ECONNREFUSED') {
      reason = `Connection refused - is AI server running at ${endpoint}?`;
    } else if (error.code === 'ENOTFOUND') {
      reason = `DNS lookup failed - hostname not found: ${config.aiEndpoint}`;
    } else if (error.code === 'ETIMEDOUT') {
      reason = `Connection timed out - network issue or firewall blocking?`;
    } else {
      reason = `${error.name || 'Error'}: ${error.message}`;
    }
    
    debugLog(`generateAIMessage: FAILED - ${reason}`);
    aiHasFailedThisSession = true;
    lastAIFailureReason = reason;
    return null;
  }
}

/**
 * Get a smart message - tries AI first, falls back to static messages
 * @param {string} eventType - 'idle', 'permission', 'question'
 * @param {boolean} isReminder - Whether this is a reminder message
 * @param {string[]} staticMessages - Array of static fallback messages
 * @param {object} context - Optional context (e.g., { count: 3 } for batched notifications)
 * @returns {Promise<string>} The message to speak
 */
export async function getSmartMessage(eventType, isReminder, staticMessages, context = {}) {
  const config = getTTSConfig();
  
  // Determine the prompt type
  const promptType = isReminder ? `${eventType}Reminder` : eventType;
  
  // Try AI generation if enabled
  if (config.enableAIMessages) {
    debugLog(`getSmartMessage: AI enabled, attempting generation for '${promptType}'`);
    
    try {
      const aiMessage = await generateAIMessage(promptType, context);
      if (aiMessage) {
        debugLog(`getSmartMessage: using AI-generated message`);
        return aiMessage;
      }
      debugLog(`getSmartMessage: AI returned null, falling back to static`);
    } catch (error) {
      debugLog(`getSmartMessage: AI threw error: ${error.message}, falling back to static`);
    }
    
    // Check if fallback is disabled
    if (!config.aiFallbackToStatic) {
      debugLog(`getSmartMessage: fallback disabled, returning generic message`);
      // Return a generic message if fallback disabled and AI failed
      return 'Notification: Please check your screen.';
    }
  }
  
  // Fallback to static messages
  if (!Array.isArray(staticMessages) || staticMessages.length === 0) {
    debugLog(`getSmartMessage: no static messages available, returning 'Notification'`);
    return 'Notification';
  }
  
  const staticMessage = staticMessages[Math.floor(Math.random() * staticMessages.length)];
  debugLog(`getSmartMessage: using static message`);
  return staticMessage;
}

/**
 * Test connectivity to the AI endpoint
 * @returns {Promise<{success: boolean, message: string, model?: string}>}
 */
export async function testAIConnection() {
  const config = getTTSConfig();
  
  if (!config.enableAIMessages) {
    debugLog('testAIConnection: AI messages not enabled');
    return { success: false, message: 'AI messages not enabled' };
  }
  
  debugLog('testAIConnection: testing connection...');
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.aiApiKey) {
      headers['Authorization'] = `Bearer ${config.aiApiKey}`;
    }
    
    // Try to list models (simpler endpoint to test connectivity)
    let endpoint = config.aiEndpoint || 'http://localhost:11434/v1';
    endpoint = endpoint.replace(/\/$/, '') + '/models';
    
    debugLog(`testAIConnection: fetching ${endpoint}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      const models = data.data?.map(m => m.id) || [];
      debugLog(`testAIConnection: success - ${models.length} models found`);
      return {
        success: true,
        message: `Connected! Available models: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`,
        models
      };
    } else {
      const errorText = await response.text().catch(() => 'unknown');
      debugLog(`testAIConnection: HTTP error ${response.status} - ${errorText.slice(0, 100)}`);
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
    
  } catch (error) {
    if (error.name === 'AbortError') {
      debugLog('testAIConnection: connection timed out');
      return { success: false, message: 'Connection timed out' };
    }
    debugLog(`testAIConnection: error - ${error.message}`);
    return { success: false, message: error.message };
  }
}

export default { generateAIMessage, getSmartMessage, testAIConnection, getAIFailureInfo, markAIFailureToastShown, resetAIFailureState };
