import * as fs from 'fs';
import * as path from 'path';

import { app } from 'electron';

import { getDefaultNumThreads, getProviderCandidates, ProviderName } from './asr-runtime';
import { ComputeBackend, RecognitionMode } from './types';

export interface ModelFiles {
  modelPath: string;
  tokensPath: string;
  bpeVocabPath?: string | null;
}

export function createRecognizerConfig(
  modelPath: string,
  tokensPath: string,
  provider: ProviderName = 'cpu',
  numThreads: number = getDefaultNumThreads()
) {
  return {
    modelConfig: {
      senseVoice: {
        model: modelPath,
        language: 'auto',
        useItn: true,
      },
      tokens: tokensPath,
      numThreads,
      provider,
      debug: false,
    },
  };
}

function createStreamingRecognizerConfig(
  modelPath: string,
  tokensPath: string,
  bpeVocabPath: string | null,
  provider: ProviderName,
  numThreads: number
) {
  return {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      zipformer2Ctc: {
        model: modelPath,
      },
      tokens: tokensPath,
      numThreads,
      provider,
      debug: false,
      modelingUnit: bpeVocabPath ? 'bpe' : 'cjkchar',
      bpeVocab: bpeVocabPath ?? '',
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    rule1MinTrailingSilence: 1.8,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 12,
    blankPenalty: 0,
  };
}

interface AsrEngineOptions {
  computeBackend?: ComputeBackend;
  numThreads?: number;
  recognitionMode?: RecognitionMode;
}

function getModelFilesFromDirectory(modelDirectory: string): ModelFiles | null {
  const modelCandidates = [
    path.join(modelDirectory, 'model.int8.onnx'),
    path.join(modelDirectory, 'model.onnx'),
  ];

  for (const modelCandidate of modelCandidates) {
    if (!fs.existsSync(modelCandidate)) {
      continue;
    }

    const tokensCandidate = path.join(modelDirectory, 'tokens.txt');
    if (!fs.existsSync(tokensCandidate)) {
      continue;
    }

    const bpeVocabPath = path.join(modelDirectory, 'bbpe.model');
    return {
      modelPath: modelCandidate,
      tokensPath: tokensCandidate,
      bpeVocabPath: fs.existsSync(bpeVocabPath) ? bpeVocabPath : null,
    };
  }

  return null;
}

function isModelDirectoryCompatible(
  modelDirectory: string,
  recognitionMode?: RecognitionMode
): boolean {
  if (!recognitionMode) {
    return true;
  }

  const directoryName = path.basename(modelDirectory).toLowerCase();
  const hasBpeVocab = fs.existsSync(path.join(modelDirectory, 'bbpe.model'));
  const looksStreaming =
    directoryName.includes('streaming') ||
    directoryName.includes('zipformer') ||
    hasBpeVocab;
  const looksOffline =
    directoryName.includes('sense-voice') ||
    directoryName.includes('sense_voice');

  if (recognitionMode === 'streaming_output') {
    return !looksOffline;
  }

  return !looksStreaming;
}

function loadSherpaOnnxNode(): any {
  if (app?.isPackaged) {
    const unpackedEntry = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'sherpa-onnx-node',
      'sherpa-onnx.js'
    );

    if (fs.existsSync(unpackedEntry)) {
      return require(unpackedEntry);
    }
  }

  return require('sherpa-onnx-node');
}

export class AsrEngine {
  private recognizer: any = null;
  private streamingStream: any = null;
  private sampleRate = 16000;
  private computeBackend: ComputeBackend;
  private numThreads: number;
  private activeProvider: ProviderName | null = null;
  private recognitionMode: RecognitionMode;
  private modelFiles: ModelFiles | null;

  constructor(modelFiles: ModelFiles | null = null, options: AsrEngineOptions = {}) {
    this.modelFiles = modelFiles;
    this.computeBackend = options.computeBackend ?? 'auto';
    this.numThreads = options.numThreads ?? getDefaultNumThreads();
    this.recognitionMode = options.recognitionMode ?? 'non_streaming';
  }

  async initialize(): Promise<void> {
    if (!this.modelFiles?.modelPath || !this.modelFiles.tokensPath) {
      throw new Error('Model path and tokens path are required');
    }

    if (!fs.existsSync(this.modelFiles.modelPath)) {
      throw new Error(`Model file not found: ${this.modelFiles.modelPath}`);
    }

    if (!fs.existsSync(this.modelFiles.tokensPath)) {
      throw new Error(`Tokens file not found: ${this.modelFiles.tokensPath}`);
    }

    if (this.modelFiles.bpeVocabPath && !fs.existsSync(this.modelFiles.bpeVocabPath)) {
      throw new Error(`BPE vocab file not found: ${this.modelFiles.bpeVocabPath}`);
    }

    const sherpaOnnx = loadSherpaOnnxNode();
    let lastError: unknown = null;

    for (const provider of getProviderCandidates(this.computeBackend)) {
      try {
        if (this.recognitionMode === 'streaming_output') {
          const config = createStreamingRecognizerConfig(
            this.modelFiles.modelPath,
            this.modelFiles.tokensPath,
            this.modelFiles.bpeVocabPath ?? null,
            provider,
            this.numThreads
          );
          this.recognizer = new sherpaOnnx.OnlineRecognizer(config);
        } else {
          const config = createRecognizerConfig(
            this.modelFiles.modelPath,
            this.modelFiles.tokensPath,
            provider,
            this.numThreads
          );
          this.recognizer =
            typeof sherpaOnnx.OfflineRecognizer.createAsync === 'function'
              ? await sherpaOnnx.OfflineRecognizer.createAsync(config)
              : new sherpaOnnx.OfflineRecognizer(config);
        }

        this.activeProvider = provider;
        return;
      } catch (error) {
        lastError = error;
        this.recognizer = null;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No supported ASR provider is available');
  }

  async transcribe(audioSamples: Float32Array): Promise<string> {
    if (!this.recognizer) {
      throw new Error('ASR engine not initialized');
    }

    if (this.recognitionMode !== 'non_streaming') {
      throw new Error('transcribe() is only available in non-streaming mode');
    }

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate: this.sampleRate, samples: audioSamples });
    const result =
      typeof this.recognizer.decodeAsync === 'function'
        ? await this.recognizer.decodeAsync(stream)
        : (this.recognizer.decode(stream), this.recognizer.getResult(stream));
    return result.text || '';
  }

  startStreamingSession(): void {
    if (this.recognitionMode !== 'streaming_output') {
      throw new Error('Streaming session is only available in streaming mode');
    }
    if (!this.recognizer) {
      throw new Error('ASR engine not initialized');
    }

    this.streamingStream = this.recognizer.createStream();
  }

  acceptStreamingAudio(audioSamples: Float32Array): string {
    if (!this.streamingStream || !this.recognizer) {
      throw new Error('Streaming session not started');
    }

    this.streamingStream.acceptWaveform({
      sampleRate: this.sampleRate,
      samples: audioSamples,
    });

    while (this.recognizer.isReady(this.streamingStream)) {
      this.recognizer.decode(this.streamingStream);
    }

    return this.recognizer.getResult(this.streamingStream).text || '';
  }

  finishStreamingSession(): string {
    if (!this.streamingStream || !this.recognizer) {
      return '';
    }

    this.streamingStream.inputFinished();
    while (this.recognizer.isReady(this.streamingStream)) {
      this.recognizer.decode(this.streamingStream);
    }

    const text = this.recognizer.getResult(this.streamingStream).text || '';
    this.streamingStream = null;
    return text;
  }

  cancelStreamingSession(): void {
    if (!this.streamingStream || !this.recognizer) {
      return;
    }

    if (typeof this.recognizer.reset === 'function') {
      this.recognizer.reset(this.streamingStream);
    }
    this.streamingStream = null;
  }

  getModelPath(): string | null {
    return this.modelFiles?.modelPath ?? null;
  }

  getModelDirectory(): string | null {
    return this.modelFiles?.modelPath ? path.dirname(this.modelFiles.modelPath) : null;
  }

  getTokensPath(): string | null {
    return this.modelFiles?.tokensPath ?? null;
  }

  getBpeVocabPath(): string | null {
    return this.modelFiles?.bpeVocabPath ?? null;
  }

  getActiveProvider(): ProviderName | null {
    return this.activeProvider;
  }

  getNumThreads(): number {
    return this.numThreads;
  }

  getRuntimeLabel(): string {
    if (!this.activeProvider) {
      return 'ready';
    }

    const providerLabel = this.activeProvider === 'cpu'
      ? 'CPU'
      : this.activeProvider === 'coreml'
        ? 'GPU · CoreML'
        : this.activeProvider === 'cuda'
          ? 'GPU · CUDA'
          : 'GPU · DirectML';

    const modeLabel = this.recognitionMode === 'streaming_output' ? 'streaming' : 'offline';
    return `ready · ${modeLabel} · ${providerLabel} · ${this.numThreads} threads`;
  }

  getRecognitionMode(): RecognitionMode {
    return this.recognitionMode;
  }

  static findModelPath(searchPaths: string[], recognitionMode?: RecognitionMode): ModelFiles | null {
    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) {
        continue;
      }

      if (isModelDirectoryCompatible(searchPath, recognitionMode)) {
        const modelFiles = getModelFilesFromDirectory(searchPath);
        if (modelFiles) {
          return modelFiles;
        }
      }
    }

    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) continue;

      try {
        const entries = fs
          .readdirSync(searchPath, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subPath = path.join(searchPath, entry.name);
            const result = AsrEngine.findModelPath([subPath], recognitionMode);
            if (result) return result;
          }
        }
      } catch {
        // Ignore errors reading directory
      }
    }

    return null;
  }

  destroy(): void {
    this.recognizer = null;
    this.streamingStream = null;
  }
}
