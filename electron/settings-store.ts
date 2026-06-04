import * as toml from '@iarna/toml';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ComputeBackend,
  RecognitionMode,
  Settings,
  StreamingModelPreference,
  StreamingEnhancementMode,
  VoicePackagePreference,
} from './types';

const RECOGNITION_MODES = new Set<RecognitionMode>(['non_streaming', 'streaming_output']);
const STREAMING_MODELS = new Set<StreamingModelPreference>([
  'multilingual_realtime',
  'multilingual_segmented',
  'zh_high_accuracy_realtime',
]);
const COMPUTE_BACKENDS = new Set<ComputeBackend>(['auto', 'cpu', 'gpu']);
const STREAMING_ENHANCEMENT_MODES = new Set<StreamingEnhancementMode>(['offline_private', 'online_enhanced']);
const VOICE_PACKAGES = new Set<VoicePackagePreference>(['fast_offline', 'pro_high_accuracy']);

export class SettingsStore {
  private settingsPath: string;
  private dataDir: string;
  private legacyDataDir: string;
  private settings: Settings;

  constructor() {
    const configDir = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config');

    this.dataDir = path.join(configDir, 'typetype');
    this.legacyDataDir = path.join(configDir, 'typenew');
    this.settingsPath = path.join(this.dataDir, 'settings.toml');

    this.migrateLegacyDataDir();
    this.settings = this.loadSettings();
  }

  private getDefaultSettings(): Settings {
    return {
      hotkey: 'CtrlSlash',
      translate_hotkey: 'CtrlDot',
      microphone_id: null,
      auto_paste: true,
      launch_at_login: false,
      recognition_mode: 'non_streaming',
      streaming_model: 'multilingual_realtime',
      compute_backend: 'auto',
      voice_package: 'fast_offline',
      translation_target_language: 'en',
      auto_learning_enabled: true,
      voice_formatting_enabled: true,
      streaming_ai_panel_enabled: false,
      streaming_enhancement_mode: 'offline_private',
      rewrite_scenario: 'general',
      custom_dictionary: [],
      model_path: null,
      pinned_model_version: 'sherpa-onnx-sense-voice',
      llm_rewrite: {
        enabled: false,
        provider: 'openai',
        api_key: '',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5.1',
        temperature: 0.3,
        max_tokens: 4096,
      },
    };
  }

  loadSettings(): Settings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = toml.parse(content);
        return this.normalizeSettings(parsed as Partial<Settings>);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return this.getDefaultSettings();
  }

  private normalizeSettings(input: Partial<Settings> | Record<string, unknown>): Settings {
    const defaults = this.getDefaultSettings();
    const parsed = input as Partial<Settings>;
    const llmRewrite = {
      ...defaults.llm_rewrite,
      ...(typeof parsed.llm_rewrite === 'object' && parsed.llm_rewrite ? parsed.llm_rewrite : {}),
    };

    return {
      ...defaults,
      ...parsed,
      recognition_mode: RECOGNITION_MODES.has(parsed.recognition_mode as RecognitionMode)
        ? parsed.recognition_mode as RecognitionMode
        : defaults.recognition_mode,
      streaming_model: STREAMING_MODELS.has(parsed.streaming_model as StreamingModelPreference)
        ? parsed.streaming_model as StreamingModelPreference
        : defaults.streaming_model,
      compute_backend: COMPUTE_BACKENDS.has(parsed.compute_backend as ComputeBackend)
        ? parsed.compute_backend as ComputeBackend
        : defaults.compute_backend,
      voice_package: VOICE_PACKAGES.has(parsed.voice_package as VoicePackagePreference)
        ? parsed.voice_package as VoicePackagePreference
        : defaults.voice_package,
      streaming_enhancement_mode: STREAMING_ENHANCEMENT_MODES.has(parsed.streaming_enhancement_mode as StreamingEnhancementMode)
        ? parsed.streaming_enhancement_mode as StreamingEnhancementMode
        : defaults.streaming_enhancement_mode,
      microphone_id: typeof parsed.microphone_id === 'string' && parsed.microphone_id.trim()
        ? parsed.microphone_id
        : null,
      model_path: typeof parsed.model_path === 'string' && parsed.model_path.trim()
        ? parsed.model_path
        : null,
      custom_dictionary: Array.isArray(parsed.custom_dictionary)
        ? parsed.custom_dictionary
        : defaults.custom_dictionary,
      llm_rewrite: llmRewrite,
    };
  }

  private migrateLegacyDataDir(): void {
    try {
      // 兼容早期 typenew 目录，首次启动 typetype 时把旧设置搬过来。
      if (fs.existsSync(this.dataDir) || !fs.existsSync(this.legacyDataDir)) {
        return;
      }

      fs.mkdirSync(path.dirname(this.dataDir), { recursive: true });
      fs.cpSync(this.legacyDataDir, this.dataDir, { recursive: true });
    } catch (e) {
      console.error('Failed to migrate legacy settings directory:', e);
    }
  }

  saveSettings(settings: Settings): void {
    try {
      const normalized = this.normalizeSettings(settings);
      fs.mkdirSync(this.dataDir, { recursive: true });
      const content = toml.stringify(normalized as any);
      fs.writeFileSync(this.settingsPath, content, 'utf-8');
      this.settings = normalized;
    } catch (e) {
      console.error('Failed to save settings:', e);
      throw e;
    }
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getSettingsPath(): string {
    return this.settingsPath;
  }
}
