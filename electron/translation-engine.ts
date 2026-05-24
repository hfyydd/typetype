import { fork, ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getTranslationCacheDir,
  getTranslationLanguageDefinition,
  resolveBundledHyMt2ModelPath,
  resolveBundledLlamaCliPath,
  resolveBundledTranslationModelPath,
  TranslationLanguageDefinition,
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

  async translate(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    preserveTerms: string[] = []
  ): Promise<string> {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }

    const definition = getTranslationLanguageDefinition(targetLanguage);
    try {
      const hyMt2Result = await this.translateWithHyMt2(normalized, definition, preserveTerms);
      if (hyMt2Result) {
        return hyMt2Result;
      }
    } catch (error) {
      console.warn('[translation-debug] hy-mt2-fallback-to-nllb', {
        targetLanguage,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.translateWithNllb(normalized, targetLanguage, definition);
  }

  private async translateWithNllb(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    definition: TranslationLanguageDefinition
  ): Promise<string> {
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
      text,
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
        text,
      });
    });
  }

  private async translateWithHyMt2(
    text: string,
    definition: TranslationLanguageDefinition,
    preserveTerms: string[]
  ): Promise<string> {
    const modelPath = resolveBundledHyMt2ModelPath(this.processResourcesPath, this.appPath);
    const llamaCliPath = resolveBundledLlamaCliPath(this.processResourcesPath, this.appPath);

    if (!modelPath || !llamaCliPath) {
      throw new Error('HY-MT2-1.8B 模型或 llama.cpp 运行时未打包');
    }

    const prompt = buildHyMt2Prompt(text, definition.hyTargetLanguage, preserveTerms);
    const promptFilePath = writeHyMt2PromptFile(prompt, this.dataDir);
    const args = [
      '-m',
      modelPath,
      '-f',
      promptFilePath,
      '-n',
      '1024',
      '--ctx-size',
      '4096',
      '--threads',
      String(Math.max(2, Math.min(os.cpus().length || 4, 8))),
      '--temp',
      '0.2',
      '--top-p',
      '0.6',
      '--top-k',
      '20',
      '-st',
      '--no-display-prompt',
      '--no-warmup',
      '--simple-io',
      '--log-disable',
      '--no-show-timings',
    ];

    console.log('[translation-debug] hy-mt2-request', {
      modelPath,
      llamaCliPath,
      targetLanguage: definition.hyTargetLanguage,
      text,
    });

    try {
      const output = await runLlamaCli(llamaCliPath, args);
      const translated = cleanupHyMt2Output(output);
      console.log('[translation-debug] hy-mt2-result', {
        targetLanguage: definition.hyTargetLanguage,
        text: translated,
      });
      return translated;
    } finally {
      fs.rmSync(promptFilePath, { force: true });
    }
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
      console.error('[translation-debug] worker-stderr', chunk.toString().trim());
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

    if (this.isPackagedAsarRuntime()) {
      this.resolvedNodeExecPath = process.execPath;
      return process.execPath;
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

  private isPackagedAsarRuntime(): boolean {
    return this.appPath.endsWith('app.asar') || __dirname.includes('.asar');
  }
}

function buildHyMt2Prompt(text: string, targetLanguage: string, preserveTerms: string[]): string {
  const uniqueTerms = Array.from(new Set(preserveTerms.map((term) => term.trim()).filter(Boolean))).slice(0, 30);
  const terminology = uniqueTerms.length
    ? uniqueTerms.map((term) => `- ${term}`).join('\n')
    : '无';

  return [
    `You are a translation engine. Translate ONLY the text inside <source> into ${targetLanguage}.`,
    'Use <terms> only as terminology hints. Do not translate or output instructions, tags, or terms list.',
    'Output translation only.',
    '<terms>',
    terminology,
    '</terms>',
    '<source>',
    text,
    '</source>',
  ].join('\n');
}

function writeHyMt2PromptFile(prompt: string, dataDir: string): string {
  const promptDir = path.join(dataDir, 'translation-prompts');
  fs.mkdirSync(promptDir, { recursive: true });
  const promptFilePath = path.join(promptDir, `hy-mt2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(promptFilePath, prompt, 'utf8');
  return promptFilePath;
}

function cleanupHyMt2Output(output: string): string {
  const lines = output
    .replace(/<｜[^｜]+｜>/g, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const promptIndex = lines.findIndex((line) => line.startsWith('> '));
  const sourceEndIndex = lines.findIndex((line, index) => index > promptIndex && line === '</source>');
  const startIndex = sourceEndIndex >= 0
    ? sourceEndIndex + 1
    : (promptIndex >= 0 ? promptIndex + 1 : 0);
  const candidateLines = lines.slice(startIndex);
  const cleanedLines = candidateLines
    .filter((line) => !isLlamaCliNoiseLine(line))
    .filter((line) => !/^[▄▀█\s]+$/.test(line));

  return cleanedLines
    .join('\n')
    .trim();
}

function isLlamaCliNoiseLine(line: string): boolean {
  return (
    line === 'Loading model...' ||
    line === 'available commands:' ||
    line === 'Exiting...' ||
    line.startsWith('/exit') ||
    line.startsWith('/regen') ||
    line.startsWith('/clear') ||
    line.startsWith('/read') ||
    line.startsWith('/glob') ||
    line.startsWith('build') ||
    line.startsWith('model') ||
    line.startsWith('modalities') ||
    line.startsWith('llama_') ||
    line.startsWith('main:') ||
    line.startsWith('[ Prompt:')
  );
}

function runLlamaCli(executablePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('HY-MT2 翻译超时'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `llama.cpp exited with code ${code}`));
        return;
      }

      resolve(stdout);
    });
  });
}
