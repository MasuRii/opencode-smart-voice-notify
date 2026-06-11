import type { NotificationEventType } from './config.js';

export interface ShellResult {
  stdout: Buffer | Uint8Array | string;
  stderr: Buffer | Uint8Array | string;
  exitCode: number;
  text?: (encoding?: BufferEncoding) => string | Promise<string>;
  toString?: () => string;
}

export interface ShellExecution extends Promise<ShellResult> {
  quiet(): this;
  nothrow(): this;
  timeout?(milliseconds: number): this;
}

export interface ShellRunner {
  (strings: TemplateStringsArray, ...values: Array<unknown>): ShellExecution;
}

export interface Project {
  id?: string;
  worktree?: string;
  directory?: string;
  vcsDir?: string;
  vcs?: 'git' | string;
  time?: {
    created: number;
    initialized?: number;
  };
  [key: string]: unknown;
}

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface TUIToastPayload {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  title?: string;
  directory?: string;
  workspace?: string;
}

export interface TUIToastBodyPayload {
  body: TUIToastPayload;
}

export type TUIShowToastInput = TUIToastPayload | TUIToastBodyPayload;

export interface TUIClient {
  showToast(input?: TUIShowToastInput, ...args: Array<unknown>): Promise<unknown> | unknown;
  [key: string]: unknown;
}

export interface Session {
  id: string;
  slug?: string;
  projectID?: string;
  workspaceID?: string;
  directory?: string;
  path?: string;
  parentID?: string | null;
  title?: string;
  agent?: string;
  model?: {
    id?: string;
    providerID?: string;
    variant?: string;
    [key: string]: unknown;
  };
  version?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
    diffs?: Array<unknown>;
    [key: string]: unknown;
  };
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
    [key: string]: unknown;
  };
  share?: {
    url?: string;
    [key: string]: unknown;
  };
  permission?: Array<unknown>;
  revert?: {
    messageID?: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
    [key: string]: unknown;
  };
  time?: {
    created?: number;
    updated?: number;
    compacting?: number;
    archived?: number;
  };
  [key: string]: unknown;
}

export interface SessionGetV1Input {
  path: {
    id: string;
  };
  query?: {
    directory?: string;
    workspace?: string;
    [key: string]: unknown;
  };
}

export interface SessionGetV2Input {
  sessionID: string;
  directory?: string;
  workspace?: string;
}

export type SessionGetInput = SessionGetV1Input | SessionGetV2Input;
export type SessionGetResult = { data?: Session | null } | Session | null | undefined;

export interface SessionClient {
  get(input: SessionGetInput, ...args: Array<unknown>): Promise<SessionGetResult> | SessionGetResult;
  [key: string]: unknown;
}

export interface PermissionClient {
  reply?(input: {
    path?: {
      id?: string;
      sessionID?: string;
      requestID?: string;
      permissionID?: string;
    };
    body?: {
      reply?: 'once' | 'always' | 'reject' | string;
      response?: string;
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface QuestionClient {
  reply?(input: {
    path?: {
      id?: string;
      requestID?: string;
      sessionID?: string;
    };
    body?: {
      answers?: Array<Array<string>>;
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  reject?(input: {
    path?: {
      id?: string;
      requestID?: string;
      sessionID?: string;
    };
    body?: {
      [key: string]: unknown;
    };
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface AppClient {
  log?(input: {
    body?: {
      service?: string;
      level?: string;
      message?: string;
      extra?: unknown;
      [key: string]: unknown;
    };
    service?: string;
    level?: string;
    message?: string;
    extra?: unknown;
  }): Promise<unknown>;
  [key: string]: unknown;
}

export interface OpenCodeClient {
  tui?: TUIClient;
  session: SessionClient;
  permission?: PermissionClient;
  question?: QuestionClient;
  app?: AppClient;
  [key: string]: unknown;
}

export interface WorkspaceInfo {
  id: string;
  type: string;
  name: string;
  branch: string | null;
  directory: string | null;
  extra: unknown | null;
  projectID: string;
}

export type WorkspaceTarget =
  | {
      type: 'local';
      directory: string;
    }
  | {
      type: 'remote';
      url: string | URL;
      headers?: Record<string, string>;
    };

export interface WorkspaceAdapter {
  name: string;
  description: string;
  configure(config: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>;
  create(config: WorkspaceInfo, env: Record<string, string | undefined>, from?: WorkspaceInfo): Promise<void>;
  remove(config: WorkspaceInfo): Promise<void>;
  target(config: WorkspaceInfo): WorkspaceTarget | Promise<WorkspaceTarget>;
}

export interface ExperimentalWorkspaceRegistry {
  register(type: string, adapter: WorkspaceAdapter): void;
}

export interface PluginInput {
  project: Project;
  client: OpenCodeClient;
  $: ShellRunner;
  directory: string;
  worktree: string;
  serverUrl?: URL;
  experimental_workspace?: ExperimentalWorkspaceRegistry;
}

export type PluginInitParams = PluginInput;

export type EventType =
  | 'server.instance.disposed'
  | 'global.disposed'
  | 'models-dev.refreshed'
  | 'plugin.added'
  | 'catalog.model.updated'
  | 'installation.updated'
  | 'installation.update-available'
  | 'account.added'
  | 'account.removed'
  | 'account.switched'
  | 'lsp.client.diagnostics'
  | 'lsp.updated'
  | 'message.updated'
  | 'message.removed'
  | 'message.part.updated'
  | 'message.part.delta'
  | 'message.part.removed'
  | 'permission.updated'
  | 'permission.asked'
  | 'permission.v2.asked'
  | 'permission.replied'
  | 'permission.v2.replied'
  | 'question.asked'
  | 'question.v2.asked'
  | 'question.replied'
  | 'question.v2.replied'
  | 'question.rejected'
  | 'question.v2.rejected'
  | 'session.status'
  | 'session.idle'
  | 'session.compacted'
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  | 'session.diff'
  | 'session.error'
  | 'session.next.agent.switched'
  | 'session.next.model.switched'
  | 'session.next.moved'
  | 'session.next.prompted'
  | 'session.next.prompt.admitted'
  | 'session.next.prompt.promoted'
  | 'session.next.interrupt.requested'
  | 'session.next.context.updated'
  | 'session.next.synthetic'
  | 'session.next.shell.started'
  | 'session.next.shell.ended'
  | 'session.next.step.started'
  | 'session.next.step.ended'
  | 'session.next.step.failed'
  | 'session.next.text.started'
  | 'session.next.text.ended'
  | 'session.next.reasoning.started'
  | 'session.next.reasoning.ended'
  | 'session.next.tool.input.started'
  | 'session.next.tool.input.ended'
  | 'session.next.tool.called'
  | 'session.next.tool.progress'
  | 'session.next.tool.success'
  | 'session.next.tool.failed'
  | 'session.next.retried'
  | 'session.next.compaction.started'
  | 'session.next.compaction.ended'
  | 'todo.updated'
  | 'command.executed'
  | 'file.edited'
  | 'file.watcher.updated'
  | 'reference.updated'
  | 'project.directories.updated'
  | 'project.updated'
  | 'vcs.branch.updated'
  | 'worktree.ready'
  | 'worktree.failed'
  | 'workspace.ready'
  | 'workspace.failed'
  | 'workspace.status'
  | 'tui.prompt.append'
  | 'tui.command.execute'
  | 'tui.toast.show'
  | 'tui.session.select'
  | 'mcp.tools.changed'
  | 'mcp.browser.open.failed'
  | 'pty.created'
  | 'pty.updated'
  | 'pty.exited'
  | 'pty.deleted'
  | 'server.connected'
  | `${NotificationEventType}.${string}`
  | (string & {});

export interface EventProperties {
  sessionID?: string;
  messageID?: string;
  partID?: string;
  permissionID?: string;
  requestID?: string;
  callID?: string;
  id?: string;
  info?: unknown;
  error?: unknown;
  response?: string;
  reply?: string;
  status?: unknown;
  action?: string;
  resources?: Array<string>;
  save?: Array<string> | boolean;
  metadata?: Record<string, unknown>;
  source?: string;
  permission?: string;
  patterns?: Array<string>;
  always?: Array<string>;
  questions?: Array<unknown>;
  answers?: Array<Array<string>> | Array<unknown>;
  tool?: unknown;
  file?: string;
  event?: string;
  command?: string;
  arguments?: string;
  version?: string;
  branch?: string;
  title?: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
  [key: string]: unknown;
}

export interface PluginEvent {
  type: EventType;
  properties?: EventProperties;
}

export interface PluginHandlers {
  event?: (input: { event: PluginEvent }) => Promise<void>;
  dispose?: () => void | Promise<void>;
  [key: string]: unknown;
}
