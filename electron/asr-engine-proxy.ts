/**
 * AsrEngineProxy — runs in the main process and proxies every ASR call
 * over IPC to a forked `asr-engine-worker` child process. This is what
 * keeps sherpa-onnx's synchronous native constructor off the main
 * process event loop so the settings panel does not freeze when the
 * user switches recognition mode / streaming model / voice package.
 *
 * The proxy exposes the same surface that the in-process `AsrEngine`
 * used to expose, so the call sites in `main.ts` mostly just need to
 * add `await` in front of the streaming / transcribe calls. The getters
 * (getModelPath, getActiveProvider, etc.) read from a cached status
 * snapshot that the worker pushes on every `ready` / `status` message,
 * so they stay synchronous and cheap to call from hot paths.
 */
import { ChildProcess, fork, ForkOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

import type { ModelFiles } from './asr-engine';
import type { RichAsrResult } from './types';
import {
  AsrWorkerRequest,
  AsrWorkerResponse,
  AsrRecognitionMode,
  AsrComputeBackend,
} from './asr-engine-worker';
import { ProviderName } from './asr-runtime';

export interface AsrEngineProxyInitOptions {
  modelFiles: ModelFiles;
  recognitionMode: AsrRecognitionMode;
  computeBackend: AsrComputeBackend;
  numThreads?: number;
  workerPath?: string;
  forkProcess?: (modulePath: string, args?: readonly string[], options?: ForkOptions) => ChildProcess;
  resolveNodeExecPath?: () => string;
}

export interface AsrEngineStatus {
  provider: ProviderName | null;
  runtimeLabel: string;
  recognitionMode: AsrRecognitionMode | null;
  modelPath: string | null;
  modelDirectory: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class AsrEngineProxy extends EventEmitter {
  private worker: ChildProcess | null = null;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private status: AsrEngineStatus = {
    provider: null,
    runtimeLabel: 'not initialized',
    recognitionMode: null,
    modelPath: null,
    modelDirectory: null,
  };
  private initOptions: AsrEngineProxyInitOptions | null = null;
  private initPromise: Promise<void> | null = null;
  private workerPath: string;
  private readonly forkProcess: (modulePath: string, args?: readonly string[], options?: ForkOptions) => ChildProcess;
  private readonly resolveNodeExecPath: () => string;

  constructor(options: AsrEngineProxyInitOptions) {
    super();
    this.initOptions = options;
    this.workerPath = options.workerPath
      ?? path.join(__dirname, 'asr-engine-worker.js');
    this.forkProcess = options.forkProcess ?? fork;
    this.resolveNodeExecPath = options.resolveNodeExecPath ?? defaultResolveNodeExecPath;
  }

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    const opts = this.initOptions;
    if (!opts) {
      throw new Error('AsrEngineProxy: init options missing');
    }
    this.initPromise = this.sendInit(opts);
    return this.initPromise;
  }

  async transcribe(samples: Float32Array): Promise<string> {
    const result = await this.transcribeRich(samples);
    return result.text;
  }

  async transcribeRich(samples: Float32Array): Promise<RichAsrResult> {
    const result = await this.request<RichAsrResult>('transcribe', {
      samples: Array.from(samples),
    });
    return result;
  }

  async startStreamingSession(): Promise<void> {
    await this.notify('startStreaming');
  }

  async acceptStreamingAudio(samples: Float32Array): Promise<string> {
    const result = await this.request<{ text: string }>('feedAudio', {
      samples: Array.from(samples),
    });
    return result.text;
  }

  async finishStreamingSession(): Promise<string> {
    const result = await this.request<{ text: string }>('finishStreaming', {});
    return result.text;
  }

  async cancelStreamingSession(): Promise<void> {
    await this.notify('cancelStreaming');
  }

  async refreshStatus(): Promise<AsrEngineStatus> {
    const result = await this.request<AsrEngineStatus>('getStatus', {});
    this.status = result;
    return result;
  }

  getModelPath(): string | null {
    return this.status.modelPath;
  }

  getModelDirectory(): string | null {
    return this.status.modelDirectory;
  }

  getActiveProvider(): ProviderName | null {
    return this.status.provider;
  }

  getRecognitionMode(): AsrRecognitionMode | null {
    return this.status.recognitionMode;
  }

  getRuntimeLabel(): string {
    return this.status.runtimeLabel;
  }

  getNumThreads(): number | null {
    // The worker owns the live recognizer, so num threads is not directly
    // observable from the main process; return the value we passed in.
    return this.initOptions?.numThreads ?? null;
  }

  /**
   * Re-initialize the recognizer against new model files / settings.
   * The previous worker is torn down and a fresh one is spawned so the
   * heavy sherpa-onnx constructor stays out of the main process event
   * loop. Safe to call concurrently — the latest call wins.
   */
  async reinitialize(options: AsrEngineProxyInitOptions): Promise<void> {
    await this.shutdown();
    this.initOptions = options;
    if (options.workerPath) {
      this.workerPath = options.workerPath;
    }
    this.status = {
      provider: null,
      runtimeLabel: 'not initialized',
      recognitionMode: null,
      modelPath: null,
      modelDirectory: null,
    };
    this.initPromise = null;
    await this.initialize();
  }

  async destroy(): Promise<void> {
    if (!this.worker) {
      return;
    }
    try {
      await this.notify('destroy');
    } catch (error) {
      // Worker may already be dead; ignore.
      console.error('[asr-engine-proxy] destroy notify failed', error);
    }
    await this.shutdown();
  }

  private async sendInit(options: AsrEngineProxyInitOptions): Promise<void> {
    const worker = this.ensureWorker();
    await new Promise<void>((resolve, reject) => {
      const onMessage = (message: AsrWorkerResponse) => {
        if (message.type === 'ready') {
          this.status = {
            provider: message.provider,
            runtimeLabel: message.runtimeLabel,
            recognitionMode: message.recognitionMode,
            modelPath: message.modelPath,
            modelDirectory: message.modelDirectory,
          };
          this.emit('ready', this.status);
          cleanup();
          resolve();
        } else if (message.type === 'initError') {
          cleanup();
          reject(new Error(message.message));
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(new Error(`ASR worker exited before ready (code=${code} signal=${signal})`));
      };
      const cleanup = () => {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      };
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.send({
        type: 'init',
        modelFiles: options.modelFiles,
        recognitionMode: options.recognitionMode,
        computeBackend: options.computeBackend,
        numThreads: options.numThreads,
      } satisfies AsrWorkerRequest);
    });
  }

  private async notify(type: AsrWorkerRequest['type']): Promise<void> {
    const worker = this.ensureWorker();
    await new Promise<void>((resolve, reject) => {
      const onMessage = (message: AsrWorkerResponse) => {
        if (type === 'startStreaming' && message.type === 'streamingStarted') {
          cleanup();
          resolve();
        } else if (type === 'cancelStreaming' && message.type === 'streamingError') {
          cleanup();
          reject(new Error(message.message));
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
      };
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.send({ type } as AsrWorkerRequest);
    });
  }

  private async request<T>(
    type: 'transcribe' | 'feedAudio' | 'finishStreaming' | 'getStatus',
    payload: Record<string, unknown>,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const onMessage = (message: AsrWorkerResponse) => {
        if ('requestId' in message && message.requestId !== requestId) {
          return;
        }
        if (type === 'transcribe' && message.type === 'transcribeResult') {
          cleanup();
          resolve({
            text: message.text,
            language: message.language ?? undefined,
            confidence: message.confidence ?? undefined,
            segments: message.segments ?? [],
            candidates: message.candidates ?? [],
            code_switch_hints: message.code_switch_hints ?? [],
          } as unknown as T);
        } else if (type === 'transcribe' && message.type === 'transcribeError') {
          cleanup();
          reject(new Error(message.message));
        } else if (
          (type === 'feedAudio' || type === 'finishStreaming') &&
          message.type === 'streamingResult'
        ) {
          cleanup();
          resolve({ text: message.text } as unknown as T);
        } else if (
          (type === 'feedAudio' || type === 'finishStreaming') &&
          message.type === 'streamingError'
        ) {
          cleanup();
          reject(new Error(message.message));
        } else if (type === 'getStatus' && message.type === 'status') {
          cleanup();
          resolve(message as unknown as T);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        this.pendingRequests.delete(requestId);
      };
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.send({ type, requestId, ...payload } as unknown as AsrWorkerRequest);
    });
  }

  private ensureWorker(): ChildProcess {
    if (this.worker) {
      return this.worker;
    }
    const execPath = this.resolveNodeExecPath();
    const usingElectronNodeFallback = execPath === process.execPath;
    const workerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(usingElectronNodeFallback ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    };
    // Pass the resources path to the child so loadSherpaOnnxNode() in
    // the worker (which runs in plain-Node mode and has no Electron
    // `app` object) can still locate app.asar.unpacked/node_modules.
    if (process.resourcesPath) {
      workerEnv.TYPETYPE_RESOURCES_PATH = process.resourcesPath;
      // Belt-and-suspenders: also set NODE_PATH so a plain
      // require('sherpa-onnx-node') inside the worker resolves
      // through the unpacked modules tree before any explicit path
      // lookup runs.
      const unpackedNodeModules = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules'
      );
      if (fs.existsSync(unpackedNodeModules)) {
        const existing = workerEnv.NODE_PATH;
        workerEnv.NODE_PATH = existing
          ? [unpackedNodeModules, existing].join(path.delimiter)
          : unpackedNodeModules;
      }
    }
    const worker = this.forkProcess(this.workerPath, [], {
      execPath,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    worker.stdout?.on('data', (chunk) => {
      process.stdout.write(`[asr-engine-worker] ${chunk}`);
    });
    worker.stderr?.on('data', (chunk) => {
      process.stderr.write(`[asr-engine-worker] ${chunk}`);
    });
    worker.on('message', (message: AsrWorkerResponse) => {
      if (message.type === 'status') {
        this.status = {
          provider: message.provider,
          runtimeLabel: message.runtimeLabel,
          recognitionMode: message.recognitionMode,
          modelPath: message.modelPath,
          modelDirectory: message.modelDirectory,
        };
        this.emit('status', this.status);
      }
    });
    worker.on('exit', (code, signal) => {
      console.log('[asr-engine-proxy] worker-exit', { code, signal });
      this.worker = null;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`ASR worker exited (code=${code} signal=${signal})`));
      }
      this.pendingRequests.clear();
      this.emit('exit', { code, signal });
    });
    worker.on('error', (error) => {
      console.error('[asr-engine-proxy] worker-error', error);
      for (const [, pending] of this.pendingRequests) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
    });
    this.worker = worker;
    return worker;
  }

  private async shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return;
    }
    try {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          worker.kill('SIGTERM');
          resolve();
        }, 1500);
        const onMessage = (message: AsrWorkerResponse) => {
          if (message.type === 'shutdownComplete') {
            clearTimeout(timeout);
            worker.removeListener('message', onMessage);
            resolve();
          }
        };
        worker.on('message', onMessage);
        worker.send({ type: 'shutdown' } satisfies AsrWorkerRequest);
      });
    } catch (error) {
      console.error('[asr-engine-proxy] shutdown error', error);
    } finally {
      if (!worker.killed) {
        worker.kill('SIGTERM');
      }
    }
    this.initPromise = null;
  }
}

function defaultResolveNodeExecPath(): string {
  // In a packaged Electron app, `process.execPath` is the Electron
  // binary, which can run as plain Node when ELECTRON_RUN_AS_NODE=1.
  // In dev / tests we want to fall back to the system `node` binary so
  // tests do not need a full Electron runtime.
  if (process.env.NODE_ENV === 'test' || process.env.TYPETYPE_USE_SYSTEM_NODE === '1') {
    return process.env.NODE_PATH ?? 'node';
  }
  return process.execPath;
}
