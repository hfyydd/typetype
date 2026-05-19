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

export interface LlmRewriteOptions {
  preserveTerms?: string[];
}

export interface LlmRewriteResponse {
  polished_text: string;
}

export type DictionaryEntryKind = 'term' | 'replacement';
export type DictionaryEntrySource = 'manual' | 'import' | 'legacy';
export type DictionaryImportItemStatus = 'add' | 'update' | 'duplicate' | 'invalid' | 'too_long';

export interface DictionaryEntry {
  id: string;
  kind: DictionaryEntryKind;
  term: string;
  aliases: string[];
  replacement: string;
  enabled: boolean;
  source: DictionaryEntrySource;
  created_at: string;
  updated_at: string;
}

export interface SystemLexiconEntry {
  term: string;
  category: string;
  source: string;
  weight?: number;
}

export interface DictionaryStats {
  total: number;
  enabled: number;
  terms: number;
  replacements: number;
  system_terms: number;
}

export interface DictionaryViewData {
  entries: DictionaryEntry[];
  dictionary_path: string;
  system_lexicon_count: number;
  system_categories: Array<{ category: string; count: number }>;
  stats: DictionaryStats;
}

export interface DictionaryImportRequest {
  content?: string;
  file_path?: string;
  file_name?: string;
}

export interface DictionaryImportPreviewItem {
  status: DictionaryImportItemStatus;
  raw: string;
  entry?: DictionaryEntry;
  existing_id?: string;
  reason?: string;
}

export interface DictionaryImportPreview {
  source_name: string;
  items: DictionaryImportPreviewItem[];
  warnings: string[];
  summary: {
    added: number;
    updated: number;
    duplicate: number;
    invalid: number;
    too_long: number;
    terms: number;
    replacements: number;
  };
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
