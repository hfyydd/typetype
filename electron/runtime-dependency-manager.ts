import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';

const VC_REDIST_FILE = 'vc_redist.x64.exe';
const VC_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
  'HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
];
const RUNTIME_INSTALLER_RELATIVE_DIR = path.join('runtime-installers');
const RUNTIME_INSTALL_LOG = 'typetype-vc-redist.log';

export type RuntimeDependencyStatusKind =
  | 'ready'
  | 'needs_repair'
  | 'installer_missing'
  | 'unsupported';

export interface RuntimeDependencyManagerOptions {
  resourcesPath?: string;
  processResourcesPath?: string;
  appPath?: string;
  vcRedistInstallerPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  spawnSyncFn?: typeof spawnSync;
  tempDir?: string;
}

export interface RuntimeDependencyStatus {
  status: RuntimeDependencyStatusKind;
  can_install: boolean;
  user_message: string;
  action?: 'install_runtime_dependency';
  action_label?: string;
  vc_redist_installed: boolean;
  vc_redist_version: string;
  vc_redist_installer_exists: boolean;
  vc_redist_installer_path: string;
  vc_redist_install_log: string;
}

export interface RuntimeDependencyInstallResult {
  ok: boolean;
  message: string;
  exit_code?: number;
  log_path?: string;
}

export class RuntimeDependencyManager {
  private spawnSyncFn: typeof spawnSync;
  private platform: NodeJS.Platform;
  private arch: string;
  private tempDir: string;

  constructor(private options: RuntimeDependencyManagerOptions = {}) {
    this.spawnSyncFn = options.spawnSyncFn ?? spawnSync;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.tempDir = options.tempDir ?? os.tmpdir();
  }

  getStatus(lastRuntimeError = ''): RuntimeDependencyStatus {
    const installerPath = this.resolveVcRedistInstallerPath() ?? this.getVcRedistInstallerCandidates()[0] ?? '';
    const installed = this.detectVcRedist();
    const installerExists = Boolean(installerPath && fs.existsSync(installerPath));
    const logPath = this.getInstallLogPath();
    const runtimeIssue = this.isRuntimeEnvironmentError(lastRuntimeError);

    if (this.platform !== 'win32' || this.arch !== 'x64') {
      return {
        status: 'unsupported',
        can_install: false,
        user_message: '当前系统不支持本地断句增强，已使用基础断句。',
        vc_redist_installed: installed.installed,
        vc_redist_version: installed.version,
        vc_redist_installer_exists: installerExists,
        vc_redist_installer_path: installerPath,
        vc_redist_install_log: logPath,
      };
    }

    if (installed.installed) {
      return {
        status: 'ready',
        can_install: false,
        user_message: runtimeIssue
          ? '系统运行库已安装/修复，基础断句可用；如果本地断句增强仍未恢复，请重启 typetype 或电脑后再试。'
          : '系统运行库已就绪。',
        vc_redist_installed: true,
        vc_redist_version: installed.version,
        vc_redist_installer_exists: installerExists,
        vc_redist_installer_path: installerPath,
        vc_redist_install_log: logPath,
      };
    }

    if (!installerExists) {
      return {
        status: 'installer_missing',
        can_install: false,
        user_message: '本地断句增强需要系统运行库，基础断句已可用。安装包缺少运行库修复组件，请重新安装 typetype。',
        vc_redist_installed: installed.installed,
        vc_redist_version: installed.version,
        vc_redist_installer_exists: false,
        vc_redist_installer_path: installerPath,
        vc_redist_install_log: logPath,
      };
    }

    return {
      status: 'needs_repair',
      can_install: true,
      user_message: '本地断句增强需要系统运行库，基础断句已可用。点击“安装/修复系统运行库”后可启用更好的断句效果。',
      action: 'install_runtime_dependency',
      action_label: '安装/修复系统运行库',
      vc_redist_installed: installed.installed,
      vc_redist_version: installed.version,
      vc_redist_installer_exists: true,
      vc_redist_installer_path: installerPath,
      vc_redist_install_log: logPath,
    };
  }

  installVcRedist(): RuntimeDependencyInstallResult {
    const status = this.getStatus('runtime repair requested');
    if (status.status === 'unsupported') {
      return {
        ok: false,
        message: '当前系统不支持自动安装系统运行库。',
        log_path: status.vc_redist_install_log,
      };
    }
    if (!status.vc_redist_installer_exists) {
      return {
        ok: false,
        message: '安装包缺少运行库修复组件，请重新安装 typetype。',
        log_path: status.vc_redist_install_log,
      };
    }

    const result = this.spawnSyncFn(
      status.vc_redist_installer_path,
      ['/install', '/passive', '/norestart', '/log', status.vc_redist_install_log],
      {
        stdio: 'ignore',
        windowsHide: true,
      }
    ) as SpawnSyncReturns<Buffer>;
    const code = result.status ?? 1;
    if ([0, 3010, 1638].includes(code)) {
      return {
        ok: true,
        exit_code: code,
        log_path: status.vc_redist_install_log,
        message: code === 3010
          ? '系统运行库已安装/修复，建议重启电脑后再使用本地断句增强。'
          : '系统运行库已安装/修复，建议重启 typetype 后再试。',
      };
    }

    return {
      ok: false,
      exit_code: code,
      log_path: status.vc_redist_install_log,
      message: `系统运行库安装没有成功，错误码 ${code}。请重试，或把诊断信息发给售后。`,
    };
  }

  isRuntimeEnvironmentError(message: string): boolean {
    const value = (message || '').toLowerCase();
    return Boolean(
      value.includes('the operating system cannot run %1')
      || value.includes('dll initialization routine failed')
      || value.includes('specified module could not be found')
      || value.includes('onnxruntime')
      || value.includes('directml')
      || value.includes('vcruntime')
      || value.includes('msvcp')
    );
  }

  getUserFacingPunctuationMessage(lastRuntimeError = ''): string {
    return this.getStatus(lastRuntimeError).user_message;
  }

  resolveVcRedistInstallerPath(): string | null {
    for (const candidate of this.getVcRedistInstallerCandidates()) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private detectVcRedist(): { installed: boolean; version: string } {
    if (this.platform !== 'win32') {
      return { installed: false, version: '' };
    }

    for (const key of VC_REGISTRY_KEYS) {
      const result = this.spawnSyncFn(
        'reg',
        ['query', key],
        {
          encoding: 'utf8',
          windowsHide: true,
        }
      ) as SpawnSyncReturns<string>;
      if (result.status !== 0 || !result.stdout) {
        continue;
      }
      const installed = /\bInstalled\s+REG_DWORD\s+0x1\b/i.test(result.stdout)
        || /\bInstalled\s+REG_DWORD\s+1\b/i.test(result.stdout);
      const versionMatch = result.stdout.match(/\bVersion\s+REG_SZ\s+([^\r\n]+)/i);
      if (installed || versionMatch) {
        return {
          installed: true,
          version: versionMatch?.[1]?.trim() ?? '',
        };
      }
    }

    return { installed: false, version: '' };
  }

  private getVcRedistInstallerCandidates(): string[] {
    if (this.options.vcRedistInstallerPath) {
      return [this.options.vcRedistInstallerPath];
    }

    return [
      this.options.processResourcesPath
        ? path.join(this.options.processResourcesPath, RUNTIME_INSTALLER_RELATIVE_DIR, VC_REDIST_FILE)
        : null,
      this.options.resourcesPath
        ? path.join(this.options.resourcesPath, RUNTIME_INSTALLER_RELATIVE_DIR, VC_REDIST_FILE)
        : null,
      this.options.appPath
        ? path.join(this.options.appPath, 'resources', RUNTIME_INSTALLER_RELATIVE_DIR, VC_REDIST_FILE)
        : null,
      path.join(__dirname, '..', 'resources', RUNTIME_INSTALLER_RELATIVE_DIR, VC_REDIST_FILE),
      path.join(__dirname, '..', '..', 'resources', RUNTIME_INSTALLER_RELATIVE_DIR, VC_REDIST_FILE),
    ].filter((value): value is string => Boolean(value));
  }

  private getInstallLogPath(): string {
    return path.join(this.tempDir, RUNTIME_INSTALL_LOG);
  }
}
