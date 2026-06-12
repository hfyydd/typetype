import { contextBridge, ipcRenderer } from 'electron';
import {
  UiSnapshot,
  SettingsViewData,
  Settings,
  AsrDiagnostics,
  LlmRewriteConfig,
  DictionaryEntry,
  DictionaryImportPreview,
  DictionaryImportRequest,
  DictionaryViewData,
  StreamingAiPanelState,
  RewriteScenario,
} from './types';

export interface ElectronAPI {
  getSettingsViewData: () => Promise<SettingsViewData>;
  saveSettings: (settings: Settings) => Promise<UiSnapshot>;
  openSettings: () => Promise<void>;
  openAccessibilitySettings: () => Promise<void>;
  openMicrophoneSettings: () => Promise<void>;
  openInputMonitoringSettings: () => Promise<void>;
  openLogDirectory: () => Promise<void>;
  openFeedbackEmail: () => Promise<void>;
  runAsrDiagnostics: () => Promise<AsrDiagnostics>;
  installRuntimeDependency: () => Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getDictionaryViewData: () => Promise<DictionaryViewData>;
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => Promise<DictionaryViewData>;
  deleteDictionaryEntry: (id: string) => Promise<DictionaryViewData>;
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => Promise<DictionaryViewData>;
  promoteAutoLearnedDictionaryEntry: (id: string) => Promise<DictionaryViewData>;
  setSystemLexiconEnabled: (enabled: boolean) => Promise<DictionaryViewData>;
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => Promise<DictionaryViewData>;
  previewDictionaryImport: (request: DictionaryImportRequest) => Promise<DictionaryImportPreview>;
  commitDictionaryImport: (preview: DictionaryImportPreview) => Promise<DictionaryViewData>;
  selectDictionaryImportFile: () => Promise<DictionaryImportPreview | null>;
  exportDictionary: () => Promise<{ ok: boolean; path?: string }>;
  getStreamingAiPanelState: () => Promise<StreamingAiPanelState>;
  showStreamingAiPanel: () => Promise<StreamingAiPanelState>;
  clearStreamingAiPanel: () => Promise<StreamingAiPanelState>;
  copyStreamingAiRaw: () => Promise<StreamingAiPanelState>;
  copyStreamingAiSummary: () => Promise<StreamingAiPanelState>;
  applyStreamingAiRefinedRaw: () => Promise<StreamingAiPanelState>;
  applyStreamingAiSummary: () => Promise<StreamingAiPanelState>;
  setStreamingAiScenario: (scenario: RewriteScenario) => Promise<StreamingAiPanelState>;
  subscribeSnapshot: (listener: (snapshot: UiSnapshot) => void) => () => void;
  subscribeSettingsViewData: (listener: (view: SettingsViewData) => void) => () => void;
  subscribeStreamingAiPanelState: (listener: (state: StreamingAiPanelState) => void) => () => void;
  platform: string;
}

const api: ElectronAPI = {
  getSettingsViewData: () => ipcRenderer.invoke('get_settings_view_data'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save_settings', { settings }),
  openSettings: () => ipcRenderer.invoke('open_settings'),
  openAccessibilitySettings: () => ipcRenderer.invoke('open_accessibility_settings'),
  openMicrophoneSettings: () => ipcRenderer.invoke('open_microphone_settings'),
  openInputMonitoringSettings: () => ipcRenderer.invoke('open_input_monitoring_settings'),
  openLogDirectory: () => ipcRenderer.invoke('open_log_directory'),
  openFeedbackEmail: () => ipcRenderer.invoke('open_feedback_email'),
  runAsrDiagnostics: () => ipcRenderer.invoke('run_asr_diagnostics'),
  installRuntimeDependency: () => ipcRenderer.invoke('install_runtime_dependency'),
  startRecording: () => ipcRenderer.invoke('start_recording'),
  stopRecording: () => ipcRenderer.invoke('stop_recording'),
  testLlmConnection: (config: LlmRewriteConfig) => ipcRenderer.invoke('test_llm_connection', config),
  getDictionaryViewData: () => ipcRenderer.invoke('get_dictionary_view_data'),
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => ipcRenderer.invoke('save_dictionary_entry', entry),
  deleteDictionaryEntry: (id: string) => ipcRenderer.invoke('delete_dictionary_entry', id),
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('set_dictionary_entry_enabled', { id, enabled }),
  promoteAutoLearnedDictionaryEntry: (id: string) => ipcRenderer.invoke('promote_auto_learned_dictionary_entry', id),
  setSystemLexiconEnabled: (enabled: boolean) => ipcRenderer.invoke('set_system_lexicon_enabled', enabled),
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => ipcRenderer.invoke('set_system_lexicon_category_enabled', { category, enabled }),
  previewDictionaryImport: (request: DictionaryImportRequest) => ipcRenderer.invoke('preview_dictionary_import', request),
  commitDictionaryImport: (preview: DictionaryImportPreview) => ipcRenderer.invoke('commit_dictionary_import', preview),
  selectDictionaryImportFile: () => ipcRenderer.invoke('select_dictionary_import_file'),
  exportDictionary: () => ipcRenderer.invoke('export_dictionary'),
  getStreamingAiPanelState: () => ipcRenderer.invoke('get_streaming_ai_panel_state'),
  showStreamingAiPanel: () => ipcRenderer.invoke('show_streaming_ai_panel'),
  clearStreamingAiPanel: () => ipcRenderer.invoke('clear_streaming_ai_panel'),
  copyStreamingAiRaw: () => ipcRenderer.invoke('copy_streaming_ai_raw'),
  copyStreamingAiSummary: () => ipcRenderer.invoke('copy_streaming_ai_summary'),
  applyStreamingAiRefinedRaw: () => ipcRenderer.invoke('apply_streaming_ai_refined_raw'),
  applyStreamingAiSummary: () => ipcRenderer.invoke('apply_streaming_ai_summary'),
  setStreamingAiScenario: (scenario: RewriteScenario) => ipcRenderer.invoke('set_streaming_ai_scenario', scenario),
  subscribeSnapshot: (listener: (snapshot: UiSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: UiSnapshot) => {
      listener(snapshot);
    };

    ipcRenderer.on('snapshot_updated', wrapped);
    ipcRenderer.invoke('get_snapshot').then((snapshot: UiSnapshot) => {
      listener(snapshot);
    });

    return () => {
      ipcRenderer.removeListener('snapshot_updated', wrapped);
    };
  },
  subscribeSettingsViewData: (listener: (view: SettingsViewData) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, view: SettingsViewData) => {
      listener(view);
    };

    ipcRenderer.on('settings_view_data_updated', wrapped);

    return () => {
      ipcRenderer.removeListener('settings_view_data_updated', wrapped);
    };
  },
  subscribeStreamingAiPanelState: (listener: (state: StreamingAiPanelState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: StreamingAiPanelState) => {
      listener(state);
    };

    ipcRenderer.on('streaming_ai_panel_updated', wrapped);
    ipcRenderer.invoke('get_streaming_ai_panel_state').then((state: StreamingAiPanelState) => {
      listener(state);
    });

    return () => {
      ipcRenderer.removeListener('streaming_ai_panel_updated', wrapped);
    };
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);
