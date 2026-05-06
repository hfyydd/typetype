import { fork, ChildProcess, spawnSync } from 'child_process';
import * as path from 'path';

import {
  getTranslationCacheDir,
  getTranslationLanguageDefinition,
  resolveBundledTranslationModelPath,
} from './translation-model-registry';
import { TranslationTargetLanguage } from './types';

interface TranslationEngineOptions {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface TranslationWorkerResponse {
  type: 'result' | 'error';
  requestId: number;
  text?: string;
  error?: string;
}

export class TranslationEngine {
  private readonly dataDir: string;
  private readonly processResourcesPath: string;
  private readonly appPath: string;
  private worker: ChildProcess | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private resolvedNodeExecPath: string | null = null;

  constructor(options: TranslationEngineOptions) {
    this.dataDir = options.dataDir;
    this.processResourcesPath = options.processResourcesPath;
    this.appPath = options.appPath;
  }

  async translate(text: string, targetLanguage: TranslationTargetLanguage): Promise<string> {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }

    const definition = getTranslationLanguageDefinition(targetLanguage);
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    const bundledModelPath = resolveBundledTranslationModelPath(
      definition.modelId,
      this.processResourcesPath,
      this.appPath
    );
    const modelPathOrId = bundledModelPath || definition.modelId;

    console.log('[translation-debug] worker-request', {
      requestId,
      modelId: definition.modelId,
      modelPathOrId,
      bundledModelPath,
      targetLanguage,
      text: normalized,
    });

    return new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      worker.send({
        type: 'translate',
        requestId,
        modelId: modelPathOrId,
        cacheDir: getTranslationCacheDir(this.dataDir),
        sourceLanguage: definition.sourceLanguage,
        targetLanguage: definition.targetLanguage,
        text: normalized,
      });
    });
  }

  dispose(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('translation engine disposed'));
      this.pendingRequests.delete(requestId);
    }

    this.worker?.kill();
    this.worker = null;
  }

  private ensureWorker(): ChildProcess {
    if (this.worker) {
      return this.worker;
    }

    const workerPath = path.join(__dirname, 'translation-worker.js');
    const execPath = this.resolveNodeExecPath();
    const usingElectronNodeFallback = execPath === process.execPath;
    this.worker = fork(workerPath, {
      execPath,
      env: {
        ...process.env,
        ...(usingElectronNodeFallback ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    console.log('[translation-debug] worker-spawn', {
      workerPath,
      execPath,
      usingElectronNodeFallback,
    });
    this.worker.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    this.worker.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    this.worker.on('message', (message: TranslationWorkerResponse) => {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);
      if (message.type === 'result') {
        console.log('[translation-debug] worker-result', {
          requestId: message.requestId,
          text: message.text ?? '',
        });
        pending.resolve(message.text ?? '');
        return;
      }

      console.error('[translation-debug] worker-error', {
        requestId: message.requestId,
        error: message.error ?? 'translation failed',
      });
      pending.reject(new Error(message.error ?? 'translation failed'));
    });
    this.worker.on('error', (error) => {
      console.error('[translation-debug] worker-process-error', error);
      for (const [requestId, pending] of this.pendingRequests) {
        pending.reject(error);
        this.pendingRequests.delete(requestId);
      }
      this.worker = null;
    });
    this.worker.on('exit', (code, signal) => {
      console.log('[translation-debug] worker-exit', { code, signal });
      if (code === 0 && signal === null) {
        this.worker = null;
        return;
      }

      for (const [requestId, pending] of this.pendingRequests) {
        pending.reject(new Error(`translation worker exited with code ${code ?? 'null'} signal ${signal ?? 'none'}`));
        this.pendingRequests.delete(requestId);
      }
      this.worker = null;
    });

    return this.worker;
  }

  private resolveNodeExecPath(): string {
    if (this.resolvedNodeExecPath) {
      return this.resolvedNodeExecPath;
    }

    const configured = process.env.TYPETYPE_NODE_PATH?.trim();
    if (configured) {
      this.resolvedNodeExecPath = configured;
      return configured;
    }

    const command = process.platform === 'win32' ? 'where' : 'which';
    const lookup = spawnSync(command, ['node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const discovered = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (lookup.status === 0 && discovered) {
      this.resolvedNodeExecPath = discovered;
      return discovered;
    }

    this.resolvedNodeExecPath = process.execPath;
    return process.execPath;
  }
}
