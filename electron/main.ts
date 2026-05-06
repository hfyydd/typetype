import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  ipcMain,
  session,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import { StateMachine } from './state-machine';
import { SettingsStore } from './settings-store';
import { AudioRecorder } from './audio-recorder';
import { AsrEngine } from './asr-engine';
import { AutoPaste } from './auto-paste';
import { TrayManager, trayStatusForRuntimeStatus } from './tray';
import { OverlayWindow } from './overlay';
import { ShortcutManager } from './shortcut-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { getLogFilePath, getLogDirectory, installFileLogger } from './logger';
import { canStopRecording, RECORDING_STOP_GUARD_MS } from './recording-toggle';
import { scheduleTranscriptionStart } from './transcription-timing';
import { createTranscriptionLogMeta } from './transcription-log';
import { UiSnapshot, SettingsViewData, Settings, AsrDiagnostics, CaptureIntent } from './types';
import { getAvailableMicrophones } from './microphones';
import { initializeAsrEngine } from './asr-bootstrap';
import { cleanupTranscript } from './transcript-cleanup';
import { TranslationEngine } from './translation-engine';
import { getTranslationLanguageDefinition, translationSupportsRecognitionMode } from './translation-model-registry';

const FEEDBACK_EMAIL = 'feedback@typetype.app';

class TypenewApp {
  private stateMachine: StateMachine;
  private settingsStore: SettingsStore;
  private audioRecorder: AudioRecorder | null = null;
  private asrEngine: AsrEngine | null = null;
  private autoPaste: AutoPaste;
  private trayManager: TrayManager;
  private overlayWindow: OverlayWindow | null = null;
  private shortcutManager: ShortcutManager;
  private settingsWindow: BrowserWindow | null = null;
  private recorderWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private previousAppBundleId: string | null = null;
  private isQuitting = false;
  private asrInitializationPromise: Promise<void> | null = null;
  private pendingTranscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptionRunId = 0;
  private stopOverlayTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderWindowReadyPromise: Promise<void> | null = null;
  private pendingRecorderStart:
    | { resolve: () => void; reject: (error: Error) => void }
    | null = null;
  private pendingRecorderResult:
    | { resolve: (samples: Float32Array) => void; reject: (error: Error) => void }
    | null = null;
  private recordingStopAllowedAt = 0;
  private streamingPastedText = '';
  private streamingLatestText = '';
  private streamingChunkQueue: Promise<void> = Promise.resolve();
  private streamingSessionId = 0;
  private activeCaptureIntent: CaptureIntent = 'dictation';
  private translationEngine: TranslationEngine;

  constructor() {
    this.settingsStore = new SettingsStore();
    this.stateMachine = new StateMachine(this.settingsStore.getSettings());
    this.autoPaste = new AutoPaste();
    this.trayManager = new TrayManager(this.getResourcesPath());
    this.shortcutManager = new ShortcutManager();
    this.translationEngine = new TranslationEngine({
      dataDir: this.getDataDir(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });

    this.setupApp();
  }

  private getResourcesPath(): string {
    const resourcesPaths = [
      path.join(__dirname, '..', 'resources'),
      path.join(__dirname, '..', '..', 'resources'),
      path.join(app.getAppPath(), 'resources'),
    ];

    for (const p of resourcesPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return resourcesPaths[0];
  }

  private getDataDir(): string {
    return this.settingsStore.getDataDir();
  }

  private setupApp(): void {
    app.on('before-quit', () => {
      this.isQuitting = true;
      this.translationEngine.dispose();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // Single instance lock
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }

    app.on('second-instance', () => {
      this.createSettingsWindow();
      if (this.settingsWindow) {
        if (this.settingsWindow.isMinimized()) {
          this.settingsWindow.restore();
        }
        this.settingsWindow.focus();
      }
    });
  }

  async initialize(): Promise<void> {
    this.configurePermissionHandlers();
    this.registerIpcHandlers();
    this.registerRecorderIpc();
    this.createOverlayWindow();
    this.createTray();
    this.applyLoginItemSettings(this.settingsStore.getSettings());
    try {
      this.registerShortcut();
    } catch (error) {
      console.error('Failed to register global shortcuts during initialization:', error);
      this.createSettingsWindow();
      this.showSettingsWindow();
    }
    this.primeAsrEngine();
  }

  private registerIpcHandlers(): void {
    registerIpcHandlers(
      () => this.getSnapshot(),
      () => this.getSettingsViewData(),
      (settings) => this.saveSettings(settings),
      () => this.showSettingsWindow(),
      () => this.openAccessibilitySettings(),
      () => this.openMicrophoneSettings(),
      () => this.openInputMonitoringSettings(),
      () => this.openLogDirectory(),
      () => this.openFeedbackEmail(),
      () => this.runAsrDiagnostics(),
      () => this.startRecording(),
      () => this.stopRecording()
    );
  }

  private createOverlayWindow(): void {
    const overlayPath = path.join(__dirname, '..', 'src', 'overlay', 'index.html');
    this.overlayWindow = new OverlayWindow(overlayPath);
    this.overlayWindow.create();
  }

  private configurePermissionHandlers(): void {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (new Set<string>(['media', 'audioCapture', 'microphone']).has(permission)) {
        callback(true);
        return;
      }

      callback(false);
    });
  }

  private registerRecorderIpc(): void {
    ipcMain.on('recorder_waveform', (_event, waveform: number[]) => {
      this.stateMachine.updateWaveform(waveform);
      this.publishSnapshot();
    });

    ipcMain.on('recorder_chunk', (_event, samplesBuffer: Buffer) => {
      if (!this.isStreamingOutputMode()) {
        return;
      }

      const samples = new Float32Array(
        samplesBuffer.buffer,
        samplesBuffer.byteOffset,
        samplesBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      ).slice();
      this.handleRecordingSamples(samples);
    });

    ipcMain.on('recorder_started', () => {
      if (!this.pendingRecorderStart) {
        return;
      }

      // Windows 录音由隐藏 renderer 持有 WebAudio 管线。
      // 主进程发出 recorder_start 后，只有等 renderer 明确回 ACK，
      // 才能认为录音已经真正开始。
      this.pendingRecorderStart.resolve();
      this.pendingRecorderStart = null;
    });

    ipcMain.on('recorder_result', (_event, samplesBuffer: Buffer) => {
      if (!this.pendingRecorderResult) {
        return;
      }

      // renderer 负责把采集到的 PCM 样本回传给主进程；
      // 主进程收到后再统一走 ASR、剪贴板和自动回填链路。
      const samples = new Float32Array(
        samplesBuffer.buffer,
        samplesBuffer.byteOffset,
        samplesBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      ).slice();
      this.pendingRecorderResult.resolve(samples);
      this.pendingRecorderResult = null;
    });

    ipcMain.on('recorder_error', (_event, message: string) => {
      const error = new Error(message);
      if (this.pendingRecorderStart) {
        this.pendingRecorderStart.reject(error);
        this.pendingRecorderStart = null;
        return;
      }
      if (this.pendingRecorderResult) {
        this.pendingRecorderResult.reject(error);
        this.pendingRecorderResult = null;
        return;
      }

      console.error('Recorder error:', error);
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    });
  }

  private createSettingsWindow(): void {
    if (this.settingsWindow) {
      return;
    }

    const settingsPath = path.join(__dirname, '..', 'src', 'settings', 'index.html');

    this.settingsWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      show: false,
      title: 'typetype Settings',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.settingsWindow.loadFile(settingsPath);

    this.settingsWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.settingsWindow?.hide();
      }
    });

    this.settingsWindow.on('ready-to-show', () => {
      // Don't show on first launch
    });
  }

  private async ensureRecorderWindow(): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    if (this.recorderWindowReadyPromise) {
      return this.recorderWindowReadyPromise;
    }

    this.recorderWindowReadyPromise = new Promise((resolve, reject) => {
      const recorderPath = path.join(__dirname, '..', 'src', 'recorder', 'index.html');
      this.recorderWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, 'recorder-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          sandbox: false,
        },
      });

      this.recorderWindow.webContents.once('did-finish-load', () => resolve());
      this.recorderWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        reject(new Error(`Recorder window failed to load: ${errorCode} ${errorDescription}`));
      });
      void this.recorderWindow.loadFile(recorderPath);
    });

    return this.recorderWindowReadyPromise;
  }

  private createTray(): void {
    const iconPath = this.trayManager.getIdleIconPath();
    this.tray = new Tray(iconPath);

    this.tray.setContextMenu(this.buildTrayMenu());

    this.tray.on('click', () => {
      this.showSettingsWindow();
    });

    // Update tray animation based on state
    this.updateTrayAnimation();
  }

  private buildTrayMenu(): Menu {
    const settings = this.settingsStore.getSettings();
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '反馈问题…',
        click: () => this.openFeedbackEmail(),
      },
      {
        label: '设置…',
        click: () => this.showSettingsWindow(),
      },
      {
        label: '选择麦克风',
        submenu: this.buildMicrophoneMenu(settings.microphone_id),
      },
      { type: 'separator' },
      {
        label: `版本 ${app.getVersion()}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '退出 typetype',
        click: () => {
          this.isQuitting = true;
          app.quit();
        },
      },
    ];

    return Menu.buildFromTemplate(template);
  }

  private buildMicrophoneMenu(selectedId: string | null): Menu {
    const microphones = getAvailableMicrophones();
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: '自动检测',
        type: 'radio',
        checked: selectedId === null,
        click: () => this.selectMicrophone(null),
      },
    ];

    for (const mic of microphones) {
      items.push({
        label: mic.label,
        type: 'radio',
        checked: selectedId === mic.id,
        click: () => this.selectMicrophone(mic.id),
      });
    }

    return Menu.buildFromTemplate(items);
  }

  private selectMicrophone(microphoneId: string | null): void {
    const settings = this.settingsStore.getSettings();
    settings.microphone_id = microphoneId;
    this.settingsStore.saveSettings(settings);
    this.stateMachine.applySettings(settings);
    this.tray?.setContextMenu(this.buildTrayMenu());
  }

  private registerShortcut(): void {
    const settings = this.settingsStore.getSettings();
    this.registerShortcutsForSettings(settings);
  }

  private handleShortcutToggle(intent: CaptureIntent): void {
    const status = this.stateMachine.getStatus();
    const now = Date.now();

    if (status === 'idle' || status === 'done') {
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start recording:', error);
      });
    } else if (status === 'recording' && canStopRecording(now, this.recordingStopAllowedAt)) {
      this.activeCaptureIntent = intent;
      void this.stopRecording();
    } else if (status === 'transcribing' || status === 'translating') {
      this.stopThinking();
    }
  }

  private registerShortcutsForSettings(settings: Settings): void {
    if (settings.hotkey === settings.translate_hotkey) {
      throw new Error('翻译快捷键不能和语音输入快捷键相同。');
    }

    this.shortcutManager.unregisterAll();

    const dictationSuccess = this.shortcutManager.register('dictation', settings.hotkey, () => {
      this.handleShortcutToggle('dictation');
    });
    const translationSuccess = this.shortcutManager.register('translation', settings.translate_hotkey, () => {
      this.handleShortcutToggle('translation');
    });

    console.log('Global shortcut registration', {
      dictation: {
        requested: settings.hotkey,
        active: this.shortcutManager.getCurrentHotkey('dictation'),
        success: dictationSuccess,
      },
      translation: {
        requested: settings.translate_hotkey,
        active: this.shortcutManager.getCurrentHotkey('translation'),
        success: translationSuccess,
      },
    });

    if (!dictationSuccess || !translationSuccess) {
      throw new Error('全局快捷键注册失败，请更换快捷键组合后再试。');
    }
  }

  private primeAsrEngine(): void {
    this.asrInitializationPromise = this.initializeAsrEngine().catch((error) => {
      console.error('Failed to initialize ASR engine:', error);
      this.asrEngine = null;
    }).finally(() => {
      this.publishSettingsViewData();
    });
  }

  private async ensureAsrEngineReady(): Promise<void> {
    if (!this.asrInitializationPromise) {
      this.primeAsrEngine();
    }

    await this.asrInitializationPromise;
  }

  private async initializeAsrEngine(): Promise<void> {
    this.asrEngine = await initializeAsrEngine({
      dataDir: this.getDataDir(),
      settings: this.settingsStore.getSettings(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
  }

  private showOverlayWindow(): void {
    this.overlayWindow?.show();
  }

  private hideOverlayWindow(): void {
    this.overlayWindow?.hide();
  }

  private clearPendingTranscriptionTimer(): void {
    if (this.pendingTranscriptionTimer) {
      clearTimeout(this.pendingTranscriptionTimer);
      this.pendingTranscriptionTimer = null;
    }
  }

  private clearStopOverlayTimer(): void {
    if (this.stopOverlayTimer) {
      clearTimeout(this.stopOverlayTimer);
      this.stopOverlayTimer = null;
    }
  }

  private showSettingsWindow(): void {
    this.createSettingsWindow();
    this.settingsWindow?.show();
    this.settingsWindow?.focus();
  }

  private openAccessibilitySettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  }

  private openMicrophoneSettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy-microphone');
    }
  }

  private openInputMonitoringSettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    }
  }

  private openLogDirectory(): void {
    const logDir = getLogDirectory();
    fs.mkdirSync(logDir, { recursive: true });
    shell.openPath(logDir);
  }

  private openFeedbackEmail(): void {
    const subject = encodeURIComponent('typetype feedback');
    shell.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
  }

  // IPC handlers

  private getSnapshot(): UiSnapshot {
    return this.stateMachine.snapshot();
  }

  private getSettingsViewData(): SettingsViewData {
    const settings = this.settingsStore.getSettings();
    const platformLabel = process.platform === 'win32' ? 'Windows' : 'macOS';

    return {
      settings,
      microphones: getAvailableMicrophones(),
      hotkeys: this.shortcutManager.getAvailableShortcuts(),
      app_version: app.getVersion(),
      platform_label: platformLabel,
      runtime_mode_label: settings.recognition_mode === 'streaming_output' ? '流式输出' : '非流式',
      model_label: settings.recognition_mode === 'streaming_output'
        ? 'sherpa-onnx-streaming-zipformer-small-ctc-zh'
        : (settings.pinned_model_version || 'sherpa-onnx-sense-voice'),
      model_status: this.asrEngine ? this.asrEngine.getRuntimeLabel() : 'not configured',
      model_path_label: this.asrEngine?.getModelDirectory() || 'not configured',
      compute_backend_label: this.asrEngine
        ? this.describeProvider(this.asrEngine.getActiveProvider())
        : 'not configured',
      log_path: getLogFilePath(),
      show_permissions_panel: process.platform === 'darwin',
      show_microphone_settings: true,
      show_accessibility_settings: process.platform === 'darwin',
      show_input_monitoring_settings: process.platform === 'darwin',
      permissions_summary: process.platform === 'darwin'
        ? 'typetype 依赖麦克风、输入监听和辅助功能权限完成全局录音触发与自动回填。'
        : 'typetype 使用本机权限完成语音输入。',
    };
  }

  private async saveSettings(settings: Settings): Promise<UiSnapshot> {
    this.registerShortcutsForSettings(settings);
    this.settingsStore.saveSettings(settings);
    this.stateMachine.applySettings(settings);
    this.applyLoginItemSettings(settings);
    this.asrEngine = null;
    this.primeAsrEngine();
    await this.ensureAsrEngineReady();
    this.tray?.setContextMenu(this.buildTrayMenu());
    const snapshot = this.stateMachine.snapshot();
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  private applyLoginItemSettings(settings: Settings): void {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return;
    }

    const openAtLogin = Boolean(settings.launch_at_login);

    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin,
        openAsHidden: openAtLogin,
      });
      return;
    }

    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: openAtLogin,
      path: process.execPath,
      args: openAtLogin ? ['--launch-at-login'] : [],
    });
  }

  private async runAsrDiagnostics(): Promise<AsrDiagnostics> {
    const settings = this.settingsStore.getSettings();
    const mode = settings.recognition_mode === 'streaming_output' ? '流式输出' : '非流式';
    const modelLabel = settings.recognition_mode === 'streaming_output'
      ? 'sherpa-onnx-streaming-zipformer-small-ctc-zh'
      : (settings.pinned_model_version || 'sherpa-onnx-sense-voice');

    try {
      const engine = await initializeAsrEngine({
        dataDir: this.getDataDir(),
        settings,
        processResourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      });

      if (!engine) {
        return {
          ok: false,
          mode,
          model_label: modelLabel,
          model_path: 'not configured',
          backend: 'not configured',
          runtime: 'not configured',
          message: '没有找到匹配的模型目录或配置',
        };
      }

      return {
        ok: true,
        mode,
        model_label: modelLabel,
        model_path: engine.getModelDirectory() || 'not configured',
        backend: this.describeProvider(engine.getActiveProvider()),
        runtime: engine.getRuntimeLabel(),
        message: '模型可加载，当前配置有效',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('ASR diagnostics failed:', error);
      return {
        ok: false,
        mode,
        model_label: modelLabel,
        model_path: this.asrEngine?.getModelDirectory() || 'not configured',
        backend: this.asrEngine ? this.describeProvider(this.asrEngine.getActiveProvider()) : 'not configured',
        runtime: this.asrEngine?.getRuntimeLabel() || 'not configured',
        message,
      };
    }
  }

  private async startRecording(intent: CaptureIntent = 'dictation'): Promise<void> {
    if (!this.stateMachine.shouldStartRecording()) {
      return;
    }

    if (intent === 'translation' && !translationSupportsRecognitionMode(this.settingsStore.getSettings().recognition_mode)) {
      throw new Error('翻译输入暂只支持非流式模式。');
    }

    // Capture frontmost app for auto-paste
    const bundleId = await this.autoPaste.captureFrontmostApp();
    this.previousAppBundleId = bundleId;
    this.activeCaptureIntent = intent;

    try {
      this.streamingSessionId += 1;
      this.streamingPastedText = '';
      this.streamingLatestText = '';
      this.streamingChunkQueue = Promise.resolve();
      if (this.isStreamingOutputMode()) {
        await this.ensureAsrEngineReady();
        this.asrEngine?.startStreamingSession();
      }

      if (process.platform === 'win32') {
        await this.ensureRecorderWindow();
        await new Promise<void>((resolve, reject) => {
          this.pendingRecorderStart = { resolve, reject };
          this.recorderWindow?.webContents.send('recorder_start', {
            microphoneId: this.settingsStore.getSettings().microphone_id,
          });
        });
      } else {
        const recordingsDir = path.join(this.getDataDir(), 'recordings');
        this.audioRecorder = new AudioRecorder(
          recordingsDir,
          this.settingsStore.getSettings().microphone_id
        );
        this.audioRecorder.setWaveformCallback((waveform) => {
          this.stateMachine.updateWaveform(waveform);
          this.publishSnapshot();
        });
        this.audioRecorder.setSamplesCallback((samples) => {
          this.handleRecordingSamples(samples);
        });
        this.audioRecorder.start();
      }
    } catch (e) {
      console.error('Failed to start recording:', e);
      return;
    }

    this.stateMachine.startRecording();
    this.recordingStopAllowedAt = Date.now() + RECORDING_STOP_GUARD_MS;
    this.showOverlayWindow();
    this.updateTrayAnimation();
    this.publishSnapshot();
  }

  private async stopRecording(): Promise<void> {
    if (process.platform === 'win32') {
      await this.stopWindowsRecording();
      return;
    }

    if (!this.audioRecorder || !this.audioRecorder.isActive()) {
      return;
    }

    const audioChunk = this.audioRecorder.stop();
    this.audioRecorder = null;
    if (this.isStreamingOutputMode()) {
      await this.finishStreamingOutput();
      return;
    }

    this.beginTranscribing(audioChunk.samples);
  }

  private async stopWindowsRecording(): Promise<void> {
    if (!this.recorderWindow) {
      return;
    }

    this.stateMachine.beginTranscribing();
    this.updateTrayAnimation();
    this.showOverlayWindow();
    this.publishSnapshot();

    const samples = await new Promise<Float32Array>((resolve, reject) => {
      this.pendingRecorderResult = { resolve, reject };
      this.recorderWindow?.webContents.send('recorder_stop');
    }).catch((error) => {
      console.error('Windows recorder stop failed:', error);
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return null;
    });

    if (!samples) {
      return;
    }

    if (this.isStreamingOutputMode()) {
      await this.finishStreamingOutput();
      return;
    }

    this.beginTranscribing(samples);
  }

  private beginTranscribing(samples: Float32Array): void {
    this.clearPendingTranscriptionTimer();
    this.clearStopOverlayTimer();
    this.stateMachine.beginTranscribing();
    this.updateTrayAnimation();
    this.showOverlayWindow();
    this.publishSnapshot();

    const runId = ++this.transcriptionRunId;
    this.pendingTranscriptionTimer = scheduleTranscriptionStart(() => {
      this.pendingTranscriptionTimer = null;
      void this.transcribeAudio(samples, runId);
    });
  }

  private stopThinking(): void {
    if (this.stateMachine.getStatus() !== 'transcribing' && this.stateMachine.getStatus() !== 'translating') {
      return;
    }

    this.transcriptionRunId += 1;
    this.clearPendingTranscriptionTimer();
    this.clearStopOverlayTimer();
    this.asrEngine?.cancelStreamingSession();

    this.stateMachine.stopTranscribing();
    this.showOverlayWindow();
    this.updateTrayAnimation();
    this.publishSnapshot();

    this.stopOverlayTimer = setTimeout(() => {
      this.stopOverlayTimer = null;
      if (this.stateMachine.getStatus() !== 'stopped') {
        return;
      }

      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }, 520);
  }

  private isCurrentTranscriptionRun(runId: number): boolean {
    return this.transcriptionRunId === runId;
  }

  private async transcribeAudio(samples: Float32Array, runId: number): Promise<void> {
    if (samples.length === 0) {
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    }

    try {
      await this.ensureAsrEngineReady();
      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      const modelPath = this.asrEngine?.getModelPath();
      if (!modelPath || !this.asrEngine) {
        throw new Error('ASR engine not initialized');
      }

      const text = await this.asrEngine.transcribe(samples);

      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      if (!text || !text.trim()) {
        this.hideOverlayWindow();
        this.stateMachine.dismissOverlay();
        this.updateTrayAnimation();
        this.publishSnapshot();
        return;
      }

      const settings = this.settingsStore.getSettings();
      const cleanedTranscript = cleanupTranscript(text, settings);
      if (!cleanedTranscript) {
        this.hideOverlayWindow();
        this.stateMachine.dismissOverlay();
        this.updateTrayAnimation();
        this.publishSnapshot();
        return;
      }

      console.log('[translation-debug] transcript', {
        intent: this.activeCaptureIntent,
        text: cleanedTranscript,
      });

      const finalText = this.activeCaptureIntent === 'translation'
        ? await this.translateTranscript(cleanedTranscript)
        : this.stateMachine.finishOutput(cleanedTranscript);
      console.log('[translation-debug] final-output', {
        intent: this.activeCaptureIntent,
        text: finalText,
      });
      console.log('Transcription complete', createTranscriptionLogMeta(finalText));

      await this.outputTranscript(finalText, settings.auto_paste);
      this.publishSnapshot();

      // Dismiss overlay after delay
      setTimeout(() => {
        this.hideOverlayWindow();
        this.updateTrayAnimation();
        this.publishSnapshot();
      }, 320);

    } catch (e) {
      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      console.error('Transcription error:', e);
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }
  }

  private async outputTranscript(finalText: string, autoPasteEnabled: boolean): Promise<void> {
    // 先写剪贴板，再按需执行自动回填，这样即使自动回填失败，
    // 用户也还能手动粘贴识别结果。
    await this.autoPaste.writeClipboard(finalText);

    if (!autoPasteEnabled) {
      return;
    }

    this.hideOverlayWindow();
    await this.autoPaste.pasteToApp(this.previousAppBundleId);
    this.stateMachine.markAutoPasteSuccess();
  }

  private isStreamingOutputMode(): boolean {
    return this.settingsStore.getSettings().recognition_mode === 'streaming_output';
  }

  private async translateTranscript(transcript: string): Promise<string> {
    const settings = this.settingsStore.getSettings();
    const language = getTranslationLanguageDefinition(settings.translation_target_language);

    this.stateMachine.beginTranslating();
    this.updateTrayAnimation();
    this.publishSnapshot();

    console.log('[translation-debug] translate-start', {
      target_language: settings.translation_target_language,
      target_label: language.label,
      transcript,
    });

    const translated = await this.translationEngine.translate(transcript, settings.translation_target_language);
    if (!translated) {
      throw new Error(`本地翻译没有返回 ${language.label} 文本。`);
    }

    console.log('[translation-debug] translate-result', {
      target_language: settings.translation_target_language,
      text: translated,
    });

    return this.stateMachine.finishOutput(translated);
  }

  private handleRecordingSamples(samples: Float32Array): void {
    if (!this.isStreamingOutputMode() || this.stateMachine.getStatus() !== 'recording') {
      return;
    }
    this.queueStreamingChunk(samples, this.streamingSessionId);
  }

  private queueStreamingChunk(samples: Float32Array, sessionId: number): void {
    this.streamingChunkQueue = this.streamingChunkQueue
      .then(async () => {
        if (sessionId !== this.streamingSessionId || samples.length === 0) {
          return;
        }

        await this.ensureAsrEngineReady();
        const settings = this.settingsStore.getSettings();
        const text = this.asrEngine?.acceptStreamingAudio(samples) ?? '';
        if (sessionId !== this.streamingSessionId || !text) {
          return;
        }

        const cleaned = cleanupTranscript(text, settings);
        if (!cleaned) {
          return;
        }

        const delta = cleaned.startsWith(this.streamingPastedText)
          ? cleaned.slice(this.streamingPastedText.length)
          : '';
        this.streamingLatestText = cleaned;

        if (delta && settings.auto_paste) {
          await this.autoPaste.writeClipboard(delta);
          await this.autoPaste.pasteToApp(this.previousAppBundleId);
          this.streamingPastedText = cleaned;
        }
      })
      .catch((error) => {
        console.error('Streaming transcription error:', error);
      });
  }

  private async finishStreamingOutput(): Promise<void> {
    this.stateMachine.beginTranscribing();
    this.updateTrayAnimation();
    this.showOverlayWindow();
    this.publishSnapshot();

    const sessionId = this.streamingSessionId;
    await this.waitForStreamingQueueToDrain();
    if (sessionId !== this.streamingSessionId) {
      return;
    }

    const finalRawText = this.asrEngine?.finishStreamingSession() ?? '';
    const finalText = cleanupTranscript(finalRawText || this.streamingLatestText, this.settingsStore.getSettings());
    this.streamingLatestText = '';

    if (!finalText) {
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    }

    const settings = this.settingsStore.getSettings();
    const normalized = this.stateMachine.finishTranscription(finalText);
    console.log('Streaming transcription complete', createTranscriptionLogMeta(normalized));

    if (settings.auto_paste) {
      const finalDelta = normalized.startsWith(this.streamingPastedText)
        ? normalized.slice(this.streamingPastedText.length)
        : '';

      if (finalDelta) {
        await this.autoPaste.writeClipboard(finalDelta);
        await this.autoPaste.pasteToApp(this.previousAppBundleId);
      } else if (this.streamingPastedText && this.streamingPastedText !== normalized) {
        console.warn('Streaming final text diverged from pasted partials', {
          pasted_length: this.streamingPastedText.length,
          final_length: normalized.length,
        });
      }

      await this.autoPaste.writeClipboard(normalized);
      this.streamingPastedText = normalized;
      this.stateMachine.markAutoPasteSuccess();
    } else {
      await this.autoPaste.writeClipboard(normalized);
    }
    this.publishSnapshot();

    setTimeout(() => {
      this.hideOverlayWindow();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }, 320);
  }

  private async waitForStreamingQueueToDrain(): Promise<void> {
    let observedQueue = this.streamingChunkQueue;

    while (true) {
      await observedQueue;
      if (observedQueue === this.streamingChunkQueue) {
        return;
      }

      observedQueue = this.streamingChunkQueue;
    }
  }

  private publishSnapshot(snapshot: UiSnapshot = this.stateMachine.snapshot()): void {
    const overlayContents = this.overlayWindow?.getWindow()?.webContents;
    if (!overlayContents || overlayContents.isDestroyed()) {
      return;
    }

    overlayContents.send('snapshot_updated', snapshot);
  }

  private publishSettingsViewData(view: SettingsViewData = this.getSettingsViewData()): void {
    const settingsContents = this.settingsWindow?.webContents;
    if (!settingsContents || settingsContents.isDestroyed()) {
      return;
    }

    settingsContents.send('settings_view_data_updated', view);
  }

  private updateTrayAnimation(): void {
    if (!this.tray) return;

    const status = trayStatusForRuntimeStatus(this.stateMachine.getStatus());
    this.trayManager.setStatus(status, (iconPath) => {
      if (this.tray) {
        this.tray.setImage(iconPath);
      }
    });
  }

  private describeProvider(provider: string | null): string {
    switch (provider) {
      case 'coreml':
        return 'GPU (CoreML)';
      case 'cuda':
        return 'GPU (CUDA)';
      case 'directml':
        return 'GPU (DirectML)';
      case 'cpu':
        return 'CPU';
      default:
        return 'not configured';
    }
  }

}

// Main entry
app.whenReady().then(async () => {
  installFileLogger();
  const typenew = new TypenewApp();
  await typenew.initialize();
}).catch((error) => {
  console.error('App initialization failed:', error);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Re-create windows if needed
  }
});
