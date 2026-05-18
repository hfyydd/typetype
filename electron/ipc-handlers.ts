import { ipcMain } from 'electron';
import { Settings, UiSnapshot, SettingsViewData, AsrDiagnostics, LlmRewriteConfig } from './types';

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
  startRecording: () => void,
  stopRecording: () => void,
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>
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
  ipcMain.handle('start_recording', () => startRecording());
  ipcMain.handle('stop_recording', () => stopRecording());
  ipcMain.handle('test_llm_connection', (_event, config) => testLlmConnection(config));
}
