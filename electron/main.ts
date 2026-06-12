import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  ipcMain,
  session,
  dialog,
  powerMonitor,
  clipboard,
  screen,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';

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
import {
  UiSnapshot,
  SettingsViewData,
  Settings,
  AsrDiagnostics,
  CaptureIntent,
  DictionaryEntry,
  DictionaryImportPreview,
  DictionaryImportRequest,
  DictionaryViewData,
  PreloadStatusView,
  StreamingAiPanelState,
  RewriteScenario,
} from './types';
import { getAvailableMicrophones } from './microphones';
import { initializeAsrEngine } from './asr-bootstrap';
import { cleanupTranscript, stripUnknownTokens } from './transcript-cleanup';
import { TranslationEngine } from './translation-engine';
import {
  getTranslationLanguageDefinition,
  resolveBundledHyMt2ModelPath,
  resolveBundledLlamaCliPath,
  translationSupportsRecognitionMode,
} from './translation-model-registry';
import { getRewriteScenarioLabel, getRewriteScenarioPrompt, testLlmConnection } from './llm-rewrite';
import { rewriteWithPreferredLlm } from './llm-route';
import { StreamingSegmenter, StreamingSegmentEvent } from './streaming-segmentation';
import { ensureStreamingFinalPunctuation, prefixStreamingBoundaryPunctuation } from './streaming-punctuation';
import { applyBasicTranscriptPunctuation } from './transcript-punctuation';
import { applyVoiceFormattingCommands } from './transcript-formatting';
import { DictionaryStore } from './dictionary-store';
import { createDictionaryImportPreview } from './dictionary-import';
import { parseStreamingAiResult, sanitizeStreamingAiText } from './streaming-ai-text';
import { buildLocalRewritePromptContext, LocalChineseRewriteResult, rewriteChineseLocally } from './local-chinese-rewrite';
import { LocalPunctuationEngine } from './local-punctuation-engine';
import { RollingAudioCache } from './streaming-audio-cache';
import { TextInsertionTransaction } from './text-insertion-transaction';
import { CodeSwitchLexicon } from './code-switch-lexicon';
import { AiRewriteGate } from './ai-rewrite-gate';
import { SemanticPunctuationEngine } from './semantic-punctuation-engine';
import { TextNormalizationEngine } from './text-normalization-engine';
import { AsrHotwordManager } from './asr-hotword-manager';
import { RuntimeDependencyManager } from './runtime-dependency-manager';
import {
  StreamingRealtimeTextProcessor,
  StreamingTailCorrection,
} from './streaming-realtime-text-processor';

const FEEDBACK_EMAIL = 'feedback@typetype.app';
const WINDOWS_LOGIN_ITEM_NAME = 'typetype';
const WINDOWS_LEGACY_LOGIN_ITEM_NAMES = [
  'electron.app.Electron',
  'electron.app.typetype',
];
const STREAMING_AI_MIN_CHARS = 45;
const STREAMING_AI_FAST_MIN_CHARS = 18;
const STREAMING_AI_FAST_COOLDOWN_MS = 4500;
const STREAMING_PASTE_INITIAL_CHARS = 1;
const STREAMING_PASTE_INITIAL_INTERVAL_MS = 0;
const STREAMING_PASTE_MIN_CHARS = 1;
const STREAMING_PASTE_MIN_INTERVAL_MS = 0;
const STREAMING_PASTE_STARTUP_WINDOW_CHARS = 36;
const STREAMING_PANEL_THROTTLE_MS = 100;
const STREAMING_AUDIO_CACHE_SECONDS = 120;
const STREAMING_TAIL_CORRECTION_MIN_INTERVAL_MS = 500;

interface StreamingCursorCommitState {
  committedText: string;
  committedSourceText: string;
  committedAt: number;
  sessionId: number;
}

function defaultPreloadStatus(): PreloadStatusView {
  return {
    asr: { status: 'warming', label: '识别引擎', detail: '正在后台预热识别引擎。' },
    punctuation: { status: 'warming', label: '本地断句增强', detail: '正在后台检查本地断句增强能力。' },
    translation: { status: 'warming', label: '翻译资源', detail: '正在检查本地翻译资源。' },
    dictionary: { status: 'warming', label: '词典索引', detail: '正在加载本地词典。' },
    llm: { status: 'not_configured', label: 'LLM 配置', detail: '未启用 LLM 润写。' },
  };
}

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
  private streamingAiWindow: BrowserWindow | null = null;
  private recorderWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private previousAppBundleId: string | null = null;
  private isQuitting = false;
  private asrInitializationPromise: Promise<void> | null = null;
  private asrInitializationError: Error | null = null;
  private isAsrInitializing = false;
  private asrInitializationGeneration = 0;
  private pendingTranscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptionRunId = 0;
  private stopOverlayTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderWindowReadyPromise: Promise<void> | null = null;
  private translationAsrEngine: AsrEngine | null = null;
  private translationAsrInitializationPromise: Promise<AsrEngine | null> | null = null;
  private pendingRecorderStart:
    | { resolve: () => void; reject: (error: Error) => void }
    | null = null;
  private pendingRecorderResult:
    | { resolve: (samples: Float32Array) => void; reject: (error: Error) => void }
    | null = null;
  private recordingStopAllowedAt = 0;
  private streamingPastedText = '';
  private streamingPastedSourceText = '';
  private streamingInsertionTransaction: TextInsertionTransaction;
  private streamingOutputText = '';
  private streamingLatestText = '';
  private streamingChunkQueue: Promise<void> = Promise.resolve();
  private streamingPastePendingText = '';
  private streamingPasteInFlight = false;
  private streamingAutoPasteSuspended = false;
  private streamingSessionId = 0;
  private streamingChunkLogCount = 0;
  private streamingSegmenter: StreamingSegmenter | null = null;
  private streamingPendingBoundaryPunctuation = false;
  private streamingLastPasteAt = 0;
  private streamingTailCorrectionLastAt = 0;
  private streamingTailCorrectionInFlight = false;
  private streamingTailReplacementActive = false;
  private streamingTailCorrectionSuspended = false;
  private streamingPendingTailCorrection: StreamingTailCorrection | null = null;
  private streamingCursorCommitState: StreamingCursorCommitState = {
    committedText: '',
    committedSourceText: '',
    committedAt: 0,
    sessionId: 0,
  };
  private streamingPendingAiReviewAfterCommit = false;
  private streamingAudioCache = new RollingAudioCache(16000, STREAMING_AUDIO_CACHE_SECONDS);
  private streamingAiState: StreamingAiPanelState = {
    enabled: false,
    active: false,
    status: 'idle',
    status_text: '流式 AI 整理面板未开启。',
    rewrite_scenario: 'general',
    rewrite_scenario_label: '通用整理',
    raw_text: '',
    refined_raw_text: '',
    ai_text: '',
    can_apply_refined_raw: false,
    apply_status_text: null,
    mode_label: '涉密离线模式',
    ai_status_label: '未开始',
    last_review_at: null,
    last_error: null,
    updated_at: null,
  };
  private streamingAiSubmittedRawLength = 0;
  private streamingAiInFlight = false;
  private streamingAiPendingRawText: string | null = null;
  private streamingAiPendingFinal = false;
  private streamingAiLastRequestAt = 0;
  private streamingAiLastSubmittedText = '';
  private streamingRewriteScenario: RewriteScenario = 'general';
  private streamingPanelPublishTimer: ReturnType<typeof setTimeout> | null = null;
  private preloadStatus: PreloadStatusView = defaultPreloadStatus();
  private activeCaptureIntent: CaptureIntent = 'dictation';
  private translationEngine: TranslationEngine;
  private dictionaryStore: DictionaryStore;
  private codeSwitchLexicon: CodeSwitchLexicon;
  private aiRewriteGate: AiRewriteGate;
  private localPunctuationEngine: LocalPunctuationEngine;
  private semanticPunctuationEngine: SemanticPunctuationEngine;
  private textNormalizationEngine: TextNormalizationEngine;
  private asrHotwordManager: AsrHotwordManager;
  private runtimeDependencyManager: RuntimeDependencyManager;
  private streamingRealtimeTextProcessor: StreamingRealtimeTextProcessor;
  private runtimeDependencyPromptShown = false;
  private runtimeDependencyPromptSuppressed = false;
  private runtimeDependencyPromptInFlight = false;
  private shortcutWatchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.settingsStore = new SettingsStore();
    this.stateMachine = new StateMachine(this.settingsStore.getSettings());
    this.autoPaste = new AutoPaste();
    this.streamingInsertionTransaction = new TextInsertionTransaction(this.autoPaste);
    this.trayManager = new TrayManager(this.getResourcesPath());
    this.shortcutManager = new ShortcutManager();
    this.dictionaryStore = new DictionaryStore({
      dataDir: this.getDataDir(),
      resourcesPath: this.getResourcesPath(),
      legacyCustomDictionary: this.settingsStore.getSettings().custom_dictionary,
    });
    this.codeSwitchLexicon = new CodeSwitchLexicon({
      dataDir: this.getDataDir(),
      resourcesPath: this.getResourcesPath(),
    });
    this.aiRewriteGate = new AiRewriteGate();
    this.textNormalizationEngine = new TextNormalizationEngine();
    this.asrHotwordManager = new AsrHotwordManager({
      dataDir: this.getDataDir(),
    });
    this.streamingRealtimeTextProcessor = new StreamingRealtimeTextProcessor({
      textNormalizationEngine: this.textNormalizationEngine,
      applyDictionary: (text, options) => this.dictionaryStore.applyToText(text, options),
      applyCodeSwitch: (text, options) => this.codeSwitchLexicon.applyToText(text, options),
    });
    this.runtimeDependencyManager = new RuntimeDependencyManager({
      resourcesPath: this.getResourcesPath(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    const dictionaryStats = this.dictionaryStore.getViewData().stats;
    this.preloadStatus.dictionary = {
      status: 'ready',
      label: '词典索引',
      detail: `个人词典 ${dictionaryStats.total} 条，系统词库 ${dictionaryStats.system_terms} 条，混输词库 ${this.codeSwitchLexicon.getEntryCount()} 条已加载。`,
    };
    this.preloadStatus.llm = this.getLlmPreloadStatus(this.settingsStore.getSettings());
    this.translationEngine = new TranslationEngine({
      dataDir: this.getDataDir(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    this.localPunctuationEngine = new LocalPunctuationEngine({
      resourcesPath: this.getResourcesPath(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    this.semanticPunctuationEngine = new SemanticPunctuationEngine(
      this.localPunctuationEngine,
      this.codeSwitchLexicon
    );

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

  private getDictionaryViewData(): DictionaryViewData {
    return this.dictionaryStore.getViewData();
  }

  private buildAsrHotwordContext(): {
    codeSwitchTerms: string[];
    dictionaryTerms: string[];
    systemTerms: string[];
  } {
    const dictionaryTerms = this.dictionaryStore
      .getEntries()
      .filter((entry) => entry.enabled)
      .flatMap((entry) => [entry.term, entry.replacement, ...entry.aliases]);
    const systemTerms = this.dictionaryStore
      .getSystemLexicon()
      .map((entry) => entry.term);

    return {
      codeSwitchTerms: this.codeSwitchLexicon.getHotwordTerms(5000),
      dictionaryTerms,
      systemTerms,
    };
  }

  private saveDictionaryEntry(entry: Partial<DictionaryEntry>): DictionaryViewData {
    this.dictionaryStore.saveEntry(entry);
    return this.dictionaryStore.getViewData();
  }

  private deleteDictionaryEntry(id: string): DictionaryViewData {
    this.dictionaryStore.deleteEntry(id);
    return this.dictionaryStore.getViewData();
  }

  private setDictionaryEntryEnabled(id: string, enabled: boolean): DictionaryViewData {
    this.dictionaryStore.setEntryEnabled(id, enabled);
    return this.dictionaryStore.getViewData();
  }

  private promoteAutoLearnedEntry(id: string): DictionaryViewData {
    this.dictionaryStore.promoteAutoLearnedEntry(id);
    return this.dictionaryStore.getViewData();
  }

  private setSystemLexiconEnabled(enabled: boolean): DictionaryViewData {
    return this.dictionaryStore.setSystemLexiconEnabled(enabled);
  }

  private setSystemLexiconCategoryEnabled(category: string, enabled: boolean): DictionaryViewData {
    return this.dictionaryStore.setSystemCategoryEnabled(category, enabled);
  }

  private previewDictionaryImport(request: DictionaryImportRequest): Promise<DictionaryImportPreview> {
    return createDictionaryImportPreview(request, this.dictionaryStore.getEntries());
  }

  private commitDictionaryImport(preview: DictionaryImportPreview): DictionaryViewData {
    return this.dictionaryStore.commitImportPreview(preview);
  }

  private async selectDictionaryImportFile(): Promise<DictionaryImportPreview | null> {
    const options: Electron.OpenDialogOptions = {
      title: '选择要导入的词典文件',
      properties: ['openFile'],
      filters: [
        { name: '词典文件', extensions: ['txt', 'csv', 'xlsx', 'xls', 'docx', 'wps', 'et'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    };
    const result = this.settingsWindow
      ? await dialog.showOpenDialog(this.settingsWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    return this.previewDictionaryImport({
      file_path: filePath,
      file_name: path.basename(filePath),
    });
  }

  private async exportDictionary(): Promise<{ ok: boolean; path?: string }> {
    const options: Electron.SaveDialogOptions = {
      title: '导出个人词典',
      defaultPath: path.join(app.getPath('desktop'), 'typetype-dictionary.json'),
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
      ],
    };
    const result = this.settingsWindow
      ? await dialog.showSaveDialog(this.settingsWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { ok: false };
    }

    this.dictionaryStore.exportTo(result.filePath);
    return { ok: true, path: result.filePath };
  }

  private setupApp(): void {
    app.on('before-quit', () => {
      this.isQuitting = true;
      if (this.shortcutWatchdogTimer) {
        clearInterval(this.shortcutWatchdogTimer);
        this.shortcutWatchdogTimer = null;
      }
      if (this.streamingPanelPublishTimer) {
        clearTimeout(this.streamingPanelPublishTimer);
        this.streamingPanelPublishTimer = null;
      }
      this.shortcutManager.unregisterAll();
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

    powerMonitor.on('resume', () => {
      this.repairShortcutsIfNeeded('system-resume');
    });

    powerMonitor.on('unlock-screen', () => {
      this.repairShortcutsIfNeeded('screen-unlock');
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
    this.startStartupPreload();
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
      () => this.installRuntimeDependency(),
      () => this.startRecording(),
      () => this.stopRecording(),
      (config) => testLlmConnection(config),
      () => this.getDictionaryViewData(),
      (entry) => this.saveDictionaryEntry(entry),
      (id) => this.deleteDictionaryEntry(id),
      (id, enabled) => this.setDictionaryEntryEnabled(id, enabled),
      (id) => this.promoteAutoLearnedEntry(id),
      (enabled) => this.setSystemLexiconEnabled(enabled),
      (category, enabled) => this.setSystemLexiconCategoryEnabled(category, enabled),
      (request) => this.previewDictionaryImport(request),
      (preview) => this.commitDictionaryImport(preview),
      () => this.selectDictionaryImportFile(),
      () => this.exportDictionary(),
      () => this.getStreamingAiPanelState(),
      () => this.showStreamingAiPanel(true),
      () => this.clearStreamingAiPanel(),
      () => this.copyStreamingAiRaw(),
      () => this.copyStreamingAiSummary(),
      () => this.applyStreamingAiRefinedRaw(),
      () => this.applyStreamingAiSummary(),
      (scenario) => this.setStreamingAiScenario(scenario)
    );
  }

  private createOverlayWindow(): void {
    const overlayPath = path.join(__dirname, '..', 'src', 'overlay', 'index.html');
    this.overlayWindow = new OverlayWindow(overlayPath, this.getDataDir());
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

  private createStreamingAiWindow(): void {
    if (this.streamingAiWindow) {
      return;
    }

    const panelPath = path.join(__dirname, '..', 'src', 'streaming-ai', 'index.html');
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = Math.min(760, Math.max(620, workArea.width - 32));
    const height = Math.min(500, Math.max(420, workArea.height - 80));

    this.streamingAiWindow = new BrowserWindow({
      width,
      height,
      minWidth: 560,
      minHeight: 380,
      x: workArea.x + workArea.width - width - 16,
      y: workArea.y + Math.max(16, workArea.height - height - 72),
      show: false,
      title: 'typetype AI 整理',
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.streamingAiWindow.setMenuBarVisibility(false);

    this.streamingAiWindow.loadFile(panelPath);

    this.streamingAiWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.streamingAiWindow?.hide();
      }
    });

    this.streamingAiWindow.webContents.on('did-finish-load', () => {
      this.publishStreamingAiPanelState();
    });
  }

  private getStreamingAiPanelState(): StreamingAiPanelState {
    return {
      ...this.streamingAiState,
      enabled: this.settingsStore.getSettings().streaming_ai_panel_enabled,
    };
  }

  private showStreamingAiPanel(focus = true): StreamingAiPanelState {
    this.createStreamingAiWindow();
    if (focus) {
      this.streamingAiWindow?.show();
      this.streamingAiWindow?.focus();
    } else if (process.platform === 'win32' && this.streamingAiWindow && 'showInactive' in this.streamingAiWindow) {
      this.streamingAiWindow.showInactive();
    } else {
      this.streamingAiWindow?.show();
    }
    this.publishStreamingAiPanelState();
    return this.getStreamingAiPanelState();
  }

  private clearStreamingAiPanel(): StreamingAiPanelState {
    this.streamingAiSubmittedRawLength = 0;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiLastSubmittedText = '';
    this.patchStreamingAiPanelState({
      active: false,
      status: 'idle',
      status_text: '已清空本次流式记录。',
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: '',
      refined_raw_text: '',
      ai_text: '',
      can_apply_refined_raw: false,
      apply_status_text: null,
      last_error: null,
    }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private setStreamingAiScenario(scenario: RewriteScenario): StreamingAiPanelState {
    this.streamingRewriteScenario = scenario || 'general';
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const rawText = this.normalizeTranscriptText(
      this.streamingAiState.raw_text || this.streamingLatestText || this.streamingOutputText,
      settings
    );
    const localRewrite = rawText ? this.buildLocalChineseRewrite(rawText, settings, false) : null;
    this.patchStreamingAiPanelState({
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      refined_raw_text: localRewrite
        ? sanitizeStreamingAiText(localRewrite.refinedRawText) || rawText
        : this.streamingAiState.refined_raw_text,
      ai_text: localRewrite
        ? sanitizeStreamingAiText(localRewrite.structuredText)
        : this.streamingAiState.ai_text,
      status_text: rawText
        ? `已切换为${getRewriteScenarioLabel(this.streamingRewriteScenario)}模板，并重新整理本次内容。`
        : `已切换为${getRewriteScenarioLabel(this.streamingRewriteScenario)}模板。`,
      last_error: null,
    }, { immediate: true });

    if (rawText) {
      this.queueStreamingAiReview(rawText, settings, false);
    }

    return this.getStreamingAiPanelState();
  }

  private copyStreamingAiRaw(): StreamingAiPanelState {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const text = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.refined_raw_text || this.streamingAiState.raw_text || ''),
      settings
    );
    clipboard.writeText(text);
    this.patchStreamingAiPanelState({ status_text: text ? 'AI 修正原文已复制到剪贴板。' : '没有可复制的 AI 修正原文。' }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private copyStreamingAiSummary(): StreamingAiPanelState {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const text = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.ai_text || ''),
      settings
    );
    clipboard.writeText(text);
    this.patchStreamingAiPanelState({ status_text: text ? '整理稿已复制到剪贴板。' : '没有可复制的整理稿。' }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private async applyStreamingAiRefinedRaw(): Promise<StreamingAiPanelState> {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const refinedText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.refined_raw_text || this.streamingAiState.raw_text || ''),
      settings
    );
    if (!refinedText) {
      this.patchStreamingAiPanelState({
        apply_status_text: '没有可带入的 AI 修正原文。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    if (!this.streamingInsertionTransaction.hasInsertedText()) {
      await this.autoPaste.writeClipboard(refinedText);
      this.patchStreamingAiPanelState({
        apply_status_text: '光标处没有检测到本次流式原文，已复制 AI 修正原文，请手动粘贴。',
        status_text: 'AI 修正原文已复制。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
      refinedText,
      this.previousAppBundleId,
      { respectExternalClipboardChange: false }
    );

    if (replaceResult.status === 'replaced') {
      this.streamingPastedText = refinedText;
      this.streamingOutputText = refinedText;
      this.streamingPastedSourceText = refinedText;
      this.streamingPendingBoundaryPunctuation = false;
      this.patchStreamingAiPanelState({
        refined_raw_text: refinedText,
        can_apply_refined_raw: true,
        apply_status_text: '已将 AI 修正原文带入到光标处。',
        status_text: 'AI 修正原文已带入，后续语音会继续追加。',
        last_error: null,
      }, { immediate: true });
    } else {
      if (replaceResult.status !== 'clipboard_changed') {
        await this.autoPaste.writeClipboard(refinedText);
      }
      this.patchStreamingAiPanelState({
        apply_status_text: replaceResult.status === 'target_changed'
          ? '目标窗口已变化，未自动带入；AI 修正原文已复制，请手动粘贴。'
          : replaceResult.status === 'clipboard_changed'
            ? '检测到剪贴板已有新内容，未自动带入；可使用复制按钮取回 AI 修正原文。'
            : '目标窗口无法自动替换，已复制 AI 修正原文，请手动粘贴。',
        status_text: replaceResult.status === 'clipboard_changed'
          ? '自动带入已暂停，避免覆盖新的剪贴板内容。'
          : '自动带入失败，已复制到剪贴板。',
        last_error: replaceResult.error ?? replaceResult.status,
      }, { immediate: true });
    }
    return this.getStreamingAiPanelState();
  }

  private async applyStreamingAiSummary(): Promise<StreamingAiPanelState> {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const summaryText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.ai_text || ''),
      settings
    );
    if (!summaryText) {
      this.patchStreamingAiPanelState({
        apply_status_text: '没有可带入的整理稿。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    if (!this.streamingInsertionTransaction.hasInsertedText()) {
      await this.autoPaste.writeClipboard(summaryText);
      const pasteResult = await this.autoPaste.pasteToApp(this.previousAppBundleId);
      this.patchStreamingAiPanelState({
        apply_status_text: pasteResult.ok
          ? '整理稿已带入到光标处。'
          : '整理稿已复制到剪贴板，请手动粘贴。',
        status_text: pasteResult.ok
          ? '整理稿已带入。'
          : '目标输入框未接住整理稿，已复制到剪贴板。',
        last_error: pasteResult.ok ? null : pasteResult.error ?? 'paste_summary_failed',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
      summaryText,
      this.previousAppBundleId,
      { respectExternalClipboardChange: false }
    );

    if (replaceResult.status === 'replaced') {
      this.streamingPastedText = summaryText;
      this.streamingOutputText = summaryText;
      this.streamingPastedSourceText = summaryText;
      this.streamingPendingBoundaryPunctuation = false;
      this.patchStreamingAiPanelState({
        can_apply_refined_raw: true,
        apply_status_text: '已将整理稿带入到光标处。',
        status_text: '整理稿已带入。',
        last_error: null,
      }, { immediate: true });
    } else {
      await this.autoPaste.writeClipboard(summaryText);
      this.patchStreamingAiPanelState({
        apply_status_text: '目标输入框无法自动替换，整理稿已复制到剪贴板。',
        status_text: '整理稿带入失败，请手动粘贴。',
        last_error: replaceResult.error ?? replaceResult.status,
      }, { immediate: true });
    }

    return this.getStreamingAiPanelState();
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
    this.registerShortcutsForSettings(settings, 'startup');
    this.startShortcutWatchdog();
  }

  private handleShortcutToggle(intent: CaptureIntent): void {
    const status = this.stateMachine.getStatus();
    const now = Date.now();

    if (status === 'idle' || status === 'done') {
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start recording:', error);
      });
    } else if (status === 'recording' && canStopRecording(now, this.recordingStopAllowedAt)) {
      this.applyStopIntent(intent);
      void this.stopRecording();
    } else if (status === 'transcribing' || status === 'translating') {
      this.stopThinking();
    }
  }

  private applyStopIntent(intent: CaptureIntent): void {
    if (intent === this.activeCaptureIntent) {
      return;
    }

    if (this.activeCaptureIntent === 'dictation' && intent === 'translation') {
      if (this.shouldUseStreamingForActiveCapture()) {
        this.cancelStreamingOutputSession('switch-to-translation');
      }
      this.activeCaptureIntent = 'translation';
      console.log('Recording intent switched to translation');
      return;
    }

    console.log('Ignoring stop intent switch while recording', {
      active: this.activeCaptureIntent,
      requested: intent,
    });
  }

  private registerShortcutsForSettings(settings: Settings, reason = 'settings'): void {
    if (settings.hotkey === settings.translate_hotkey) {
      throw new Error('翻译快捷键不能和语音输入快捷键相同。');
    }

    this.shortcutManager.unregisterAll();

    const dictationSuccess = this.shortcutManager.register(
      'dictation',
      settings.hotkey,
      () => {
        this.handleShortcutToggle('dictation');
      },
      { disabledFallbackHotkeys: [settings.translate_hotkey] }
    );
    const translationSuccess = this.shortcutManager.register(
      'translation',
      settings.translate_hotkey,
      () => {
        this.handleShortcutToggle('translation');
      },
      { disabledFallbackHotkeys: [settings.hotkey] }
    );

    console.log('Global shortcut registration', {
      reason,
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

    if (!dictationSuccess) {
      throw new Error('语音输入快捷键注册失败，请更换快捷键组合后再试。');
    }

    if (!translationSuccess) {
      console.warn('Translation shortcut registration failed; dictation shortcut remains active');
    }
  }

  private startShortcutWatchdog(): void {
    if (this.shortcutWatchdogTimer) {
      clearInterval(this.shortcutWatchdogTimer);
    }

    this.shortcutWatchdogTimer = setInterval(() => {
      this.repairShortcutsIfNeeded('watchdog');
    }, 15000);
  }

  private repairShortcutsIfNeeded(reason: string): void {
    if (this.isQuitting) {
      return;
    }

    const health = this.shortcutManager.getRegistrationHealth();
    if (health.ok) {
      return;
    }

    console.warn('Global shortcut registration health check failed; repairing', {
      reason,
      missing: health.missing,
    });

    try {
      this.registerShortcutsForSettings(this.settingsStore.getSettings(), reason);
      this.publishSettingsViewData();
    } catch (error) {
      console.error('Failed to repair global shortcuts:', error);
    }
  }

  private primeAsrEngine(): void {
    const generation = ++this.asrInitializationGeneration;
    this.asrInitializationError = null;
    this.isAsrInitializing = true;
    this.preloadStatus.asr = {
      status: 'warming',
      label: '识别引擎',
      detail: '正在后台预热识别引擎。',
    };
    this.publishSettingsViewData();
    this.asrInitializationPromise = this.initializeAsrEngine(generation).catch((error) => {
      if (generation !== this.asrInitializationGeneration) {
        return;
      }
      console.error('Failed to initialize ASR engine:', error);
      this.asrInitializationError = error instanceof Error ? error : new Error(String(error));
      this.asrEngine = null;
    }).finally(() => {
      if (generation !== this.asrInitializationGeneration) {
        return;
      }
      this.isAsrInitializing = false;
      this.preloadStatus.asr = this.asrEngine
        ? {
          status: 'ready',
          label: '识别引擎',
          detail: `${this.getAsrModelStatusLabel()}，可直接录音。`,
        }
        : {
          status: 'error',
          label: '识别引擎',
          detail: this.asrInitializationError?.message || '未找到可用识别模型。',
        };
      this.publishSettingsViewData();
    });
  }

  private startStartupPreload(): void {
    this.preloadDictionaryStatus();
    this.preloadLlmStatus();
    this.preloadTranslationStatus();
    this.preloadPunctuationStatus();
    this.primeAsrEngine();
  }

  private preloadDictionaryStatus(): void {
    const stats = this.dictionaryStore.getViewData().stats;
    this.preloadStatus.dictionary = {
      status: 'ready',
      label: '词典索引',
      detail: `个人词典 ${stats.total} 条，系统词库 ${stats.system_terms} 条已加载。`,
    };
  }

  private preloadLlmStatus(): void {
    this.preloadStatus.llm = this.getLlmPreloadStatus(this.settingsStore.getSettings());
  }

  private preloadPunctuationStatus(options: { keepReadyWhileChecking?: boolean } = {}): void {
    if (!options.keepReadyWhileChecking) {
      this.preloadStatus.punctuation = {
        status: 'warming',
        label: '本地断句增强',
        detail: '正在后台检查本地断句增强能力。',
      };
      this.publishSettingsViewData();
    }

    void this.localPunctuationEngine.warmup()
      .then(() => {
        this.preloadStatus.punctuation = {
          status: 'ready',
          label: '本地断句增强',
          detail: '本地断句增强已就绪，涉密模式不联网也能补标点和断句。',
        };
        this.publishSettingsViewData();
      })
      .catch((error) => {
        const status = this.localPunctuationEngine.getStatus();
        const diagnostics = this.localPunctuationEngine.getDiagnostics();
        const runtimeStatus = this.runtimeDependencyManager.getStatus(
          diagnostics.last_raw_error || diagnostics.last_error || (error instanceof Error ? error.message : String(error))
        );
        this.preloadStatus.punctuation = {
          status: runtimeStatus.status === 'ready' ? 'ready' : 'error',
          label: '本地断句增强',
          detail: runtimeStatus.user_message || status.detail,
          action: runtimeStatus.action,
          action_label: runtimeStatus.action_label,
          action_enabled: runtimeStatus.can_install,
        };
        this.publishSettingsViewData();
      });
  }

  private preloadTranslationStatus(): void {
    try {
      const hyModelPath = resolveBundledHyMt2ModelPath(process.resourcesPath, app.getAppPath());
      const llamaCliPath = resolveBundledLlamaCliPath(process.resourcesPath, app.getAppPath());
      this.preloadStatus.translation = hyModelPath && llamaCliPath
        ? {
          status: 'ready',
          label: '翻译资源',
          detail: '本机翻译资源和运行时已就绪。',
        }
        : {
          status: 'error',
          label: '翻译资源',
          detail: '未找到完整本地翻译模型或运行时，翻译时会尝试降级。',
        };
    } catch (error) {
      this.preloadStatus.translation = {
        status: 'error',
        label: '翻译资源',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    this.publishSettingsViewData();
  }

  private getLlmPreloadStatus(settings: Settings): PreloadStatusView['llm'] {
    if (!settings.llm_rewrite?.enabled) {
      return {
        status: 'not_configured',
        label: 'LLM 配置',
        detail: '未启用 LLM 润写；不会调用 API。',
      };
    }

    if (!settings.llm_rewrite.api_key?.trim()) {
      return {
        status: 'not_configured',
        label: 'LLM 配置',
        detail: '已启用 LLM 润写，但还没有填写 API Key。',
      };
    }

    const hasBaseUrl = Boolean(settings.llm_rewrite.base_url?.trim());
    const hasModel = Boolean(settings.llm_rewrite.model?.trim());
    return {
      status: hasBaseUrl && hasModel ? 'configured' : 'error',
      label: 'LLM 配置',
      detail: hasBaseUrl && hasModel
        ? `已配置 ${settings.llm_rewrite.model}，未主动消耗 API 额度。`
        : '服务地址或服务参数为空，请重新选择大模型厂家。',
    };
  }

  private async ensureAsrEngineReady(): Promise<void> {
    if (!this.asrInitializationPromise) {
      this.primeAsrEngine();
    }

    await this.asrInitializationPromise;
  }

  private async initializeAsrEngine(generation = this.asrInitializationGeneration): Promise<void> {
    const engine = await initializeAsrEngine({
      dataDir: this.getDataDir(),
      settings: this.settingsStore.getSettings(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      hotwordManager: this.asrHotwordManager,
      hotwordContext: this.buildAsrHotwordContext(),
    });
    if (generation !== this.asrInitializationGeneration) {
      engine?.destroy();
      return;
    }
    this.asrEngine = engine;
    if (this.asrEngine) {
      console.log('ASR engine initialized', {
        runtime: this.getAsrModelStatusLabel(),
        model_loaded: Boolean(this.asrEngine.getModelPath()),
      });
    } else {
      console.warn('ASR engine is not configured for current settings');
    }
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

  private getStreamingEnhancementMode(settings: Settings): Settings['streaming_enhancement_mode'] {
    return settings.streaming_enhancement_mode === 'online_enhanced'
      ? 'online_enhanced'
      : 'offline_private';
  }

  private getStreamingEnhancementModeLabel(settings: Settings): string {
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return '非涉密增强模式';
      default:
        return '涉密离线模式';
    }
  }

  private getStreamingModeLabel(settings: Settings): string {
    return `${this.getStreamingModelLabel(settings)} · ${this.getStreamingEnhancementModeLabel(settings)}`;
  }

  private getStreamingModelLabel(settings: Settings): string {
    switch (settings.streaming_model) {
      case 'multilingual_segmented':
        return '多语分段流式';
      case 'zh_high_accuracy_realtime':
        return '中文高精度流式';
      default:
        return '多语实时流式';
    }
  }

  private getVoicePackageLabel(settings: Settings): string {
    return settings.voice_package === 'pro_high_accuracy'
      ? '增强本机识别'
      : '标准本机识别';
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
      runtime_mode_label: settings.recognition_mode === 'streaming_output'
        ? `流式输出 · ${this.getStreamingModeLabel(settings)}`
        : `整段识别 · ${this.getVoicePackageLabel(settings)}`,
      model_label: settings.recognition_mode === 'streaming_output'
        ? this.getStreamingModelLabel(settings)
        : this.getVoicePackageLabel(settings),
      model_status: this.getAsrModelStatusLabel(),
      model_path_label: this.asrEngine?.getModelDirectory() || 'not configured',
      compute_backend_label: this.asrEngine
        ? this.describeProvider(this.asrEngine.getActiveProvider())
        : '未配置',
      log_path: getLogFilePath(),
      show_permissions_panel: process.platform === 'darwin',
      show_microphone_settings: true,
      show_accessibility_settings: process.platform === 'darwin',
      show_input_monitoring_settings: process.platform === 'darwin',
      permissions_summary: process.platform === 'darwin'
        ? 'typetype 依赖麦克风、输入监听和辅助功能权限完成全局录音触发与自动回填。'
        : 'typetype 使用本机权限完成语音输入。',
      preload_status: this.preloadStatus,
    };
  }

  private async saveSettings(settings: Settings): Promise<UiSnapshot> {
    this.settingsStore.saveSettings(settings);
    const normalizedSettings = this.settingsStore.getSettings();
    this.registerShortcutsForSettings(normalizedSettings, 'settings-save');
    this.startShortcutWatchdog();
    this.stateMachine.applySettings(normalizedSettings);
    this.applyLoginItemSettings(normalizedSettings);
    this.asrEngine = null;
    this.translationAsrEngine = null;
    this.translationAsrInitializationPromise = null;
    this.preloadLlmStatus();
    this.preloadTranslationStatus();
    this.primeAsrEngine();
    this.tray?.setContextMenu(this.buildTrayMenu());
    const snapshot = this.stateMachine.snapshot();
    this.publishSnapshot(snapshot);
    this.publishSettingsViewData();
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
      name: WINDOWS_LOGIN_ITEM_NAME,
      path: process.execPath,
      args: openAtLogin ? ['--launch-at-login'] : [],
    });
    this.cleanupLegacyWindowsLoginItems();
  }

  private cleanupLegacyWindowsLoginItems(): void {
    if (process.platform !== 'win32') {
      return;
    }

    for (const valueName of WINDOWS_LEGACY_LOGIN_ITEM_NAMES) {
      spawnSync(
        'reg',
        [
          'delete',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          '/v',
          valueName,
          '/f',
        ],
        {
          stdio: 'ignore',
          windowsHide: true,
        }
      );
    }
  }

  private async runAsrDiagnostics(): Promise<AsrDiagnostics> {
    const settings = this.settingsStore.getSettings();
    const mode = settings.recognition_mode === 'streaming_output'
      ? `流式输出 · ${this.getStreamingModeLabel(settings)}`
      : `整段识别 · ${this.getVoicePackageLabel(settings)}`;
    const modelLabel = settings.recognition_mode === 'streaming_output'
      ? this.getStreamingModelLabel(settings)
      : this.getVoicePackageLabel(settings);
    const dictionaryStats = this.dictionaryStore.getViewData().stats;
    const punctuationStatus = this.localPunctuationEngine.getStatus();
    const punctuationDiagnostics = this.localPunctuationEngine.getDiagnostics();
    const runtimeDependencyStatus = this.runtimeDependencyManager.getStatus(
      punctuationDiagnostics.last_raw_error || punctuationDiagnostics.last_error
    );
    const diagnosticsBase = {
      itn_enabled: true,
      hotwords_supported: false,
      hotwords_enabled: false,
      hotwords_count: 0,
      hotwords_path: '',
      code_switch_lexicon_count: this.codeSwitchLexicon.getEntryCount(),
      dictionary_count: dictionaryStats.enabled,
      normalization_mode: '保守转换',
      punctuation_ready: punctuationStatus.ready,
      punctuation_available: punctuationStatus.available,
      punctuation_detail: punctuationStatus.detail,
      punctuation_runtime_native_dir: punctuationDiagnostics.native_dir,
      punctuation_runtime_binding_exists: punctuationDiagnostics.binding_exists,
      punctuation_runtime_dll_exists: punctuationDiagnostics.runtime_dll_exists,
      punctuation_directml_dll_exists: punctuationDiagnostics.directml_dll_exists,
      punctuation_last_error: punctuationDiagnostics.last_error,
      punctuation_last_raw_error: punctuationDiagnostics.last_raw_error,
      runtime_dependency_status: runtimeDependencyStatus.status,
      vc_redist_installed: runtimeDependencyStatus.vc_redist_installed,
      vc_redist_version: runtimeDependencyStatus.vc_redist_version,
      vc_redist_installer_exists: runtimeDependencyStatus.vc_redist_installer_exists,
      vc_redist_install_log: runtimeDependencyStatus.vc_redist_install_log,
    };

    try {
      const engine = await initializeAsrEngine({
        dataDir: this.getDataDir(),
        settings,
        processResourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        hotwordManager: this.asrHotwordManager,
        hotwordContext: this.buildAsrHotwordContext(),
      });

      if (!engine) {
        return {
          ok: false,
          mode,
          model_label: modelLabel,
          model_path: '未加载',
          backend: '未配置',
          runtime: '未配置',
          message: '没有找到匹配的模型目录或配置',
          ...diagnosticsBase,
        };
      }

      const hotwordStatus = engine.getHotwordStatus();
      return {
        ok: true,
        mode,
        model_label: modelLabel,
        model_path: engine.getModelDirectory() ? '已加载可用资源' : '未加载',
        backend: this.describeProvider(engine.getActiveProvider()),
        runtime: `已就绪 · ${this.describeProvider(engine.getActiveProvider())}`,
        message: '模型可加载，当前配置有效',
        ...diagnosticsBase,
        hotwords_supported: hotwordStatus.supported,
        hotwords_enabled: hotwordStatus.enabled,
        hotwords_count: hotwordStatus.count,
        hotwords_path: hotwordStatus.path ?? '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('ASR diagnostics failed:', error);
      const hotwordStatus = this.asrEngine?.getHotwordStatus();
      return {
        ok: false,
        mode,
        model_label: modelLabel,
        model_path: this.asrEngine?.getModelDirectory() ? '已加载可用资源' : '未加载',
        backend: this.asrEngine ? this.describeProvider(this.asrEngine.getActiveProvider()) : '未配置',
        runtime: this.asrEngine ? `已就绪 · ${this.describeProvider(this.asrEngine.getActiveProvider())}` : '未配置',
        message,
        ...diagnosticsBase,
        hotwords_supported: hotwordStatus?.supported ?? false,
        hotwords_enabled: hotwordStatus?.enabled ?? false,
        hotwords_count: hotwordStatus?.count ?? 0,
        hotwords_path: hotwordStatus?.path ?? '',
      };
    }
  }

  private async installRuntimeDependency(): Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }> {
    const result = this.runtimeDependencyManager.installVcRedist();
    if (result.ok) {
      this.localPunctuationEngine.reset();
      const runtimeStatus = this.runtimeDependencyManager.getStatus('');
      this.preloadStatus.punctuation = {
        status: 'ready',
        label: '本地断句增强',
        detail: runtimeStatus.user_message || result.message,
      };
      this.publishSettingsViewData();
      this.preloadPunctuationStatus({ keepReadyWhileChecking: true });
    }
    this.publishSettingsViewData();
    return result;
  }

  private async captureOutputTarget(): Promise<string | null> {
    try {
      const target = await this.autoPaste.captureFrontmostApp();
      if (this.isTypetypeWindowTarget(target)) {
        console.warn('Ignoring typetype window as auto-paste target');
        return null;
      }
      return target;
    } catch (error) {
      console.warn('Failed to capture output target:', error);
      return null;
    }
  }

  private isTypetypeWindowTarget(target: string | null): boolean {
    if (!target) {
      return false;
    }
    try {
      const parsed = JSON.parse(target) as { process?: string; title?: string };
      const processName = (parsed.process ?? '').toLowerCase();
      const title = (parsed.title ?? '').toLowerCase();
      return (
        processName.includes('typetype')
        || title.includes('typetype')
        || title.includes('type type')
        || title.includes('ai 整理')
        || title.includes('typetype 设置')
      );
    } catch {
      return false;
    }
  }

  private async startRecording(intent: CaptureIntent = 'dictation'): Promise<void> {
    if (!this.stateMachine.shouldStartRecording()) {
      return;
    }

    this.activeCaptureIntent = intent;
    this.previousAppBundleId = await this.captureOutputTarget();

    try {
      const settings = this.settingsStore.getSettings();
      this.streamingSessionId += 1;
      this.streamingChunkLogCount = 0;
      this.streamingPastedText = '';
      this.streamingPastedSourceText = '';
      this.streamingInsertionTransaction.reset(this.previousAppBundleId);
      this.streamingOutputText = '';
      this.streamingLatestText = '';
      this.streamingChunkQueue = Promise.resolve();
      this.streamingPastePendingText = '';
      this.streamingPasteInFlight = false;
      this.streamingAutoPasteSuspended = false;
      this.streamingPendingBoundaryPunctuation = false;
      this.streamingLastPasteAt = 0;
      this.streamingTailCorrectionLastAt = 0;
      this.streamingTailCorrectionInFlight = false;
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionSuspended = false;
      this.streamingPendingTailCorrection = null;
      this.streamingRealtimeTextProcessor.reset();
      this.resetStreamingCursorCommitState();
      this.streamingSegmenter = null;
      this.streamingAudioCache.reset();
      const recorderReadyPromise = process.platform === 'win32'
        ? this.ensureRecorderWindow()
        : Promise.resolve();
      const asrReadyPromise = this.shouldUseStreamingForIntent(intent)
        ? this.ensureAsrEngineReady()
        : Promise.resolve();
      if (this.shouldUseStreamingForIntent(intent)) {
        if (intent === 'dictation') {
          this.startStreamingAiPanelSession(settings);
        }
        await asrReadyPromise;
        if (!this.asrEngine) {
          throw this.asrInitializationError ?? new Error('ASR engine not initialized');
        }
        if (!this.isActiveSegmentedStreamingMode(settings)) {
          this.asrEngine.startStreamingSession();
        }
        this.streamingSegmenter = new StreamingSegmenter();
        console.log('Streaming ASR session started', {
          streaming_model: settings.streaming_model,
          segmented: this.isActiveSegmentedStreamingMode(settings),
        });
      }

      if (process.platform === 'win32') {
        await recorderReadyPromise;
        await new Promise<void>((resolve, reject) => {
          this.pendingRecorderStart = { resolve, reject };
          this.recorderWindow?.webContents.send('recorder_start', {
            microphoneId: settings.microphone_id,
          });
        });
      } else {
        const recordingsDir = path.join(this.getDataDir(), 'recordings');
        this.audioRecorder = new AudioRecorder(
          recordingsDir,
          settings.microphone_id
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
    console.log('Recording started', {
      mode: this.settingsStore.getSettings().recognition_mode,
      intent: this.activeCaptureIntent,
      streaming: this.shouldUseStreamingForActiveCapture(),
    });
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
    if (this.shouldUseStreamingForActiveCapture()) {
      await this.finishStreamingOutput();
      return;
    }

    this.beginTranscribing(audioChunk.samples);
  }

  private async stopWindowsRecording(): Promise<void> {
    if (!this.recorderWindow) {
      return;
    }

    const useStreamingOutput = this.shouldUseStreamingForActiveCapture();
    if (!useStreamingOutput) {
      this.stateMachine.beginTranscribing();
      this.updateTrayAnimation();
      this.showOverlayWindow();
      this.publishSnapshot();
    }

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

    if (useStreamingOutput) {
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
      const engine = await this.getAsrEngineForTranscription();
      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      const modelPath = engine?.getModelPath();
      if (!modelPath || !engine) {
        throw new Error('ASR engine not initialized');
      }

      const asrResult = await engine.transcribeRich(samples);
      const text = asrResult.text;

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
      const cleanedTranscript = this.cleanupTranscriptWithDictionary(text, settings);
      if (!cleanedTranscript) {
        this.hideOverlayWindow();
        this.stateMachine.dismissOverlay();
        this.updateTrayAnimation();
        this.publishSnapshot();
        return;
      }

      console.log('[translation-debug] transcript-ready', {
        intent: this.activeCaptureIntent,
        text_length: cleanedTranscript.length,
        language: asrResult.language,
        confidence: asrResult.confidence,
      });

      let finalText: string;
      if (this.activeCaptureIntent === 'translation') {
        finalText = await this.translateTranscript(cleanedTranscript);
      } else {
        const localFallback = await this.buildModelAssistedLocalChineseRewrite(cleanedTranscript, settings, true);
        const gateDecision = this.aiRewriteGate.decide({
          text: cleanedTranscript,
          settings,
          codeSwitch: this.codeSwitchLexicon.analyzeText(cleanedTranscript),
          final: true,
        });
        console.log('[ai-rewrite-gate] non-streaming decision', {
          should_run: gateDecision.shouldRun,
          reasons: gateDecision.reasons,
          text_length: cleanedTranscript.length,
        });
        const aiRewrite = gateDecision.shouldRun
          ? await this.rewriteWithLlm(cleanedTranscript)
          : null;
        finalText = aiRewrite
          || localFallback.rewrite.refinedRawText
          || this.applyFallbackPunctuation(cleanedTranscript, settings);
        finalText = this.stateMachine.finishOutput(finalText);
      }
      this.autoLearnFromTranscript(`${cleanedTranscript}\n${finalText}`, settings);
      console.log('[translation-debug] final-output-ready', {
        intent: this.activeCaptureIntent,
        text_length: finalText.length,
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
    const pasteResult = await this.autoPaste.pasteToApp(this.previousAppBundleId);
    if (pasteResult.ok) {
      this.stateMachine.markAutoPasteSuccess();
    } else {
      console.warn('Auto paste failed; transcript remains on clipboard', {
        error: pasteResult.error,
        target: pasteResult.targetAppId,
        foreground: pasteResult.foregroundAppId,
      });
    }
  }

  private isStreamingOutputMode(): boolean {
    return this.settingsStore.getSettings().recognition_mode === 'streaming_output';
  }

  private isSegmentedStreamingMode(settings: Settings = this.settingsStore.getSettings()): boolean {
    return settings.recognition_mode === 'streaming_output'
      && settings.streaming_model === 'multilingual_segmented';
  }

  private isActiveSegmentedStreamingMode(settings: Settings = this.settingsStore.getSettings()): boolean {
    return this.isSegmentedStreamingMode(settings)
      && this.asrEngine?.getRecognitionMode() === 'non_streaming';
  }

  private shouldUseStreamingForIntent(intent: CaptureIntent): boolean {
    return intent === 'dictation' && this.isStreamingOutputMode();
  }

  private shouldUseStreamingForActiveCapture(): boolean {
    return this.shouldUseStreamingForIntent(this.activeCaptureIntent);
  }

  private async getNonStreamingAsrEngine(): Promise<AsrEngine | null> {
    if (this.translationAsrEngine) {
      return this.translationAsrEngine;
    }

    if (!this.translationAsrInitializationPromise) {
      const settings = {
        ...this.settingsStore.getSettings(),
        recognition_mode: 'non_streaming' as const,
      };
      console.log('Initializing non-streaming ASR engine');
      this.translationAsrInitializationPromise = initializeAsrEngine({
        dataDir: this.getDataDir(),
        settings,
        processResourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        hotwordManager: this.asrHotwordManager,
        hotwordContext: this.buildAsrHotwordContext(),
      }).then((engine) => {
        this.translationAsrEngine = engine;
        if (engine) {
          console.log('Non-streaming ASR engine initialized', {
            runtime: engine.getRuntimeLabel(),
            modelPath: engine.getModelPath(),
            modelDirectory: engine.getModelDirectory(),
          });
        } else {
          console.warn('Non-streaming ASR engine is not configured');
        }
        return engine;
      }).finally(() => {
        this.translationAsrInitializationPromise = null;
      });
    }

    return this.translationAsrInitializationPromise;
  }

  private async getAsrEngineForTranscription(): Promise<AsrEngine | null> {
    if (this.activeCaptureIntent !== 'translation' || translationSupportsRecognitionMode(this.settingsStore.getSettings().recognition_mode)) {
      await this.ensureAsrEngineReady();
      return this.asrEngine;
    }

    return this.getNonStreamingAsrEngine();
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
      transcript_length: transcript.length,
    });

    const translated = await this.translationEngine.translate(
      transcript,
      settings.translation_target_language,
      [
        ...this.dictionaryStore.getMatchedTerms(transcript, 30),
        ...this.codeSwitchLexicon.getMatchedTerms(transcript, 30),
      ]
    );
    if (!translated) {
      throw new Error(`本地翻译没有返回 ${language.label} 文本。`);
    }

    console.log('[translation-debug] translate-result', {
      target_language: settings.translation_target_language,
      text_length: translated.length,
    });

    return this.stateMachine.finishOutput(translated);
  }

  private cleanupTranscriptWithDictionary(
    text: string,
    settings: Settings,
    options: { partial?: boolean } = {}
  ): string {
    const cleaned = cleanupTranscript(text, settings);
    const dictionaryApplied = this.dictionaryStore.applyToText(cleaned, options);
    const codeSwitchResult = this.codeSwitchLexicon.applyToText(dictionaryApplied, options);
    const normalized = this.normalizeTranscriptText(codeSwitchResult.text, settings, {
      ...options,
      extraPreserveTerms: codeSwitchResult.matchedTerms,
    });
    return applyVoiceFormattingCommands(normalized, {
      partial: options.partial,
      enabled: settings.voice_formatting_enabled,
    }).trim();
  }

  private cleanupStreamingRealtimeTranscript(text: string, settings: Settings): string {
    const cleaned = cleanupTranscript(text, settings);
    return applyVoiceFormattingCommands(cleaned, {
      partial: true,
      enabled: settings.voice_formatting_enabled,
    }).trim();
  }

  private normalizeTranscriptText(
    text: string,
    settings: Settings,
    options: { partial?: boolean; extraPreserveTerms?: string[] } = {}
  ): string {
    if (!text.trim()) {
      return text;
    }

    const preserveTerms = Array.from(new Set([
      ...this.dictionaryStore.getMatchedTerms(text, 80),
      ...this.codeSwitchLexicon.getMatchedTerms(text, 80),
      ...(options.extraPreserveTerms ?? []),
    ]));

    return this.textNormalizationEngine.normalize(text, {
      mode: options.partial
        ? 'streaming_partial'
        : settings.recognition_mode === 'streaming_output'
          ? 'streaming_final'
          : 'non_streaming',
      strength: 'conservative',
      preserveTerms,
    });
  }

  private applyFallbackPunctuation(text: string, settings: Settings): string {
    if (settings.voice_formatting_enabled && text.includes('\n')) {
      return text
        .split('\n')
        .map((line) => line.trim() ? applyBasicTranscriptPunctuation(line) : '')
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    }

    return applyBasicTranscriptPunctuation(text);
  }

  private getStreamingRewriteSettings(settings: Settings): Settings {
    return {
      ...settings,
      rewrite_scenario: this.streamingRewriteScenario || settings.rewrite_scenario || 'general',
    };
  }

  private buildLocalChineseRewrite(
    text: string,
    settings: Settings,
    final = false
  ): LocalChineseRewriteResult {
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings, { partial: !final });
    const dictionaryTerms = this.dictionaryStore.getMatchedTerms(cleanText, 60);
    const codeSwitchTerms = this.codeSwitchLexicon.getMatchedTerms(cleanText, 60);
    return rewriteChineseLocally({
      rawText: cleanText,
      scenario: settings.rewrite_scenario,
      preserveTerms: [...dictionaryTerms, ...codeSwitchTerms],
      final,
    });
  }

  private async buildModelAssistedLocalChineseRewrite(
    text: string,
    settings: Settings,
    final = false
  ): Promise<{
    rewrite: LocalChineseRewriteResult;
    source: 'model' | 'rules';
    statusText: string;
    error?: string;
  }> {
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings, { partial: !final });
    const fallbackRewrite = this.buildLocalChineseRewrite(cleanText, settings, final);
    const punctuationResult = await this.semanticPunctuationEngine.restorePunctuation(cleanText, {
      final,
      preserveTerms: fallbackRewrite.preserveTerms,
    });
    const punctuationText = stripUnknownTokens(punctuationResult.text);

    if (punctuationResult.source === 'model' && punctuationText.trim()) {
      const modelRewrite = rewriteChineseLocally({
        rawText: punctuationText,
        scenario: settings.rewrite_scenario,
        preserveTerms: fallbackRewrite.preserveTerms,
        final,
      });
      const refinedRawText = sanitizeStreamingAiText(modelRewrite.refinedRawText)
        || sanitizeStreamingAiText(punctuationText)
        || fallbackRewrite.refinedRawText;
      const normalizedRefinedRawText = this.normalizeTranscriptText(refinedRawText, settings, { partial: !final });
      const normalizedStructuredText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(modelRewrite.structuredText),
        settings,
        { partial: !final }
      );
      return {
        rewrite: {
          ...modelRewrite,
          refinedRawText: normalizedRefinedRawText,
          structuredText: normalizedStructuredText || modelRewrite.structuredText,
          preserveTerms: fallbackRewrite.preserveTerms,
        },
        source: 'model',
        statusText: final
          ? '本地断句模型已完成最终整理，不联网。'
          : '本地断句模型已完成稳定片段整理，不联网。',
      };
    }

    return {
      rewrite: fallbackRewrite,
      source: 'rules',
      statusText: punctuationResult.error
        ? this.getPunctuationFallbackStatusText(punctuationResult.error)
        : '本地规则整理已完成，不联网。',
      error: punctuationResult.error,
    };
  }

  private getPunctuationFallbackStatusText(error: string): string {
    if (error) {
      void this.maybePromptRuntimeDependencyRepair(error);
    }
    return this.runtimeDependencyManager.getUserFacingPunctuationMessage(error);
  }

  private async maybePromptRuntimeDependencyRepair(error: string): Promise<void> {
    if (
      this.runtimeDependencyPromptSuppressed
      || this.runtimeDependencyPromptShown
      || this.runtimeDependencyPromptInFlight
      || !this.runtimeDependencyManager.isRuntimeEnvironmentError(error)
    ) {
      return;
    }

    const runtimeStatus = this.runtimeDependencyManager.getStatus(error);
    if (!runtimeStatus.can_install) {
      return;
    }

    this.runtimeDependencyPromptShown = true;
    this.runtimeDependencyPromptInFlight = true;
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '系统运行库需要修复',
        message: '检测到本机缺少或损坏系统运行库，已自动使用基础断句。',
        detail: '点击安装/修复后可启用更好的断句效果。安装过程中可能出现 Windows 权限确认。',
        buttons: ['立即安装', '稍后', '本次不再提醒'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (result.response === 2) {
        this.runtimeDependencyPromptSuppressed = true;
        return;
      }
      if (result.response === 0) {
        const installResult = await this.installRuntimeDependency();
        await dialog.showMessageBox({
          type: installResult.ok ? 'info' : 'error',
          title: installResult.ok ? '系统运行库已处理' : '系统运行库安装失败',
          message: installResult.message,
          detail: installResult.log_path ? `安装日志：${installResult.log_path}` : '',
          buttons: ['知道了'],
          noLink: true,
        });
      }
    } catch (promptError) {
      console.error('Runtime dependency prompt failed:', promptError);
    } finally {
      this.runtimeDependencyPromptInFlight = false;
    }
  }

  private autoLearnFromTranscript(text: string, settings: Settings): void {
    const result = this.dictionaryStore.autoLearnFromText(text, settings.auto_learning_enabled);
    if (result.learned === 0) {
      return;
    }

    console.log('[dictionary] auto learned local terms', {
      count: result.learned,
      terms: result.terms,
    });
    this.publishSettingsViewData();
  }

  private cancelStreamingOutputSession(reason: string): void {
    this.streamingSessionId += 1;
    this.asrEngine?.cancelStreamingSession();
    this.streamingLatestText = '';
    this.streamingPastedText = '';
    this.streamingPastedSourceText = '';
    this.streamingInsertionTransaction.reset(this.previousAppBundleId);
    this.streamingOutputText = '';
    this.streamingPastePendingText = '';
    this.streamingPasteInFlight = false;
    this.streamingAutoPasteSuspended = false;
    this.streamingPendingBoundaryPunctuation = false;
    this.streamingLastPasteAt = 0;
    this.streamingTailCorrectionLastAt = 0;
    this.streamingTailCorrectionInFlight = false;
    this.streamingTailReplacementActive = false;
    this.streamingTailCorrectionSuspended = false;
    this.streamingPendingTailCorrection = null;
    this.streamingRealtimeTextProcessor.reset();
    this.resetStreamingCursorCommitState();
    this.streamingAudioCache.reset();
    this.streamingSegmenter?.reset();
    this.streamingSegmenter = null;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiLastSubmittedText = '';
    if (this.streamingAiState.active) {
      this.patchStreamingAiPanelState({
        active: false,
        status: 'idle',
        status_text: '本次流式记录已结束。',
        can_apply_refined_raw: false,
      }, { immediate: true });
    }
    console.log('Streaming ASR session cancelled', { reason });
  }

  private resetStreamingCursorCommitState(): void {
    this.streamingCursorCommitState = {
      committedText: '',
      committedSourceText: '',
      committedAt: 0,
      sessionId: this.streamingSessionId,
    };
    this.streamingPendingAiReviewAfterCommit = false;
  }

  private getStreamingCommittedText(): string {
    return this.streamingInsertionTransaction.getInsertedText()
      || this.streamingCursorCommitState.committedText
      || '';
  }

  private commitStreamingCursorText(
    committedText: string,
    committedSourceText: string,
    sessionId: number,
    settings: Settings
  ): void {
    if (sessionId !== this.streamingSessionId || !committedText) {
      return;
    }

    const committedAt = Date.now();
    this.streamingCursorCommitState = {
      committedText,
      committedSourceText,
      committedAt,
      sessionId,
    };
    this.streamingPastedText = committedText;
    this.streamingPastedSourceText = committedSourceText || this.streamingPastedSourceText;
    if (!this.streamingPastePendingText) {
      this.streamingOutputText = committedText;
    }

    this.updateStreamingAiRawText(committedText, settings, { immediate: true });
    console.log('Streaming cursor text committed before panel update', {
      sessionId,
      committed_length: Array.from(committedText).length,
      cursor_commit_at: committedAt,
      panel_update_after_commit: true,
    });

    if (this.streamingPendingAiReviewAfterCommit) {
      this.streamingPendingAiReviewAfterCommit = false;
      this.queueStreamingAiReview(committedText, settings);
    }
  }

  private async rewriteWithLlm(text: string): Promise<string | null> {
    const settings = this.settingsStore.getSettings();
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings);

    if (!settings.llm_rewrite?.enabled) {
      return null;
    }

    this.stateMachine.beginPolishing();
    this.updateTrayAnimation();
    this.publishSnapshot();

    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanText, settings, true);
    const localRewrite = localRewriteResult.rewrite;
    const apiInput = [
      '请基于以下语音转写和本地规则预处理结果进行最终结构化润写。',
      '如果本地规则判断有误，以原始转写为准；不得新增原文没有的事实、数据、机关、日期或责任人。',
      '原文中的英文、缩写、品牌、App、代码术语和中英/粤英/台式混输表达必须保留为原语言，不要翻译成中文。',
      `本地预处理来源：${localRewriteResult.source === 'model' ? '离线标点恢复模型 + 本地规则' : '本地规则兜底'}`,
      '',
      '<原始转写>',
      cleanText,
      '</原始转写>',
      '',
      buildLocalRewritePromptContext(localRewrite),
    ].join('\n');

    try {
      const result = await rewriteWithPreferredLlm(apiInput, settings, {
        preserveTerms: localRewrite.preserveTerms,
        scenario: settings.rewrite_scenario,
        voiceFormattingEnabled: settings.voice_formatting_enabled,
      });

      return this.normalizeTranscriptText(
        sanitizeStreamingAiText(result.polishedText || localRewrite.structuredText || localRewrite.refinedRawText),
        settings
      );
    } catch (error) {
      console.error('LLM rewrite failed; falling back to local punctuation rewrite:', error);
      return this.normalizeTranscriptText(
        sanitizeStreamingAiText(localRewrite.structuredText || localRewrite.refinedRawText),
        settings
      );
    }
  }

  private startStreamingAiPanelSession(settings: Settings): void {
    this.streamingRewriteScenario = settings.rewrite_scenario || 'general';
    if (!settings.streaming_ai_panel_enabled) {
      this.patchStreamingAiPanelState({
        enabled: false,
        active: false,
        status: 'idle',
        status_text: '流式 AI 整理面板未开启。',
        rewrite_scenario: this.streamingRewriteScenario,
        rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
        refined_raw_text: '',
        can_apply_refined_raw: false,
        apply_status_text: null,
      }, { immediate: true });
      return;
    }

    this.streamingAiSubmittedRawLength = 0;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiInFlight = false;
    this.streamingAiLastRequestAt = 0;
    this.streamingAiLastSubmittedText = '';
    this.showStreamingAiPanel(false);
    const modeLabel = this.getStreamingModeLabel(settings);
    this.patchStreamingAiPanelState({
      enabled: true,
      active: true,
      status: 'recording',
      status_text: this.getStreamingPanelStatusText(settings),
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: '',
      refined_raw_text: '',
      ai_text: '',
      can_apply_refined_raw: false,
      apply_status_text: null,
      mode_label: modeLabel,
      ai_status_label: this.getStreamingAiStatusLabel(settings),
      last_review_at: null,
      last_error: null,
    }, { immediate: true });
  }

  private canUseStreamingAi(settings: Settings): boolean {
    return Boolean(
      settings.streaming_ai_panel_enabled
      && this.getStreamingEnhancementMode(settings) === 'online_enhanced'
      && settings.llm_rewrite?.enabled
      && settings.llm_rewrite.api_key?.trim()
    );
  }

  private getStreamingPanelStatusText(settings: Settings): string {
    const outputStyle = settings.streaming_model === 'multilingual_segmented'
      ? '短暂停顿后输出稳定片段'
      : '光标处继续实时输出原文';
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return this.canUseStreamingAi(settings)
          ? `非涉密增强模式：${outputStyle}，停顿后面板生成 AI 修正原文和整理稿。`
          : `非涉密增强模式：${outputStyle}；LLM 未启用或 API Key 未填写，面板先显示本地草稿。`;
      default:
        return `涉密离线模式：${outputStyle}，面板只做本地断句和终稿校准，不调用 API。`;
    }
  }

  private getStreamingAiStatusLabel(settings: Settings): string {
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return this.canUseStreamingAi(settings) ? 'API 稳定片段纠错已就绪' : 'API 未配置，暂用本地草稿';
      default:
        return '离线标点模型 + 本地结构化，不联网';
    }
  }

  private updateStreamingAiRawText(
    text: string,
    settings: Settings,
    options: { immediate?: boolean } = {}
  ): void {
    if (!settings.streaming_ai_panel_enabled) {
      return;
    }

    const streamingSettings = this.getStreamingRewriteSettings(settings);
    const cleanText = this.cleanupStreamingRealtimeTranscript(stripUnknownTokens(text), streamingSettings);
    const modeLabel = this.getStreamingModeLabel(streamingSettings);
    this.patchStreamingAiPanelState({
      active: true,
      status: this.streamingAiInFlight ? 'thinking' : 'recording',
      status_text: this.streamingAiInFlight
        ? 'AI 正在整理稳定片段，光标处原文会继续实时输出。'
        : this.getStreamingPanelStatusText(streamingSettings),
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: cleanText,
      refined_raw_text: '',
      can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanText).trim()),
      mode_label: modeLabel,
      ai_status_label: this.getStreamingAiStatusLabel(streamingSettings),
      last_error: null,
    }, { immediate: Boolean(options.immediate) });
  }

  private shouldRunStreamingAiReview(
    displayText: string,
    newSegmentLength: number,
    final: boolean,
    now: number,
    settings: Settings
  ): boolean {
    const gateDecision = this.aiRewriteGate.decide({
      text: displayText,
      settings,
      codeSwitch: this.codeSwitchLexicon.analyzeText(displayText),
      final,
    });

    if (final) {
      console.log('[ai-rewrite-gate] streaming final decision', {
        should_run: gateDecision.shouldRun,
        reasons: gateDecision.reasons,
        text_length: displayText.length,
      });
      return gateDecision.shouldRun;
    }

    if (!displayText.trim() || displayText === this.streamingAiLastSubmittedText) {
      return false;
    }

    const cooledDown = now - this.streamingAiLastRequestAt >= STREAMING_AI_FAST_COOLDOWN_MS;
    if (!cooledDown) {
      return false;
    }

    const endsLikeStablePhrase = /[。！？!?；;\n]$/u.test(displayText.trim());
    const hasLongEnoughDelta = newSegmentLength >= STREAMING_AI_FAST_MIN_CHARS;
    const hasEnoughStablePhrase = endsLikeStablePhrase && newSegmentLength >= 8;
    const hasLongContext = displayText.length >= STREAMING_AI_MIN_CHARS && newSegmentLength >= 12;
    const enoughStreamingContext = hasLongEnoughDelta || hasEnoughStablePhrase || hasLongContext;
    return enoughStreamingContext && gateDecision.shouldRun;
  }

  private queueStreamingAiReview(rawText: string, settings: Settings, final = false): void {
    if (!settings.streaming_ai_panel_enabled) {
      return;
    }

    const streamingSettings = this.getStreamingRewriteSettings(settings);
    const displayText = stripUnknownTokens(this.buildStreamingRawDisplayText(rawText, {
      preferCommitted: !final,
    }));
    this.updateStreamingAiRawText(displayText, streamingSettings);

    if (!this.canUseStreamingAi(streamingSettings)) {
      void this.updateLocalStreamingAiDraft(displayText, streamingSettings, final);
      return;
    }

    const newSegmentLength = Math.max(0, displayText.length - this.streamingAiSubmittedRawLength);
    const now = Date.now();
    if (!this.shouldRunStreamingAiReview(displayText, newSegmentLength, final, now, streamingSettings)) {
      if (final) {
        void this.updateLocalStreamingAiDraft(displayText, streamingSettings, final);
      }
      return;
    }

    if (this.streamingAiInFlight) {
      this.streamingAiPendingRawText = displayText;
      this.streamingAiPendingFinal = this.streamingAiPendingFinal || final;
      return;
    }

    void this.runStreamingAiReview(displayText, streamingSettings, final);
  }

  private buildStreamingRawDisplayText(
    currentText: string,
    options: { preferCommitted?: boolean } = {}
  ): string {
    const preferCommitted = options.preferCommitted !== false;
    const committedText = stripUnknownTokens(this.getStreamingCommittedText()).trim();
    if (preferCommitted && committedText) {
      return committedText;
    }

    const candidates = [
      currentText,
      committedText,
      this.streamingOutputText,
      this.streamingPastedText,
      this.streamingPastedSourceText,
      this.streamingLatestText,
    ].map((value) => stripUnknownTokens(value).trim()).filter(Boolean);

    return candidates[0] ?? '';
  }

  private async updateLocalStreamingAiDraft(rawText: string, settings: Settings, final = false): Promise<void> {
    const cleanRawText = this.normalizeTranscriptText(stripUnknownTokens(rawText), settings, { partial: !final });
    if (!settings.streaming_ai_panel_enabled || !cleanRawText.trim()) {
      return;
    }

    const sessionId = this.streamingSessionId;
    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanRawText, settings, final);
    if (sessionId !== this.streamingSessionId) {
      return;
    }
    const localRewrite = localRewriteResult.rewrite;
    const refinedRawText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(final ? localRewrite.refinedRawText : localRewrite.refinedRawText.replace(/[。.]$/u, '')),
      settings,
      { partial: !final }
    );
    const structuredText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(localRewrite.structuredText),
      settings,
      { partial: !final }
    );
    this.patchStreamingAiPanelState({
      active: true,
      status: final ? 'ready' : 'recording',
      status_text: final ? '最终整理稿已生成。' : this.getStreamingPanelStatusText(settings),
      rewrite_scenario: settings.rewrite_scenario,
      rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
      refined_raw_text: refinedRawText,
      ai_text: structuredText,
      can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
      mode_label: this.getStreamingModeLabel(settings),
      ai_status_label: localRewriteResult.source === 'model'
        ? '离线标点模型 + 本地结构化，不联网'
        : this.getStreamingAiStatusLabel(settings),
      last_review_at: final ? new Date().toISOString() : this.streamingAiState.last_review_at,
      last_error: localRewriteResult.error ?? null,
    }, { immediate: final });
  }

  private async refineStreamingFinalWithOfflineAsr(
    fallbackText: string,
    settings: Settings
  ): Promise<string> {
    const isSegmentedStreaming = this.isActiveSegmentedStreamingMode(settings);
    if (!isSegmentedStreaming && this.getStreamingEnhancementMode(settings) !== 'offline_private') {
      return fallbackText;
    }

    if (this.streamingAudioCache.wasTruncated()) {
      console.log('Skipping offline final ASR refinement because streaming audio is using rolling cache');
      return fallbackText;
    }

    const samples = this.getStreamingAudioSamples();
    if (samples.length < 16000) {
      return fallbackText;
    }

    try {
      const offlineEngine = isSegmentedStreaming && this.asrEngine?.getRecognitionMode() === 'non_streaming'
        ? this.asrEngine
        : await this.getNonStreamingAsrEngine();
      if (!offlineEngine) {
        return fallbackText;
      }

      const refined = await offlineEngine.transcribe(samples);
      const cleaned = this.cleanupTranscriptWithDictionary(refined, settings);
      return cleaned || fallbackText;
    } catch (error) {
      console.warn('Offline streaming final refinement failed:', error);
      return fallbackText;
    }
  }

  private async runStreamingAiReview(rawText: string, settings: Settings, final: boolean): Promise<void> {
    if (!this.canUseStreamingAi(settings)) {
      return;
    }

    const cleanRawText = this.normalizeTranscriptText(stripUnknownTokens(rawText), settings, { partial: !final });
    const sessionId = this.streamingSessionId;
    const previousSummary = this.streamingAiState.ai_text.trim();
    const newSegment = cleanRawText.slice(this.streamingAiSubmittedRawLength).trim();
    if (!newSegment && !final) {
      return;
    }
    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanRawText, settings, final);
    const localRewrite = localRewriteResult.rewrite;

    this.streamingAiInFlight = true;
    this.streamingAiLastRequestAt = Date.now();
    this.streamingAiSubmittedRawLength = cleanRawText.length;
    this.streamingAiLastSubmittedText = cleanRawText;
    this.patchStreamingAiPanelState({
      active: true,
      status: 'thinking',
      status_text: final ? '正在生成最终整理稿，原文已保留。' : '检测到停顿，AI 正在整理新增片段。',
      rewrite_scenario: settings.rewrite_scenario,
      rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
      mode_label: this.getStreamingModeLabel(settings),
      ai_status_label: 'API 正在纠错整理稳定片段',
      last_error: null,
    }, { immediate: final });

    try {
      const prompt = this.buildStreamingAiPrompt({
        previousSummary,
        rawText: cleanRawText,
        newSegment,
        final,
        scenario: settings.rewrite_scenario,
        localRewrite,
        localRewriteSource: localRewriteResult.source,
      });
      const result = await rewriteWithPreferredLlm(prompt, settings, {
        preserveTerms: localRewrite.preserveTerms,
        scenario: settings.rewrite_scenario,
        voiceFormattingEnabled: settings.voice_formatting_enabled,
      });

      if (sessionId !== this.streamingSessionId) {
        return;
      }

      const parsed = parseStreamingAiResult(result.polishedText || localRewrite.structuredText, localRewrite.refinedRawText);
      const refinedRawText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(parsed.refinedRawText || localRewrite.refinedRawText),
        settings,
        { partial: !final }
      );
      const summaryText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(parsed.summaryText || localRewrite.structuredText || previousSummary || newSegment),
        settings,
        { partial: !final }
      );
      this.patchStreamingAiPanelState({
        status: 'ready',
        status_text: final ? '最终整理稿已生成。' : '整理稿已更新；可以继续说。',
        rewrite_scenario: settings.rewrite_scenario,
        rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
        refined_raw_text: refinedRawText,
        ai_text: summaryText,
        can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
        mode_label: this.getStreamingModeLabel(settings),
        ai_status_label: 'API 纠错整理已完成',
        last_review_at: new Date().toISOString(),
        last_error: null,
      }, { immediate: true });

      if (
        final
        && settings.auto_paste
        && refinedRawText
        && this.streamingInsertionTransaction.hasInsertedText()
        && refinedRawText !== this.streamingInsertionTransaction.getInsertedText()
      ) {
        const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
          refinedRawText,
          this.previousAppBundleId
        );
        if (replaceResult.status === 'replaced') {
          this.streamingPastedText = refinedRawText;
          this.streamingOutputText = refinedRawText;
          this.streamingPastedSourceText = refinedRawText;
          this.patchStreamingAiPanelState({
            apply_status_text: 'AI 修正原文已后台替换到光标处。',
            status_text: '最终整理稿已生成，AI 修正原文已后台替换。',
            last_error: null,
          }, { immediate: true });
        } else if (replaceResult.status !== 'no_inserted_text') {
          this.patchStreamingAiPanelState({
            apply_status_text: replaceResult.status === 'clipboard_changed'
              ? '检测到剪贴板已有新内容，AI 修正原文未后台替换。'
              : 'AI 修正原文已生成，但目标窗口未完成后台替换。',
            last_error: replaceResult.error ?? replaceResult.status,
          }, { immediate: true });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[streaming-ai] review failed:', error);
      this.patchStreamingAiPanelState({
        status: 'ready',
        status_text: `API 整理失败，已回退${localRewriteResult.source === 'model' ? '离线断句模型整理稿' : '本地规则整理稿'}。`,
        rewrite_scenario: settings.rewrite_scenario,
        rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
        refined_raw_text: this.normalizeTranscriptText(sanitizeStreamingAiText(localRewrite.refinedRawText), settings, { partial: !final }),
        ai_text: this.normalizeTranscriptText(sanitizeStreamingAiText(localRewrite.structuredText), settings, { partial: !final }),
        can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
        mode_label: this.getStreamingModeLabel(settings),
        ai_status_label: localRewriteResult.source === 'model'
          ? 'API 整理失败，已使用离线断句模型'
          : 'API 整理失败，已使用本地规则',
        last_error: message,
      }, { immediate: true });
    } finally {
      this.streamingAiInFlight = false;
      const pendingRawText = this.streamingAiPendingRawText;
      const pendingFinal = this.streamingAiPendingFinal;
      this.streamingAiPendingRawText = null;
      this.streamingAiPendingFinal = false;

      if (pendingRawText && pendingRawText.length > this.streamingAiSubmittedRawLength) {
        this.queueStreamingAiReview(pendingRawText, this.settingsStore.getSettings(), pendingFinal);
      }
    }
  }

  private buildStreamingAiPrompt(input: {
    previousSummary: string;
    rawText: string;
    newSegment: string;
    final: boolean;
    scenario: Settings['rewrite_scenario'];
    localRewrite: LocalChineseRewriteResult;
    localRewriteSource: 'model' | 'rules';
  }): string {
    const finalInstruction = input.final
      ? '这是停止录音后的最终整理，请输出完整、清晰、可直接复制使用的最终稿。'
      : '这是流式录音中的一次停顿整理，请基于完整原文、已有整理稿和新增片段，输出更新后的修正原文与整理稿。';
    const scenarioLabel = getRewriteScenarioLabel(input.scenario);
    const scenarioPrompt = getRewriteScenarioPrompt(input.scenario);
    const rawText = stripUnknownTokens(input.rawText);
    const newSegment = stripUnknownTokens(input.newSegment);
    const previousSummary = sanitizeStreamingAiText(input.previousSummary);
    const localRewriteContext = stripUnknownTokens(buildLocalRewritePromptContext(input.localRewrite));

    return [
      '请作为专业语音转文字结构化整理助手工作。',
      finalInstruction,
      `当前清洗类型：${scenarioLabel}`,
      `类型要求：${scenarioPrompt}`,
      '总要求：纠正明显错字和口误；补齐自然标点；保留所有关键信息、数据、结论、条件、时间、地点、人物、待办和限制；不要编造未说出的事实。',
      '原文里的英文、缩写、品牌、App、代码术语和中英/粤英/台式混输表达必须保留原写法，不要翻译成中文。',
      '左侧“AI修正原文”只做轻纠错、标点和语序微调，不要改成会议纪要，不要删减关键信息。',
      '右侧“整理稿”按当前清洗类型成稿，可以重排结构，但不得遗漏原文实质内容；公文和正式文档缺少的机关、日期、编号等不要编造，可写“待补充”。',
      '下面提供了本地规则预处理结果。请优先吸收本地断句、术语保护和结构提纲；如果本地规则明显误判，以完整实时原文为准。',
      `本地预处理来源：${input.localRewriteSource === 'model' ? '离线标点恢复模型 + 本地规则' : '本地规则兜底'}。`,
      '输出必须是纯文本，可直接粘贴到 Word/WPS/微信；不要 Markdown；不要 **、__、```、- 项目符号、横线；不要输出“当前状态、功能介绍、功能特点、演示说明、处理说明”。',
      '请严格按下面两个标题输出，标题后直接给正文：',
      'AI修正原文：',
      '整理稿：',
      '',
      localRewriteContext,
      '',
      '<已有整理稿>',
      previousSummary || '（暂无）',
      '</已有整理稿>',
      '',
      '<完整实时原文>',
      rawText || '（暂无）',
      '</完整实时原文>',
      '',
      '<新增稳定原文片段>',
      newSegment || '（本次没有新增片段，请基于已有整理稿做最终整理。）',
      '</新增稳定原文片段>',
    ].join('\n');
  }

  private shouldFlushStreamingPaste(delta: string, completedSpeechSegment: boolean, now: number): boolean {
    if (!delta || this.streamingAutoPasteSuspended) {
      return false;
    }

    if (completedSpeechSegment) {
      return true;
    }

    const inStartupWindow = Array.from(this.streamingPastedText).length < STREAMING_PASTE_STARTUP_WINDOW_CHARS;
    const minChars = inStartupWindow ? STREAMING_PASTE_INITIAL_CHARS : STREAMING_PASTE_MIN_CHARS;
    const minInterval = inStartupWindow ? STREAMING_PASTE_INITIAL_INTERVAL_MS : STREAMING_PASTE_MIN_INTERVAL_MS;
    return delta.length >= minChars || now - this.streamingLastPasteAt >= minInterval;
  }

  private enqueueStreamingPaste(pasteText: string, sourceText: string, sessionId: number): void {
    if (!pasteText) {
      return;
    }

    this.streamingPastePendingText += pasteText;
    this.streamingOutputText += pasteText;
    this.streamingPastedText += pasteText;
    this.streamingPastedSourceText = sourceText;
    this.streamingLastPasteAt = Date.now();
    void this.flushStreamingPasteQueue(sessionId);
  }

  private async flushStreamingPasteQueue(sessionId: number): Promise<void> {
    if (this.streamingPasteInFlight || this.streamingTailReplacementActive) {
      return;
    }

    this.streamingPasteInFlight = true;
    try {
      while (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        const text = this.streamingPastePendingText;
        this.streamingPastePendingText = '';
        const useFastStreamingAppend = this.streamingInsertionTransaction.hasInsertedText();
        const result = await this.streamingInsertionTransaction.pasteAppendWithOptions(
          text,
          this.streamingPastedSourceText,
          this.previousAppBundleId,
          { fast: useFastStreamingAppend }
        );
        if (result.status !== 'pasted') {
          this.streamingAutoPasteSuspended = true;
          this.streamingPastePendingText = '';
          this.streamingPastedText = this.streamingInsertionTransaction.getInsertedText();
          this.streamingOutputText = this.streamingInsertionTransaction.getInsertedText();
          this.streamingPastedSourceText = this.streamingInsertionTransaction.getSourceText();
          await this.autoPaste.writeClipboard(this.streamingLatestText || this.streamingPastedSourceText || text);
          this.patchStreamingAiPanelState({
            apply_status_text: '目标输入框未接住实时输出，已暂停自动追加；最新识别内容已保存在剪贴板。',
            status_text: '自动回填暂停，请点回微信输入框后手动粘贴或重新开始。',
            last_error: result.error ?? 'streaming_paste_failed',
          }, { immediate: true });
          break;
        }

        const settings = this.settingsStore.getSettings();
        const committedText = result.insertedText || this.streamingInsertionTransaction.getInsertedText();
        this.commitStreamingCursorText(
          committedText,
          this.streamingPastedSourceText,
          sessionId,
          settings
        );
      }
    } catch (error) {
      console.error('Streaming paste queue failed:', error);
      this.streamingAutoPasteSuspended = true;
      this.streamingPastePendingText = '';
      await this.autoPaste.writeClipboard(this.streamingLatestText || this.streamingPastedSourceText || this.streamingOutputText);
      this.patchStreamingAiPanelState({
        apply_status_text: '实时输出失败，已暂停自动追加；识别内容仍在剪贴板。',
        status_text: '自动回填暂停，请点回目标输入框后手动粘贴。',
        last_error: error instanceof Error ? error.message : String(error),
      }, { immediate: true });
    } finally {
      this.streamingPasteInFlight = false;
      if (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        void this.flushStreamingPasteQueue(sessionId);
      }
    }
  }

  private async waitForStreamingPasteQueueToDrain(sessionId: number): Promise<void> {
    while (sessionId === this.streamingSessionId && (this.streamingPasteInFlight || this.streamingPastePendingText)) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  private async waitForStreamingTailCorrectionToDrain(sessionId: number): Promise<void> {
    while (sessionId === this.streamingSessionId && this.streamingTailCorrectionInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  private scheduleStreamingTailCorrection(correction: StreamingTailCorrection | null, sessionId: number): void {
    if (
      !correction
      || this.streamingTailCorrectionSuspended
      || this.streamingAutoPasteSuspended
    ) {
      return;
    }

    const now = Date.now();
    if (now - this.streamingTailCorrectionLastAt < STREAMING_TAIL_CORRECTION_MIN_INTERVAL_MS) {
      this.streamingPendingTailCorrection = correction;
      return;
    }

    if (this.streamingTailCorrectionInFlight) {
      this.streamingPendingTailCorrection = correction;
      return;
    }

    this.streamingTailCorrectionInFlight = true;
    this.streamingTailCorrectionLastAt = now;
    void this.applyStreamingTailCorrection(correction, sessionId);
  }

  private async applyStreamingTailCorrection(
    correction: StreamingTailCorrection,
    sessionId: number
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.waitForStreamingPasteQueueToDrain(sessionId);
      if (sessionId !== this.streamingSessionId || this.streamingTailCorrectionSuspended) {
        return;
      }

      this.streamingTailReplacementActive = true;
      const replaceResult = await this.streamingInsertionTransaction.replaceInsertedTailText(
        correction.replacementText,
        correction.charsToReplace,
        this.previousAppBundleId
      );
      if (replaceResult.status === 'replaced') {
        this.streamingPastedText = replaceResult.insertedText;
        this.streamingOutputText = replaceResult.insertedText;
        this.streamingLatestText = correction.correctedRealtimeText;
        this.streamingRealtimeTextProcessor.acceptAppliedText(correction.correctedRealtimeText);
        this.commitStreamingCursorText(
          replaceResult.insertedText,
          correction.correctedRealtimeText,
          sessionId,
          this.settingsStore.getSettings()
        );
        console.log('Streaming tail correction replaced recent text', {
          chars_replaced: replaceResult.charsReplaced,
          replacement_length: Array.from(correction.replacementText).length,
          elapsed_ms: Date.now() - startedAt,
        });
      } else if (replaceResult.status !== 'no_inserted_text') {
        this.streamingTailCorrectionSuspended = true;
        console.warn('Streaming tail correction suspended', {
          status: replaceResult.status,
          error: replaceResult.error,
          elapsed_ms: Date.now() - startedAt,
        });
      }
    } catch (error) {
      this.streamingTailCorrectionSuspended = true;
      console.warn('Streaming tail correction failed:', error);
    } finally {
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionInFlight = false;
      const pending = this.streamingPendingTailCorrection;
      this.streamingPendingTailCorrection = null;
      if (pending && sessionId === this.streamingSessionId && !this.streamingTailCorrectionSuspended) {
        this.scheduleStreamingTailCorrection(pending, sessionId);
      }
      if (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        void this.flushStreamingPasteQueue(sessionId);
      }
    }
  }

  private handleRecordingSamples(samples: Float32Array): void {
    if (!this.shouldUseStreamingForActiveCapture() || this.stateMachine.getStatus() !== 'recording') {
      return;
    }
    const audioCacheStats = this.streamingAudioCache.append(samples);
    this.streamingChunkLogCount += 1;
    if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0) {
      console.log('Streaming ASR chunk received', {
        samples: samples.length,
        sessionId: this.streamingSessionId,
        count: this.streamingChunkLogCount,
        cached_seconds: Number(audioCacheStats.durationSeconds.toFixed(1)),
        rolling_cache: audioCacheStats.truncated,
      });
    }
    this.queueStreamingChunk(samples, this.streamingSessionId);
  }

  private appendStreamingStableText(currentText: string, nextText: string): string {
    const left = currentText.trim();
    const right = nextText.trim();
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    if (/[，,。！？!?；;：:\n]$/u.test(left) || /^[，,。！？!?；;：:\n]/u.test(right)) {
      return `${left}${right}`;
    }
    const needsSpace = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
    return `${left}${needsSpace ? ' ' : ''}${right}`;
  }

  private async processSegmentedStreamingSegments(
    segments: StreamingSegmentEvent[],
    settings: Settings,
    sessionId: number,
    final = false
  ): Promise<void> {
    if (segments.length === 0 || !this.asrEngine) {
      return;
    }

    for (const segment of segments) {
      if (sessionId !== this.streamingSessionId) {
        return;
      }

      try {
        const asrResult = await this.asrEngine.transcribeRich(segment.audio);
        if (sessionId !== this.streamingSessionId) {
          return;
        }

        const cleanedSegment = final
          ? this.cleanupTranscriptWithDictionary(asrResult.text, settings)
          : this.streamingRealtimeTextProcessor.processStableSegment(asrResult.text, settings, {
            stablePause: true,
            pauseMs: segment.pauseMs,
            pauseReason: segment.reason,
          });
        if (!cleanedSegment) {
          continue;
        }

        const sourceBefore = this.streamingLatestText || this.streamingPastedSourceText || this.streamingOutputText;
        const combinedText = this.appendStreamingStableText(sourceBefore, cleanedSegment);
        this.streamingLatestText = combinedText;

        if (settings.auto_paste && !this.streamingAutoPasteSuspended) {
          const delta = combinedText.startsWith(this.streamingPastedSourceText)
            ? combinedText.slice(this.streamingPastedSourceText.length)
            : this.appendStreamingStableText('', cleanedSegment);
          if (delta) {
            this.enqueueStreamingPaste(delta, combinedText, sessionId);
            this.streamingPendingAiReviewAfterCommit = true;
          }
        } else {
          this.updateStreamingAiRawText(this.buildStreamingRawDisplayText(combinedText, {
            preferCommitted: false,
          }), settings);
          this.queueStreamingAiReview(combinedText, settings, final);
        }

        console.log('Segmented streaming ASR segment decoded', {
          sessionId,
          final,
          segment_samples: segment.audio.length,
          pause_ms: segment.pauseMs,
          pause_reason: segment.reason,
          text_length: cleanedSegment.length,
          language: asrResult.language,
          confidence: asrResult.confidence,
        });
      } catch (error) {
        console.error('Segmented streaming ASR segment failed:', error);
      }
    }
  }

  private queueStreamingChunk(samples: Float32Array, sessionId: number): void {
    this.streamingChunkQueue = this.streamingChunkQueue
      .then(async () => {
        if (sessionId !== this.streamingSessionId || samples.length === 0) {
          return;
        }

        const completedSegments = this.streamingSegmenter?.push(samples) ?? [];
        const completedSpeechSegment = completedSegments.length > 0;
        const lastCompletedSegment = completedSegments.at(-1);
        await this.ensureAsrEngineReady();
        const settings = this.settingsStore.getSettings();

        if (this.isActiveSegmentedStreamingMode(settings)) {
          await this.processSegmentedStreamingSegments(completedSegments, settings, sessionId);
          return;
        }

        const text = this.asrEngine?.acceptStreamingAudio(samples) ?? '';
        const decodedAt = Date.now();
        if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0 || text.length > 0) {
          console.log('Streaming ASR chunk decoded', {
            sessionId,
            samples: samples.length,
            text_length: text.length,
          });
        }
        if (sessionId !== this.streamingSessionId || !text) {
          return;
        }

        const processed = this.streamingRealtimeTextProcessor.processPartial(text, settings, {
          stablePause: completedSpeechSegment,
          pauseMs: lastCompletedSegment?.pauseMs ?? 0,
          pauseReason: lastCompletedSegment?.reason,
        });
        if (!processed.realtimeText && !processed.displayDelta) {
          return;
        }
        this.streamingLatestText = processed.stableText || processed.realtimeText;
        const delta = processed.realtimeText.startsWith(this.streamingOutputText)
          ? processed.realtimeText.slice(this.streamingOutputText.length)
          : processed.displayDelta;

        const now = Date.now();
        const shouldFlushStreamingPaste = Boolean(
          delta
          && settings.auto_paste
          && this.shouldFlushStreamingPaste(delta, completedSpeechSegment, now)
        );

        if (shouldFlushStreamingPaste) {
          const pasteText = this.streamingPendingBoundaryPunctuation
            ? prefixStreamingBoundaryPunctuation(this.streamingOutputText || this.streamingPastedText, delta)
            : delta;

          this.enqueueStreamingPaste(pasteText, processed.rawText, sessionId);
          this.scheduleStreamingTailCorrection(processed.tailCorrection, sessionId);
          this.streamingPendingBoundaryPunctuation = false;
          if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0) {
            console.log('Streaming realtime fast path enqueued paste before panel work', {
              sessionId,
              raw_delta_length: processed.metrics.raw_delta_length,
              tail_chars_processed: processed.metrics.tail_chars_processed,
              partial_to_enqueue_ms: Date.now() - decodedAt,
            });
          }
        } else if (!settings.auto_paste || this.streamingAutoPasteSuspended) {
          this.updateStreamingAiRawText(this.buildStreamingRawDisplayText(processed.realtimeText, {
            preferCommitted: false,
          }), settings);
        }

        if (completedSpeechSegment && (this.streamingOutputText || this.streamingPastedText)) {
          this.streamingPendingBoundaryPunctuation = true;
          this.streamingPendingAiReviewAfterCommit = true;
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

    const settings = this.settingsStore.getSettings();
    if (this.isActiveSegmentedStreamingMode(settings)) {
      await this.processSegmentedStreamingSegments(
        this.streamingSegmenter?.flush() ?? [],
        settings,
        sessionId,
        true
      );
    }

    await this.waitForStreamingPasteQueueToDrain(sessionId);
    await this.waitForStreamingTailCorrectionToDrain(sessionId);

    const finalRawText = this.isActiveSegmentedStreamingMode(settings)
      ? (this.streamingLatestText || this.streamingOutputText || this.streamingPastedSourceText)
      : (this.asrEngine?.finishStreamingSession() ?? '');
    const cleanedStreamingText = this.cleanupTranscriptWithDictionary(
      finalRawText || this.streamingLatestText || this.streamingOutputText,
      settings
    );
    const cleanedFinalText = await this.refineStreamingFinalWithOfflineAsr(cleanedStreamingText, settings);
    const localFinalRewrite = await this.buildModelAssistedLocalChineseRewrite(cleanedFinalText, settings, true);
    const finalText = sanitizeStreamingAiText(localFinalRewrite.rewrite.refinedRawText)
      || (settings.voice_formatting_enabled && cleanedFinalText.includes('\n')
        ? this.applyFallbackPunctuation(cleanedFinalText, settings)
        : ensureStreamingFinalPunctuation(cleanedFinalText));
    this.streamingLatestText = '';

    if (!finalText) {
      this.streamingSegmenter?.reset();
      this.streamingSegmenter = null;
      this.streamingPendingBoundaryPunctuation = false;
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionSuspended = false;
      this.streamingPendingTailCorrection = null;
      this.streamingPendingAiReviewAfterCommit = false;
      this.streamingAudioCache.reset();
      if (settings.streaming_ai_panel_enabled) {
        this.patchStreamingAiPanelState({
          active: false,
          status: 'idle',
          status_text: '本次没有识别到有效原文。',
        }, { immediate: true });
      }
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    }

    const normalized = this.stateMachine.finishOutput(finalText);
    this.autoLearnFromTranscript(normalized, settings);
    console.log('Streaming transcription complete', createTranscriptionLogMeta(normalized));

    let finalPanelText = normalized;
    if (settings.auto_paste && !this.streamingAutoPasteSuspended) {
      let autoPasteSucceeded = this.streamingInsertionTransaction.hasInsertedText();
      const finalDelta = finalText.startsWith(this.streamingPastedSourceText)
        ? finalText.slice(this.streamingPastedSourceText.length)
        : '';
      const pasteText = this.streamingPendingBoundaryPunctuation
        ? prefixStreamingBoundaryPunctuation(this.streamingOutputText || this.streamingPastedText, finalDelta)
        : finalDelta;

      if (pasteText) {
        this.enqueueStreamingPaste(pasteText, finalText, sessionId);
        await this.waitForStreamingPasteQueueToDrain(sessionId);
        autoPasteSucceeded = !this.streamingAutoPasteSuspended && this.streamingInsertionTransaction.hasInsertedText();
      } else if (this.streamingPastedSourceText && this.streamingPastedSourceText !== finalText) {
        const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
          finalText,
          this.previousAppBundleId
        );
        if (replaceResult.status === 'replaced') {
          this.streamingPastedText = finalText;
          this.streamingOutputText = finalText;
          this.streamingCursorCommitState = {
            committedText: finalText,
            committedSourceText: finalText,
            committedAt: Date.now(),
            sessionId,
          };
          finalPanelText = finalText;
          autoPasteSucceeded = true;
          console.log('Streaming final text replaced pasted partials', {
            chars_replaced: replaceResult.charsReplaced,
            final_length: Array.from(finalText).length,
          });
        } else {
          console.warn('Streaming final text diverged from pasted partials and could not be replaced', {
            status: replaceResult.status,
            pasted_length: this.streamingPastedSourceText.length,
            final_length: finalText.length,
            error: replaceResult.error,
          });
        }
      }

      await this.autoPaste.writeClipboard(normalized);
      this.streamingInsertionTransaction.rememberClipboardText(normalized);
      this.streamingPastedSourceText = finalText;
      this.streamingPastedText = this.streamingPastedText || finalText;
      finalPanelText = this.getStreamingCommittedText() || finalText;
      if (autoPasteSucceeded) {
        this.stateMachine.markAutoPasteSuccess();
      }
    } else {
      await this.autoPaste.writeClipboard(normalized);
      if (settings.auto_paste && this.streamingAutoPasteSuspended) {
        this.patchStreamingAiPanelState({
          apply_status_text: '自动回填已暂停，最终文本已复制到剪贴板。',
          status_text: '最终文本已生成；请在微信输入框手动粘贴。',
        }, { immediate: true });
      }
    }

    this.updateStreamingAiRawText(finalPanelText, settings, { immediate: true });
    this.queueStreamingAiReview(finalPanelText, settings, true);
    this.streamingSegmenter?.reset();
    this.streamingSegmenter = null;
    this.streamingPendingBoundaryPunctuation = false;
    this.streamingTailReplacementActive = false;
    this.streamingTailCorrectionSuspended = false;
    this.streamingPendingTailCorrection = null;
    this.streamingPendingAiReviewAfterCommit = false;
    this.streamingAudioCache.reset();
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

  private getStreamingAudioSamples(): Float32Array {
    return this.streamingAudioCache.getSamples();
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

  private patchStreamingAiPanelState(patch: Partial<StreamingAiPanelState>, options: { immediate?: boolean } = {}): void {
    const normalizedPatch = this.normalizeStreamingAiPanelPatch(patch);
    this.streamingAiState = {
      ...this.streamingAiState,
      ...normalizedPatch,
      enabled: this.settingsStore.getSettings().streaming_ai_panel_enabled,
      updated_at: new Date().toISOString(),
    };
    this.scheduleStreamingAiPanelPublish(Boolean(options.immediate));
  }

  private normalizeStreamingAiPanelPatch(patch: Partial<StreamingAiPanelState>): Partial<StreamingAiPanelState> {
    const normalizedPatch = { ...patch };
    if (typeof normalizedPatch.raw_text === 'string') {
      normalizedPatch.raw_text = stripUnknownTokens(normalizedPatch.raw_text);
    }
    if (typeof normalizedPatch.refined_raw_text === 'string') {
      normalizedPatch.refined_raw_text = sanitizeStreamingAiText(normalizedPatch.refined_raw_text);
    }
    if (typeof normalizedPatch.ai_text === 'string') {
      normalizedPatch.ai_text = sanitizeStreamingAiText(normalizedPatch.ai_text);
    }
    return normalizedPatch;
  }

  private scheduleStreamingAiPanelPublish(immediate = false): void {
    if (immediate) {
      if (this.streamingPanelPublishTimer) {
        clearTimeout(this.streamingPanelPublishTimer);
        this.streamingPanelPublishTimer = null;
      }
      this.publishStreamingAiPanelState();
      return;
    }

    if (this.streamingPanelPublishTimer) {
      return;
    }

    this.streamingPanelPublishTimer = setTimeout(() => {
      this.streamingPanelPublishTimer = null;
      this.publishStreamingAiPanelState();
    }, STREAMING_PANEL_THROTTLE_MS);
  }

  private publishStreamingAiPanelState(state: StreamingAiPanelState = this.getStreamingAiPanelState()): void {
    const contents = this.streamingAiWindow?.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    contents.send('streaming_ai_panel_updated', state);
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
      case 'cuda':
      case 'directml':
        return '本机加速';
      case 'cpu':
        return '极速本机';
      default:
        return '未配置';
    }
  }

  private getAsrModelStatusLabel(): string {
    if (this.asrEngine) {
      return `已就绪 · ${this.describeProvider(this.asrEngine.getActiveProvider())}`;
    }

    if (this.isAsrInitializing) {
      return '正在准备';
    }

    if (this.asrInitializationError) {
      return `异常：${this.asrInitializationError.message}`;
    }

    return '未启动';
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
