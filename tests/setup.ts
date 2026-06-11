import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ConsoleCapture,
  ConsoleCaptureStore,
  ConsoleMethod,
  MockClient,
  MockSession,
  MockShellResult,
  MockShellRunner,
  ShellCallRecord,
  ToastBody,
  ToastCall,
} from '../src/types/testing.js';
import type { PluginEvent, ShellResult } from '../src/types/opencode-sdk.js';

const TEST_TEMP_BASE = path.join(os.tmpdir(), 'opencode-smart-voice-notify-tests');

let currentTestDir: string | null = null;

process.env.NODE_ENV = 'test';
process.env.SMART_VOICE_NOTIFY_DEBUG = 'false';

type GenericObject = Record<string, unknown>;

interface MockShellRunnerOptions {
  handler?: (
    command: string,
    callRecord: ShellCallRecord,
  ) =>
    | ShellResult
    | Partial<ShellResult>
    | Buffer
    | null
    | undefined
    | Promise<ShellResult | Partial<ShellResult> | Buffer | null | undefined>;
}

const getDefaultShellResult = (): ShellResult => ({
  stdout: Buffer.from(''),
  stderr: Buffer.from(''),
  exitCode: 0,
  text: () => '',
  toString: () => '',
});

export function createTestTempDir(): string {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const tempDir = path.join(TEST_TEMP_BASE, uniqueId);

  fs.mkdirSync(tempDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  currentTestDir = tempDir;

  return tempDir;
}

export function cleanupTestTempDir(): void {
  if (currentTestDir && fs.existsSync(currentTestDir)) {
    try {
      fs.rmSync(currentTestDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    currentTestDir = null;
  }

  delete process.env.OPENCODE_CONFIG_DIR;
}

export function getTestTempDir(): string {
  if (!currentTestDir) {
    return createTestTempDir();
  }
  return currentTestDir;
}

export function createTestConfig(config: GenericObject, filename = 'smart-voice-notify.jsonc'): string {
  const tempDir = getTestTempDir();
  const configPath = path.join(tempDir, filename);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return configPath;
}

export function createMinimalConfig<TOverrides extends GenericObject>(
  overrides: TOverrides = {} as TOverrides,
):
  {
    _configVersion: string;
    enabled: boolean;
    notificationMode: 'sound-first';
    enableTTS: boolean;
    enableTTSReminder: boolean;
    enableSound: boolean;
    enableToast: boolean;
    enableAIMessages: boolean;
    debugLog: boolean;
  } & TOverrides {
  return {
    _configVersion: '1.0.0',
    enabled: true,
    notificationMode: 'sound-first',
    enableTTS: false,
    enableTTSReminder: false,
    enableSound: false,
    enableToast: false,
    enableAIMessages: false,
    debugLog: false,
    ...overrides,
  };
}

export function createTestAssets(): string {
  const tempDir = getTestTempDir();
  const assetsDir = path.join(tempDir, 'assets');

  fs.mkdirSync(assetsDir, { recursive: true });

  const minimalMp3 = Buffer.from([
    0xff, 0xfb, 0x90, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);

  const soundFiles = [
    'Soft-high-tech-notification-sound-effect.mp3',
    'Machine-alert-beep-sound-effect.mp3',
    'test-sound.mp3',
  ];

  for (const file of soundFiles) {
    fs.writeFileSync(path.join(assetsDir, file), minimalMp3);
  }

  return assetsDir;
}

export function createTestLogsDir(): string {
  const tempDir = getTestTempDir();
  const logsDir = path.join(tempDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

export function readTestFile(relativePath: string): string | null {
  const tempDir = getTestTempDir();
  const filePath = path.join(tempDir, relativePath);

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function testFileExists(relativePath: string): boolean {
  const tempDir = getTestTempDir();
  const filePath = path.join(tempDir, relativePath);
  return fs.existsSync(filePath);
}

export function createMockShellRunner(options: MockShellRunnerOptions = {}): MockShellRunner {
  const calls: ShellCallRecord[] = [];

  const mockRunner = ((strings: TemplateStringsArray, ...values: Array<unknown>) => {
    let command = strings[0] ?? '';
    for (let index = 0; index < values.length; index += 1) {
      command += String(values[index]) + (strings[index + 1] ?? '');
    }

    const callRecord: ShellCallRecord = {
      command: command.trim(),
      timestamp: Date.now(),
    };
    calls.push(callRecord);

    const promise = (async (): Promise<ShellResult> => {
      if (options.handler) {
        const handlerResult = await options.handler(callRecord.command, callRecord);
        if (handlerResult && typeof handlerResult === 'object' && !Buffer.isBuffer(handlerResult)) {
          return {
            ...getDefaultShellResult(),
            ...(handlerResult as Partial<ShellResult>),
          };
        }
      }

      return getDefaultShellResult();
    })();

    const mockPromise = promise as MockShellResult;
    mockPromise.quiet = () => mockPromise;
    mockPromise.nothrow = () => mockPromise;
    mockPromise.timeout = () => mockPromise;

    return mockPromise;
  }) as MockShellRunner;

  mockRunner.getCalls = () => [...calls];
  mockRunner.getLastCall = () => calls[calls.length - 1];
  mockRunner.getCallCount = () => calls.length;
  mockRunner.reset = () => {
    calls.length = 0;
  };
  mockRunner.wasCalledWith = (pattern: string | RegExp) =>
    calls.some((record) =>
      typeof pattern === 'string' ? record.command.includes(pattern) : pattern.test(record.command),
    );

  return mockRunner;
}

export function createMockClient(): MockClient {
  const toastCalls: ToastCall[] = [];
  const sessionData = new Map<string, MockSession>();

  const client: MockClient = {
    tui: {
      showToast: async ({ body }: { body: ToastBody & { title?: string } }) => {
        toastCalls.push({
          message: body.message,
          variant: body.variant,
          duration: body.duration,
          timestamp: Date.now(),
        });
        return { success: true };
      },
      getToastCalls: () => [...toastCalls],
      resetToastCalls: () => {
        toastCalls.length = 0;
      },
    },

    session: {
      get: async ({ path: { id } }: { path: { id: string } }) => {
        const session =
          sessionData.get(id) ??
          ({
            id,
            parentID: null,
            status: 'idle',
          } as MockSession);
        return { data: session };
      },
      setMockSession: (id: string, data: Partial<MockSession>) => {
        sessionData.set(id, { id, ...data });
      },
      clearMockSessions: () => {
        sessionData.clear();
      },
    },

    app: {
      log: async (_input: unknown) => ({ success: true }),
    },

    permission: {
      reply: async (_input: unknown) => ({ success: true }),
    },

    question: {
      reply: async (_input: unknown) => ({ success: true }),
      reject: async (_input: unknown) => ({ success: true }),
    },
  };

  return client;
}

export function createMockEvent(type: PluginEvent['type'], properties: GenericObject = {}): PluginEvent {
  const sessionIdFromProperties = properties.sessionID;
  const sessionID =
    typeof sessionIdFromProperties === 'string'
      ? sessionIdFromProperties
      : `test-session-${Date.now()}`;

  return {
    type,
    properties: {
      sessionID,
      ...properties,
    },
  };
}

export const mockEvents = {
  sessionIdle: (sessionID?: string): PluginEvent => createMockEvent('session.idle', { sessionID }),

  sessionError: (sessionID?: string): PluginEvent => createMockEvent('session.error', { sessionID }),

  sessionCreated: (sessionID?: string): PluginEvent =>
    createMockEvent('session.created', {
      sessionID,
      info: { id: sessionID },
    }),

  permissionAsked: (id?: string, sessionID?: string): PluginEvent =>
    createMockEvent('permission.asked', {
      id: id ?? `perm-${Date.now()}`,
      sessionID,
    }),

  permissionReplied: (requestID: string, reply = 'once'): PluginEvent =>
    createMockEvent('permission.replied', {
      requestID,
      reply,
    }),

  questionAsked: (
    id?: string,
    sessionID?: string,
    questions: Array<Record<string, unknown>> = [{ text: 'Test question?' }],
  ): PluginEvent =>
    createMockEvent('question.asked', {
      id: id ?? `q-${Date.now()}`,
      sessionID,
      questions,
    }),

  questionReplied: (requestID: string, answers: Array<Array<string>> = [['answer']]): PluginEvent =>
    createMockEvent('question.replied', {
      requestID,
      answers,
    }),

  questionRejected: (requestID: string): PluginEvent =>
    createMockEvent('question.rejected', {
      requestID,
    }),

  messageUpdated: (messageId?: string, role = 'user', sessionID?: string): PluginEvent =>
    createMockEvent('message.updated', {
      sessionID,
      info: {
        id: messageId ?? `msg-${Date.now()}`,
        role,
        time: { created: Date.now() / 1000 },
      },
    }),
};

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await wait(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

beforeAll(() => {
  if (!fs.existsSync(TEST_TEMP_BASE)) {
    fs.mkdirSync(TEST_TEMP_BASE, { recursive: true });
  }
});

afterAll(() => {
  try {
    const contents = fs.readdirSync(TEST_TEMP_BASE);
    if (contents.length === 0) {
      fs.rmdirSync(TEST_TEMP_BASE);
    }
  } catch {
    // Ignore cleanup errors.
  }
});

beforeEach(() => {
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  cleanupTestTempDir();
});

export function createConsoleCapture(): ConsoleCapture {
  const logs: ConsoleCaptureStore = {
    log: [],
    warn: [],
    error: [],
    info: [],
    debug: [],
  };

  const original: Record<ConsoleMethod, (...args: unknown[]) => void> = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  let capturing = false;
  const methods = Object.keys(original) as ConsoleMethod[];
  const consoleRef = console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>;
  const get = ((type?: ConsoleMethod) => (type ? logs[type] : logs)) as ConsoleCapture['get'];

  return {
    start() {
      if (capturing) {
        return;
      }
      capturing = true;

      for (const type of methods) {
        consoleRef[type] = (...args: unknown[]) => {
          logs[type].push(args);
        };
      }
    },

    stop() {
      if (!capturing) {
        return;
      }
      capturing = false;

      for (const [type, fn] of Object.entries(original) as Array<[
        ConsoleMethod,
        (...args: unknown[]) => void,
      ]>) {
        consoleRef[type] = fn;
      }
    },

    get,

    clear() {
      for (const type of methods) {
        logs[type].length = 0;
      }
    },
  };
}

export const platform = os.platform();
export const isWindows = platform === 'win32';
export const isMacOS = platform === 'darwin';
export const isLinux = platform === 'linux';

export function getTTSCalls(shell: MockShellRunner): ShellCallRecord[] {
  return shell.getCalls().filter((record) => {
    const cmd = record.command;

    if (cmd.includes('powershell.exe') && cmd.includes('-File') && cmd.includes('.ps1')) {
      return true;
    }

    if (cmd.includes('paplay') || cmd.includes('aplay') || cmd.includes('afplay')) {
      return true;
    }

    if (cmd.includes('say ')) {
      return true;
    }

    if (cmd.includes('System.Windows.Media.MediaPlayer') || cmd.includes('mciSendString')) {
      return true;
    }

    return false;
  });
}

export function getAudioCalls(shell: MockShellRunner): ShellCallRecord[] {
  return shell.getCalls().filter((record) => {
    const cmd = record.command;

    if (cmd.includes('System.Windows.Media.MediaPlayer') || cmd.includes('mciSendString')) {
      return true;
    }

    if (cmd.includes('powershell.exe') && cmd.includes('-File') && cmd.includes('.ps1')) {
      return true;
    }

    if (cmd.includes('edge-tts') && cmd.includes('--write-media')) {
      return true;
    }

    if (cmd.includes('paplay') || cmd.includes('aplay')) {
      return true;
    }

    if (cmd.includes('afplay')) {
      return true;
    }

    if (cmd.includes('say ')) {
      return true;
    }

    return false;
  });
}

export function getTestTTSEngine(): 'sapi' | 'edge' {
  return isWindows ? 'sapi' : 'edge';
}

export function wasTTSCalled(shell: MockShellRunner): boolean {
  return getTTSCalls(shell).length > 0;
}

export default {
  createTestTempDir,
  cleanupTestTempDir,
  getTestTempDir,
  createTestConfig,
  createMinimalConfig,
  createTestAssets,
  createTestLogsDir,
  readTestFile,
  testFileExists,
  createMockShellRunner,
  createMockClient,
  createMockEvent,
  mockEvents,
  wait,
  waitFor,
  createConsoleCapture,
  platform,
  isWindows,
  isMacOS,
  isLinux,
  getTTSCalls,
  getAudioCalls,
  getTestTTSEngine,
  wasTTSCalled,
};
