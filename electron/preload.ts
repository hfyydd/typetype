import { contextBridge, ipcRenderer } from 'electron';
import { UiSnapshot, SettingsViewData, Settings, AsrDiagnostics, LlmRewriteConfig } from './types';

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
