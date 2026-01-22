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

/**
 * Debug logging to file (no console output).
 * Logs are written to ~/.config/opencode/logs/smart-voice-notify-debug.log
 * @param {string} message - Message to log
 * @param {object} config - Config object with debugLog flag
 */
const debugLog = (message, config) => {
  if (!config?.debugLog) return;
  try {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const logsDir = path.join(configDir, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, 'smart-voice-notify-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] [ai-messages] ${message}\n`);
  } catch (e) {
    // Silently fail - logging should never break the plugin
  }
};

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
  
  debugLog(`generateAIMessage: starting for promptType="${promptType}"`, config);
  
  // Get the prompt for this type
  let prompt = config.aiPrompts?.[promptType];
  if (!prompt) {
    debugLog(`generateAIMessage: no prompt found for type "${promptType}"`, config);
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
    debugLog(`generateAIMessage: injected count context (count=${context.count}, type=${context.type})`, config);
  }
  
  // Inject session/project context if context-aware AI is enabled
  if (config.enableContextAwareAI) {
    debugLog(`generateAIMessage: context-aware AI is ENABLED`, config);
    const contextParts = [];
    
    if (context.projectName) {
      contextParts.push(`Project: "${context.projectName}"`);
      debugLog(`generateAIMessage: context includes projectName="${context.projectName}"`, config);
    }
    
    if (context.sessionTitle) {
      contextParts.push(`Task: "${context.sessionTitle}"`);
      debugLog(`generateAIMessage: context includes sessionTitle="${context.sessionTitle}"`, config);
    }
    
    if (context.sessionSummary) {
      const { files, additions, deletions } = context.sessionSummary;
      if (files !== undefined || additions !== undefined || deletions !== undefined) {
        const summaryParts = [];
        if (files !== undefined) summaryParts.push(`${files} file(s) modified`);
        if (additions !== undefined) summaryParts.push(`+${additions} lines`);
        if (deletions !== undefined) summaryParts.push(`-${deletions} lines`);
        contextParts.push(`Changes: ${summaryParts.join(', ')}`);
        debugLog(`generateAIMessage: context includes sessionSummary (files=${files}, additions=${additions}, deletions=${deletions})`, config);
      }
    }
    
    if (contextParts.length > 0) {
      prompt = `${prompt}\n\nContext for this notification:\n${contextParts.join('\n')}\n\nIncorporate relevant context into your message to make it more specific and helpful (e.g., mention the project name or what was worked on).`;
      debugLog(`generateAIMessage: injected ${contextParts.length} context part(s) into prompt`, config);
    } else {
      debugLog(`generateAIMessage: no context available to inject (projectName, sessionTitle, sessionSummary all empty)`, config);
    }
  } else {
    debugLog(`generateAIMessage: context-aware AI is DISABLED (enableContextAwareAI=${config.enableContextAwareAI})`, config);
  }
  
  try {
    // Build headers
    const headers = { 'Content-Type': 'application/json' };
    if (config.aiApiKey) {
      headers['Authorization'] = `Bearer ${config.aiApiKey}`;
    }
    
    // Build endpoint URL (ensure it ends with /chat/completions)
    let endpoint = config.aiEndpoint || 'http://localhost:11434/v1';
    if (!endpoint.endsWith('/chat/completions')) {
      endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
    }
    
    debugLog(`generateAIMessage: sending request to ${endpoint} (model=${config.aiModel || 'llama3'})`, config);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.aiTimeout || 15000);
    
    // Make the request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.aiModel || 'llama3',
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
    
    if (!response.ok) {
      debugLog(`generateAIMessage: API request failed with status ${response.status}`, config);
      return null;
    }
    
    const data = await response.json();
    
    // Extract the message content
    const message = data.choices?.[0]?.message?.content?.trim();
    
    if (!message) {
      debugLog(`generateAIMessage: API returned no message content`, config);
      return null;
    }
    
    // Clean up the message (remove quotes if AI added them)
    let cleanMessage = message.replace(/^["']|["']$/g, '').trim();
    
    // Validate message length (sanity check)
    if (cleanMessage.length < 5 || cleanMessage.length > 200) {
      debugLog(`generateAIMessage: message length invalid (${cleanMessage.length} chars), rejecting`, config);
      return null;
    }
    
    debugLog(`generateAIMessage: SUCCESS - generated message: "${cleanMessage.substring(0, 50)}${cleanMessage.length > 50 ? '...' : ''}"`, config);
    return cleanMessage;
    
  } catch (error) {
    debugLog(`generateAIMessage: ERROR - ${error.name === 'AbortError' ? 'Request timed out' : error.message}`, config);
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
    try {
      const aiMessage = await generateAIMessage(promptType, context);
      if (aiMessage) {
        return aiMessage;
      }
    } catch (error) {
      // Silently fall through to fallback
    }
    
    // Check if fallback is disabled
    if (!config.aiFallbackToStatic) {
      // Return a generic message if fallback disabled and AI failed
      return 'Notification: Please check your screen.';
    }
  }
  
  // Fallback to static messages
  if (!Array.isArray(staticMessages) || staticMessages.length === 0) {
    return 'Notification';
  }
  
  return staticMessages[Math.floor(Math.random() * staticMessages.length)];
}

/**
 * Test connectivity to the AI endpoint
 * @returns {Promise<{success: boolean, message: string, model?: string}>}
 */
export async function testAIConnection() {
  const config = getTTSConfig();
  
  if (!config.enableAIMessages) {
    return { success: false, message: 'AI messages not enabled' };
  }
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.aiApiKey) {
      headers['Authorization'] = `Bearer ${config.aiApiKey}`;
    }
    
    // Try to list models (simpler endpoint to test connectivity)
    let endpoint = config.aiEndpoint || 'http://localhost:11434/v1';
    endpoint = endpoint.replace(/\/$/, '') + '/models';
    
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
      return {
        success: true,
        message: `Connected! Available models: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`,
        models
      };
    } else {
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
    
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, message: 'Connection timed out' };
    }
    return { success: false, message: error.message };
  }
}

export default { generateAIMessage, getSmartMessage, testAIConnection };
