export type NotificationMode = 'sound-first' | 'tts-first' | 'both' | 'sound-only';

export type TTSEngine = 'openai' | 'elevenlabs' | 'edge' | 'sapi';

export type NotificationEventType = 'idle' | 'permission' | 'question' | 'error';

export type PluginEnabledValue = boolean | 'enabled' | 'disabled' | 'true' | 'false';

export type SapiPitch = 'x-low' | 'low' | 'medium' | 'high' | 'x-high' | string;

export type SapiVolume = 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud' | string;

export type OpenAITtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | string;

export interface AIPrompts {
  idle: string;
  permission: string;
  question: string;
  error: string;
  idleReminder: string;
  permissionReminder: string;
  questionReminder: string;
  errorReminder: string;
  [key: string]: string;
}

export interface SessionSummary {
  files?: number;
  additions?: number;
  deletions?: number;
}

export interface AIContext {
  projectName?: string | null;
  sessionTitle?: string;
  sessionSummary?: SessionSummary;
  count?: number;
  type?: NotificationEventType | string;
}

export interface PluginConfig {
  _configVersion: string | null;
  enabled: PluginEnabledValue;

  // Notification flow
  notificationMode: NotificationMode;
  enableTTSReminder: boolean;
  enableIdleNotification: boolean;
  enablePermissionNotification: boolean;
  enableQuestionNotification: boolean;
  enableErrorNotification: boolean;
  enableIdleReminder: boolean;
  enablePermissionReminder: boolean;
  enableQuestionReminder: boolean;
  enableErrorReminder: boolean;
  ttsReminderDelaySeconds: number;
  idleReminderDelaySeconds: number;
  permissionReminderDelaySeconds: number;
  questionReminderDelaySeconds: number;
  errorReminderDelaySeconds: number;
  enableFollowUpReminders: boolean;
  maxFollowUpReminders: number;
  reminderBackoffMultiplier: number;

  // TTS engine
  ttsEngine: TTSEngine;
  enableTTS: boolean;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  elevenLabsStability: number;
  elevenLabsSimilarity: number;
  elevenLabsStyle: number;
  edgeVoice: string;
  edgePitch: string;
  edgeRate: string;
  edgeVolume?: string;
  sapiVoice: string;
  sapiRate: number;
  sapiPitch: SapiPitch;
  sapiVolume: SapiVolume;

  // OpenAI-compatible TTS
  openaiTtsEndpoint: string;
  openaiTtsApiKey: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  openaiTtsFormat: OpenAITtsFormat;
  openaiTtsSpeed: number;

  // Voice cache
  enableVoiceCache: boolean;
  voiceCacheDir: string;
  voiceCacheMaxSizeMB: number;

  // Message pools
  idleTTSMessages: string[];
  permissionTTSMessages: string[];
  permissionTTSMessagesMultiple: string[];
  idleReminderTTSMessages: string[];
  permissionReminderTTSMessages: string[];
  permissionReminderTTSMessagesMultiple: string[];
  questionTTSMessages: string[];
  questionTTSMessagesMultiple: string[];
  questionReminderTTSMessages: string[];
  questionReminderTTSMessagesMultiple: string[];
  errorTTSMessages: string[];
  errorTTSMessagesMultiple: string[];
  errorReminderTTSMessages: string[];
  errorReminderTTSMessagesMultiple: string[];

  // Batching
  permissionBatchWindowMs: number;
  questionBatchWindowMs: number;

  // AI-generated messages
  enableAIMessages: boolean;
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  aiTimeout: number;
  aiFallbackToStatic: boolean;
  enableContextAwareAI: boolean;
  aiPrompts: AIPrompts;

  // Sound files
  idleSound: string;
  permissionSound: string;
  questionSound: string;
  errorSound: string;

  // System behavior
  wakeMonitor: boolean;
  forceVolume: boolean;
  volumeThreshold: number;
  idleThresholdSeconds: number;
  enableToast: boolean;
  enableSound: boolean;

  // Desktop notifications
  enableDesktopNotification: boolean;
  desktopNotificationTimeout: number;
  showProjectInNotification: boolean;
  suppressWhenFocused: boolean;
  alwaysNotify: boolean;

  // Webhooks
  enableWebhook: boolean;
  webhookUrl: string;
  webhookUsername: string;
  webhookEvents: NotificationEventType[];
  webhookMentionOnPermission: boolean;

  // Theme + project sound routing
  soundThemeDir: string;
  randomizeSoundFromTheme: boolean;
  perProjectSounds: boolean;
  projectSoundSeed: number;

  // Logging
  debugLog: boolean;
}
