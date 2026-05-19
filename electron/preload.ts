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
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getDictionaryViewData: () => Promise<DictionaryViewData>;
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => Promise<DictionaryViewData>;
  deleteDictionaryEntry: (id: string) => Promise<DictionaryViewData>;
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => Promise<DictionaryViewData>;
  previewDictionaryImport: (request: DictionaryImportRequest) => Promise<DictionaryImportPreview>;
  commitDictionaryImport: (preview: DictionaryImportPreview) => Promise<DictionaryViewData>;
  selectDictionaryImportFile: () => Promise<DictionaryImportPreview | null>;
  exportDictionary: () => Promise<{ ok: boolean; path?: string }>;
  subscribeSnapshot: (listener: (snapshot: UiSnapshot) => void) => () => void;
  subscribeSettingsViewData: (listener: (view: SettingsViewData) => void) => () => void;
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
  startRecording: () => ipcRenderer.invoke('start_recording'),
  stopRecording: () => ipcRenderer.invoke('stop_recording'),
  testLlmConnection: (config: LlmRewriteConfig) => ipcRenderer.invoke('test_llm_connection', config),
  getDictionaryViewData: () => ipcRenderer.invoke('get_dictionary_view_data'),
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => ipcRenderer.invoke('save_dictionary_entry', entry),
  deleteDictionaryEntry: (id: string) => ipcRenderer.invoke('delete_dictionary_entry', id),
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('set_dictionary_entry_enabled', { id, enabled }),
  previewDictionaryImport: (request: DictionaryImportRequest) => ipcRenderer.invoke('preview_dictionary_import', request),
  commitDictionaryImport: (preview: DictionaryImportPreview) => ipcRenderer.invoke('commit_dictionary_import', preview),
  selectDictionaryImportFile: () => ipcRenderer.invoke('select_dictionary_import_file'),
  exportDictionary: () => ipcRenderer.invoke('export_dictionary'),
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
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);
