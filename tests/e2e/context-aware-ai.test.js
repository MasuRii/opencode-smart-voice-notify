import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import SmartVoiceNotifyPlugin from '../../index.js';
import { generateAIMessage } from '../../util/ai-messages.js';
import { 
  createTestTempDir, 
  cleanupTestTempDir, 
  createTestConfig, 
  createMinimalConfig,
  createTestAssets,
  createMockShellRunner,
  createMockClient,
  createTestLogsDir,
  readTestFile,
  mockEvents,
  wait
} from '../setup.js';

/**
 * E2E Tests for Context-Aware AI Feature (Issue #9)
 * 
 * Tests the enableContextAwareAI configuration option which allows
 * AI-generated notifications to include project name, task title,
 * and change summary context.
 */
describe('Context-Aware AI Feature (Issue #9)', () => {
  let mockClient;
  let mockShell;
  let tempDir;
  let capturedPrompts = [];
  
  /**
   * Creates a mock AI server that captures prompts sent to it
   */
  const createMockAIServer = () => {
    // We'll use fetch mocking via Bun's mock capabilities
    const originalFetch = global.fetch;
    
    global.fetch = async (url, options) => {
      if (url.includes('/chat/completions')) {
        const body = JSON.parse(options.body);
        const userMessage = body.messages.find(m => m.role === 'user');
        
        capturedPrompts.push({
          url,
          model: body.model,
          prompt: userMessage?.content || '',
          timestamp: Date.now()
        });
        
        // Return a mock successful response
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: 'Test AI generated message for your project!'
              }
            }]
          })
        };
      }
      
      // For non-AI requests, use original fetch
      return originalFetch(url, options);
    };
    
    return () => {
      global.fetch = originalFetch;
    };
  };
  
  beforeEach(() => {
    tempDir = createTestTempDir();
    createTestAssets();
    createTestLogsDir();
    mockClient = createMockClient();
    mockShell = createMockShellRunner();
    capturedPrompts = [];
  });
  
  afterEach(() => {
    cleanupTestTempDir();
  });

  describe('Configuration', () => {
    test('enableContextAwareAI should default to false', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        aiEndpoint: 'http://localhost:11434/v1',
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        await generateAIMessage('idle', {
          projectName: 'TestProject',
          sessionTitle: 'Fix bug in login'
        });
        
        // With default config (enableContextAwareAI: false), context should NOT be injected
        if (capturedPrompts.length > 0) {
          const prompt = capturedPrompts[0].prompt;
          expect(prompt).not.toContain('Context for this notification');
          expect(prompt).not.toContain('Project: "TestProject"');
          expect(prompt).not.toContain('Task: "Fix bug in login"');
        }
      } finally {
        restoreFetch();
      }
    });

    test('should inject context when enableContextAwareAI is true', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Generate a task completion message.'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        await generateAIMessage('idle', {
          projectName: 'MyAwesomeProject',
          sessionTitle: 'Implement user authentication'
        });
        
        expect(capturedPrompts.length).toBe(1);
        const prompt = capturedPrompts[0].prompt;
        
        // Should contain the context section
        expect(prompt).toContain('Context for this notification');
        expect(prompt).toContain('Project: "MyAwesomeProject"');
        expect(prompt).toContain('Task: "Implement user authentication"');
      } finally {
        restoreFetch();
      }
    });

    test('should include session summary when available', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Generate a completion message.'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        await generateAIMessage('idle', {
          projectName: 'CodeRefactor',
          sessionTitle: 'Refactor database layer',
          sessionSummary: {
            files: 5,
            additions: 120,
            deletions: 45
          }
        });
        
        expect(capturedPrompts.length).toBe(1);
        const prompt = capturedPrompts[0].prompt;
        
        expect(prompt).toContain('Project: "CodeRefactor"');
        expect(prompt).toContain('Task: "Refactor database layer"');
        expect(prompt).toContain('Changes:');
        expect(prompt).toContain('5 file(s) modified');
        expect(prompt).toContain('+120 lines');
        expect(prompt).toContain('-45 lines');
      } finally {
        restoreFetch();
      }
    });
  });

  describe('Debug Logging', () => {
    test('should log context-aware AI status to debug file', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Test prompt'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        await generateAIMessage('idle', {
          projectName: 'DebugTestProject'
        });
        
        // Wait a bit for async file write
        await wait(100);
        
        // Read the debug log
        const logContent = readTestFile('logs/smart-voice-notify-debug.log');
        
        expect(logContent).not.toBeNull();
        expect(logContent).toContain('[ai-messages]');
        expect(logContent).toContain('context-aware AI is ENABLED');
        expect(logContent).toContain('projectName="DebugTestProject"');
      } finally {
        restoreFetch();
      }
    });

    test('should log when context-aware AI is disabled', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: false,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Test prompt'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        await generateAIMessage('idle', {
          projectName: 'ShouldNotAppear'
        });
        
        await wait(100);
        
        const logContent = readTestFile('logs/smart-voice-notify-debug.log');
        
        expect(logContent).not.toBeNull();
        expect(logContent).toContain('[ai-messages]');
        expect(logContent).toContain('context-aware AI is DISABLED');
      } finally {
        restoreFetch();
      }
    });
  });

  describe('Plugin Integration', () => {
    test('should pass session context to AI on session.idle event', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        notificationMode: 'tts-first',
        enableTTS: true,
        enableSound: true,
        ttsEngine: 'sapi',
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Generate completion notification.'
        },
        debugLog: true
      }));
      
      // Set up mock session with title and summary
      mockClient.session.setMockSession('session-with-context', {
        id: 'session-with-context',
        title: 'Add dark mode feature',
        summary: {
          files: 3,
          additions: 89,
          deletions: 12
        }
      });
      
      const restoreFetch = createMockAIServer();
      
      try {
        // SDK Project type has worktree, not name - plugin derives name from path.basename(worktree)
        const plugin = await SmartVoiceNotifyPlugin({
          project: { id: 'proj-1', worktree: '/path/to/DarkModeProject' },
          worktree: '/path/to/DarkModeProject',
          client: mockClient,
          $: mockShell
        });
        
        const event = mockEvents.sessionIdle('session-with-context');
        await plugin.event({ event });
        
        // Wait for async operations
        await wait(200);
        
        // The AI should have been called with context
        expect(capturedPrompts.length).toBeGreaterThan(0);
        
        // Find the prompt that was sent (should contain our context)
        // Project name is derived from worktree path: /path/to/DarkModeProject -> DarkModeProject
        const hasContextPrompt = capturedPrompts.some(p => 
          p.prompt.includes('Project: "DarkModeProject"') ||
          p.prompt.includes('Task: "Add dark mode feature"')
        );
        
        expect(hasContextPrompt).toBe(true);
      } finally {
        restoreFetch();
      }
    });

    test('should NOT include context when enableContextAwareAI is false', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: false, // Explicitly disabled
        notificationMode: 'tts-first',
        enableTTS: true,
        enableSound: true,
        ttsEngine: 'sapi',
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Generate completion notification.'
        },
        debugLog: true
      }));
      
      mockClient.session.setMockSession('session-no-context', {
        id: 'session-no-context',
        title: 'Should not appear',
        summary: {
          files: 10,
          additions: 500,
          deletions: 200
        }
      });
      
      const restoreFetch = createMockAIServer();
      
      try {
        // SDK Project type has worktree, not name - plugin derives name from path.basename(worktree)
        const plugin = await SmartVoiceNotifyPlugin({
          project: { id: 'proj-2', worktree: '/path/to/HiddenProject' },
          worktree: '/path/to/HiddenProject',
          client: mockClient,
          $: mockShell
        });
        
        const event = mockEvents.sessionIdle('session-no-context');
        await plugin.event({ event });
        
        await wait(200);
        
        // Prompts should NOT contain context
        const hasContextPrompt = capturedPrompts.some(p => 
          p.prompt.includes('Context for this notification') ||
          p.prompt.includes('Project: "HiddenProject"')
        );
        
        expect(hasContextPrompt).toBe(false);
      } finally {
        restoreFetch();
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle missing session data gracefully', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Test prompt'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        // Call with empty context
        const message = await generateAIMessage('idle', {});
        
        // Should still work (return a message)
        expect(message).not.toBeNull();
        
        // Prompt should not crash, just have no context to inject
        expect(capturedPrompts.length).toBe(1);
        
        // Log should mention no context available
        await wait(100);
        const logContent = readTestFile('logs/smart-voice-notify-debug.log');
        expect(logContent).toContain('no context available to inject');
      } finally {
        restoreFetch();
      }
    });

    test('should handle partial session summary', async () => {
      createTestConfig(createMinimalConfig({ 
        enabled: true,
        enableAIMessages: true,
        enableContextAwareAI: true,
        aiEndpoint: 'http://localhost:11434/v1',
        aiPrompts: {
          idle: 'Test prompt'
        },
        debugLog: true
      }));
      
      const restoreFetch = createMockAIServer();
      
      try {
        // Only files count, no additions/deletions
        await generateAIMessage('idle', {
          projectName: 'PartialProject',
          sessionSummary: {
            files: 2
            // additions and deletions undefined
          }
        });
        
        expect(capturedPrompts.length).toBe(1);
        const prompt = capturedPrompts[0].prompt;
        
        expect(prompt).toContain('2 file(s) modified');
        // Should not contain undefined values
        expect(prompt).not.toContain('undefined');
      } finally {
        restoreFetch();
      }
    });
  });
});
