import { ipcMain } from 'electron';
import {
  Settings,
  UiSnapshot,
  SettingsViewData,
  AsrDiagnostics,
  LlmRewriteConfig,
  DictionaryEntry,
  DictionaryImportPreview,
  DictionaryImportRequest,
  DictionaryViewData,
  StreamingAiPanelState,
  RewriteScenario,
} from './types';

export function registerIpcHandlers(
  getSnapshot: () => UiSnapshot,
  getSettingsViewData: () => SettingsViewData,
  saveSettings: (settings: Settings) => Promise<UiSnapshot> | UiSnapshot,
  openSettings: () => void,
  openAccessibilitySettings: () => void,
  openMicrophoneSettings: () => void,
  openInputMonitoringSettings: () => void,
  openLogDirectory: () => void,
  openFeedbackEmail: () => void,
  runAsrDiagnostics: () => Promise<AsrDiagnostics>,
  installRuntimeDependency: () => Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }>,
  repairShortcutsAndRecorder: () => Promise<{ ok: boolean; message: string; shortcut_health: string; runtime_status: string; repaired: boolean }>,
  startRecording: () => void,
  stopRecording: () => void,
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>,
  getDictionaryViewData: () => DictionaryViewData,
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => DictionaryViewData,
  deleteDictionaryEntry: (id: string) => DictionaryViewData,
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => DictionaryViewData,
  promoteAutoLearnedEntry: (id: string) => DictionaryViewData,
  setSystemLexiconEnabled: (enabled: boolean) => DictionaryViewData,
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => DictionaryViewData,
  previewDictionaryImport: (request: DictionaryImportRequest) => Promise<DictionaryImportPreview>,
  commitDictionaryImport: (preview: DictionaryImportPreview) => DictionaryViewData,
  selectDictionaryImportFile: () => Promise<DictionaryImportPreview | null>,
  exportDictionary: () => Promise<{ ok: boolean; path?: string }>,
  getStreamingAiPanelState: () => StreamingAiPanelState,
  showStreamingAiPanel: () => StreamingAiPanelState,
  clearStreamingAiPanel: () => StreamingAiPanelState,
  copyStreamingAiRaw: () => StreamingAiPanelState,
  copyStreamingAiSummary: () => StreamingAiPanelState,
  applyStreamingAiRefinedRaw: () => Promise<StreamingAiPanelState> | StreamingAiPanelState,
  applyStreamingAiSummary: () => Promise<StreamingAiPanelState> | StreamingAiPanelState,
  setStreamingAiScenario: (scenario: RewriteScenario) => StreamingAiPanelState
): void {
  ipcMain.handle('get_snapshot', () => getSnapshot());
  ipcMain.handle('get_settings_view_data', () => getSettingsViewData());
  ipcMain.handle('save_settings', (_event, { settings }) => saveSettings(settings));
  ipcMain.handle('open_settings', () => openSettings());
  ipcMain.handle('open_accessibility_settings', () => openAccessibilitySettings());
  ipcMain.handle('open_microphone_settings', () => openMicrophoneSettings());
  ipcMain.handle('open_input_monitoring_settings', () => openInputMonitoringSettings());
  ipcMain.handle('open_log_directory', () => openLogDirectory());
  ipcMain.handle('open_feedback_email', () => openFeedbackEmail());
  ipcMain.handle('run_asr_diagnostics', () => runAsrDiagnostics());
  ipcMain.handle('install_runtime_dependency', () => installRuntimeDependency());
  ipcMain.handle('repair_shortcuts_and_recorder', () => repairShortcutsAndRecorder());
  ipcMain.handle('start_recording', () => startRecording());
  ipcMain.handle('stop_recording', () => stopRecording());
  ipcMain.handle('test_llm_connection', (_event, config) => testLlmConnection(config));
  ipcMain.handle('get_dictionary_view_data', () => getDictionaryViewData());
  ipcMain.handle('save_dictionary_entry', (_event, entry) => saveDictionaryEntry(entry));
  ipcMain.handle('delete_dictionary_entry', (_event, id) => deleteDictionaryEntry(id));
  ipcMain.handle('set_dictionary_entry_enabled', (_event, { id, enabled }) => setDictionaryEntryEnabled(id, enabled));
  ipcMain.handle('promote_auto_learned_dictionary_entry', (_event, id) => promoteAutoLearnedEntry(id));
  ipcMain.handle('set_system_lexicon_enabled', (_event, enabled) => setSystemLexiconEnabled(enabled));
  ipcMain.handle('set_system_lexicon_category_enabled', (_event, { category, enabled }) => setSystemLexiconCategoryEnabled(category, enabled));
  ipcMain.handle('preview_dictionary_import', (_event, request) => previewDictionaryImport(request));
  ipcMain.handle('commit_dictionary_import', (_event, preview) => commitDictionaryImport(preview));
  ipcMain.handle('select_dictionary_import_file', () => selectDictionaryImportFile());
  ipcMain.handle('export_dictionary', () => exportDictionary());
  ipcMain.handle('get_streaming_ai_panel_state', () => getStreamingAiPanelState());
  ipcMain.handle('show_streaming_ai_panel', () => showStreamingAiPanel());
  ipcMain.handle('clear_streaming_ai_panel', () => clearStreamingAiPanel());
  ipcMain.handle('copy_streaming_ai_raw', () => copyStreamingAiRaw());
  ipcMain.handle('copy_streaming_ai_summary', () => copyStreamingAiSummary());
  ipcMain.handle('apply_streaming_ai_refined_raw', () => applyStreamingAiRefinedRaw());
  ipcMain.handle('apply_streaming_ai_summary', () => applyStreamingAiSummary());
  ipcMain.handle('set_streaming_ai_scenario', (_event, scenario) => setStreamingAiScenario(scenario));
}
