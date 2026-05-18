import * as toml from '@iarna/toml';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Settings } from './types';

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
      compute_backend: 'auto',
      translation_target_language: 'en',
      custom_dictionary: [],
      model_path: null,
      pinned_model_version: 'sherpa-onnx-sense-voice',
      llm_rewrite: {
        enabled: false,
        provider: 'openai',
        api_key: '',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
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
        return { ...this.getDefaultSettings(), ...parsed } as Settings;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return this.getDefaultSettings();
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
      fs.mkdirSync(this.dataDir, { recursive: true });
      const content = toml.stringify(settings as any);
      fs.writeFileSync(this.settingsPath, content, 'utf-8');
      this.settings = settings;
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
