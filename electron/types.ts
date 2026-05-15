export type RecognitionMode = 'non_streaming' | 'streaming_output';
export type ComputeBackend = 'auto' | 'cpu' | 'gpu';
export type TranslationTargetLanguage = 'en' | 'ja' | 'de' | 'yue';
export type CaptureIntent = 'dictation' | 'translation';
export type LlmProvider = 'openai' | 'anthropic' | 'compatible';

export interface LlmRewriteConfig {
  enabled: boolean;
  provider: LlmProvider;
  api_key: string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface LlmOauthConfig {
  enabled: boolean;
  provider: LlmProvider;
  access_token: string;
  token_type: string;
  expires_at: number;
  refresh_token?: string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface LlmRewriteResponse {
  polished_text: string;
}

export interface Settings {
  hotkey: string;
  translate_hotkey: string;
  microphone_id: string | null;
  auto_paste: boolean;
  launch_at_login: boolean;
  recognition_mode: RecognitionMode;
  compute_backend: ComputeBackend;
  translation_target_language: TranslationTargetLanguage;
  custom_dictionary: Array<{ from: string; to: string }>;
  model_path: string | null;
  pinned_model_version: string;
  llm_rewrite: LlmRewriteConfig;
  llm_oauth?: LlmOauthConfig;  // OAuth config for OpenAI
}

export interface HotkeyOption {
  value: string;
  label: string;
}

export interface MicrophoneOption {
  id: string;
  label: string;
}

export interface UiSnapshot {
  status: string;
  detail: string;
  final_text: string;
  elapsed_label: string;
  waveform: number[];
  settings: Settings;
}

export interface SettingsViewData {
  settings: Settings;
  microphones: MicrophoneOption[];
  hotkeys: HotkeyOption[];
  app_version: string;
  platform_label: string;
  runtime_mode_label: string;
  model_label: string;
  model_status: string;
  model_path_label: string;
  compute_backend_label: string;
  log_path: string;
  show_permissions_panel: boolean;
  show_microphone_settings: boolean;
  show_accessibility_settings: boolean;
  show_input_monitoring_settings: boolean;
  permissions_summary: string;
}

export interface AsrDiagnostics {
  ok: boolean;
  mode: string;
  model_label: string;
  model_path: string;
  backend: string;
  runtime: string;
  message: string;
}

export type RuntimeStatus = 'idle' | 'recording' | 'transcribing' | 'polishing' | 'translating' | 'stopped' | 'done';
