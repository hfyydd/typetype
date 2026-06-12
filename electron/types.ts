export type RecognitionMode = 'non_streaming' | 'streaming_output';
export type StreamingModelPreference =
  | 'multilingual_realtime'
  | 'multilingual_segmented'
  | 'zh_high_accuracy_realtime';
export type StreamingEnhancementMode = 'offline_private' | 'online_enhanced';
export type ComputeBackend = 'auto' | 'cpu' | 'gpu';
export type VoicePackagePreference = 'fast_offline' | 'pro_high_accuracy';
export type TranslationTargetLanguage =
  | 'zh'
  | 'en'
  | 'fr'
  | 'pt'
  | 'es'
  | 'ja'
  | 'tr'
  | 'ru'
  | 'ar'
  | 'ko'
  | 'th'
  | 'it'
  | 'de'
  | 'vi'
  | 'ms'
  | 'id'
  | 'tl'
  | 'hi'
  | 'zh-Hant'
  | 'pl'
  | 'cs'
  | 'nl'
  | 'km'
  | 'my'
  | 'fa'
  | 'gu'
  | 'ur'
  | 'te'
  | 'mr'
  | 'he'
  | 'bn'
  | 'ta'
  | 'uk'
  | 'bo'
  | 'kk'
  | 'mn'
  | 'ug'
  | 'yue';
export type CaptureIntent = 'dictation' | 'translation';
export type LlmProvider = 'openai' | 'anthropic' | 'compatible';
export type RewriteScenario =
  | 'general'
  | 'meeting_notes'
  | 'work_report'
  | 'message_reply'
  | 'todo_list'
  | 'study_notes'
  | 'customer_service'
  | 'official_resolution'
  | 'official_decision'
  | 'official_order'
  | 'official_communique'
  | 'official_announcement'
  | 'official_public_notice'
  | 'official_opinion'
  | 'official_notice'
  | 'official_circular'
  | 'official_report'
  | 'official_request'
  | 'official_reply'
  | 'official_proposal'
  | 'official_letter'
  | 'official_minutes'
  | 'business_notice'
  | 'business_plan'
  | 'business_summary'
  | 'business_proposal'
  | 'business_email'
  | 'business_memo'
  | 'business_application'
  | 'business_meeting_minutes'
  | 'student_leave_note'
  | 'student_report'
  | 'student_activity_plan'
  | 'student_speech'
  | 'student_review';

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
  scenario?: RewriteScenario;
  voiceFormattingEnabled?: boolean;
}

export interface LlmRewriteResponse {
  polished_text: string;
}

export interface RichAsrSegment {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
  language?: string;
}

export interface RichAsrResult {
  text: string;
  language?: string;
  confidence?: number;
  segments: RichAsrSegment[];
  candidates: string[];
  code_switch_hints: string[];
}

export type DictionaryEntryKind = 'term' | 'replacement';
export type DictionaryEntrySource = 'manual' | 'import' | 'legacy' | 'auto_learned';
export type DictionaryImportItemStatus = 'add' | 'update' | 'duplicate' | 'invalid' | 'too_long';

export interface DictionaryEntry {
  id: string;
  kind: DictionaryEntryKind;
  term: string;
  aliases: string[];
  replacement: string;
  enabled: boolean;
  source: DictionaryEntrySource;
  learned_count: number;
  last_learned_at: string | null;
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
  auto_learned: number;
  last_auto_learned_at: string | null;
  system_terms: number;
  system_enabled_terms: number;
}

export interface DictionaryViewData {
  entries: DictionaryEntry[];
  dictionary_path: string;
  system_lexicon_count: number;
  system_lexicon_enabled: boolean;
  system_categories: Array<{ category: string; count: number; enabled: boolean }>;
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
  streaming_model: StreamingModelPreference;
  compute_backend: ComputeBackend;
  voice_package: VoicePackagePreference;
  translation_target_language: TranslationTargetLanguage;
  auto_learning_enabled: boolean;
  voice_formatting_enabled: boolean;
  streaming_ai_panel_enabled: boolean;
  streaming_enhancement_mode: StreamingEnhancementMode;
  rewrite_scenario: RewriteScenario;
  custom_dictionary: Array<{ from: string; to: string }>;
  model_path: string | null;
  pinned_model_version: string;
  llm_rewrite: LlmRewriteConfig;
}

export type StreamingAiPanelStatus = 'idle' | 'recording' | 'thinking' | 'ready' | 'error';

export interface StreamingAiPanelState {
  enabled: boolean;
  active: boolean;
  status: StreamingAiPanelStatus;
  status_text: string;
  rewrite_scenario: RewriteScenario;
  rewrite_scenario_label: string;
  raw_text: string;
  refined_raw_text: string;
  ai_text: string;
  can_apply_refined_raw: boolean;
  apply_status_text: string | null;
  mode_label: string;
  ai_status_label: string;
  last_review_at: string | null;
  last_error: string | null;
  updated_at: string | null;
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
  preload_status: PreloadStatusView;
}

export type PreloadResourceStatus = 'warming' | 'ready' | 'error' | 'not_configured' | 'configured';

export interface PreloadResourceView {
  status: PreloadResourceStatus;
  label: string;
  detail: string;
  action?: 'install_runtime_dependency';
  action_label?: string;
  action_enabled?: boolean;
}

export interface PreloadStatusView {
  asr: PreloadResourceView;
  punctuation: PreloadResourceView;
  translation: PreloadResourceView;
  dictionary: PreloadResourceView;
  llm: PreloadResourceView;
}

export interface AsrDiagnostics {
  ok: boolean;
  mode: string;
  model_label: string;
  model_path: string;
  backend: string;
  runtime: string;
  message: string;
  itn_enabled: boolean;
  hotwords_supported: boolean;
  hotwords_enabled: boolean;
  hotwords_count: number;
  hotwords_path: string;
  code_switch_lexicon_count: number;
  dictionary_count: number;
  normalization_mode: string;
  punctuation_ready: boolean;
  punctuation_available: boolean;
  punctuation_detail: string;
  punctuation_runtime_native_dir: string;
  punctuation_runtime_binding_exists: boolean;
  punctuation_runtime_dll_exists: boolean;
  punctuation_directml_dll_exists: boolean;
  punctuation_last_error: string;
  punctuation_last_raw_error: string;
  runtime_dependency_status: string;
  vc_redist_installed: boolean;
  vc_redist_version: string;
  vc_redist_installer_exists: boolean;
  vc_redist_install_log: string;
}

export interface AsrHotwordStatus {
  supported: boolean;
  enabled: boolean;
  path: string | null;
  count: number;
  reason: string;
}

export type RuntimeStatus = 'idle' | 'recording' | 'transcribing' | 'polishing' | 'translating' | 'stopped' | 'done';
