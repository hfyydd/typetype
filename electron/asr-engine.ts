import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { app } from 'electron';

import { getDefaultNumThreads, getProviderCandidates, ProviderName } from './asr-runtime';
import { stripUnknownTokens } from './transcript-cleanup';
import { ComputeBackend, RecognitionMode, RichAsrResult } from './types';

export interface ModelFiles {
  modelPath: string;
  tokensPath: string;
  modelKind?: 'single' | 'paraformer';
  encoderPath?: string | null;
  decoderPath?: string | null;
  bpeVocabPath?: string | null;
  hotwordsPath?: string | null;
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
  modelFiles: ModelFiles,
  provider: ProviderName,
  numThreads: number
) {
  const isParaformer = Boolean(modelFiles.encoderPath && modelFiles.decoderPath);
  const modelConfig: Record<string, unknown> = {
    tokens: modelFiles.tokensPath,
    numThreads,
    provider,
    debug: false,
  };

  if (isParaformer) {
    modelConfig.paraformer = {
      encoder: modelFiles.encoderPath,
      decoder: modelFiles.decoderPath,
    };
  } else {
    modelConfig.zipformer2Ctc = {
      model: modelFiles.modelPath,
    };
    modelConfig.modelingUnit = modelFiles.bpeVocabPath ? 'bpe' : 'cjkchar';
    modelConfig.bpeVocab = modelFiles.bpeVocabPath ?? '';
  }

  const canUseHotwords = Boolean(modelFiles.hotwordsPath && !isParaformer);
  const config: Record<string, unknown> = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig,
    decodingMethod: canUseHotwords ? 'modified_beam_search' : 'greedy_search',
    maxActivePaths: canUseHotwords ? 4 : 1,
    enableEndpoint: true,
    rule1MinTrailingSilence: 1.8,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 12,
    blankPenalty: 0,
  };

  if (canUseHotwords) {
    config.hotwordsFile = modelFiles.hotwordsPath;
    config.hotwordsScore = 1.5;
  }

  return {
    ...config,
  };
}

interface AsrEngineOptions {
  computeBackend?: ComputeBackend;
  numThreads?: number;
  recognitionMode?: RecognitionMode;
}

function getModelFilesFromDirectory(modelDirectory: string): ModelFiles | null {
  const modelCandidates = [
    path.join(modelDirectory, 'model.fp16.onnx'),
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

    const bpeVocabPath = [
      path.join(modelDirectory, 'bpe.model'),
      path.join(modelDirectory, 'bbpe.model'),
    ].find((candidate) => fs.existsSync(candidate)) ?? null;
    return {
      modelPath: modelCandidate,
      tokensPath: tokensCandidate,
      modelKind: 'single',
      bpeVocabPath,
      hotwordsPath: fs.existsSync(path.join(modelDirectory, 'hotwords.txt'))
        ? path.join(modelDirectory, 'hotwords.txt')
        : null,
    };
  }

  const encoderPath = [
    path.join(modelDirectory, 'encoder.fp16.onnx'),
    path.join(modelDirectory, 'encoder.int8.onnx'),
    path.join(modelDirectory, 'encoder.onnx'),
  ].find((candidate) => fs.existsSync(candidate));
  const decoderPath = [
    path.join(modelDirectory, 'decoder.fp16.onnx'),
    path.join(modelDirectory, 'decoder.int8.onnx'),
    path.join(modelDirectory, 'decoder.onnx'),
  ].find((candidate) => fs.existsSync(candidate));
  const tokensCandidate = path.join(modelDirectory, 'tokens.txt');

  if (encoderPath && decoderPath && fs.existsSync(tokensCandidate)) {
    return {
      modelPath: encoderPath,
      tokensPath: tokensCandidate,
      modelKind: 'paraformer',
      encoderPath,
      decoderPath,
      bpeVocabPath: null,
      hotwordsPath: fs.existsSync(path.join(modelDirectory, 'hotwords.txt'))
        ? path.join(modelDirectory, 'hotwords.txt')
        : null,
    };
  }

  return null;
}

function isAsciiPath(value: string): boolean {
  return /^[\x00-\x7f]*$/.test(value);
}

function hasOnlyAsciiModelPaths(modelFiles: ModelFiles): boolean {
  return (
    isAsciiPath(modelFiles.modelPath) &&
    isAsciiPath(modelFiles.tokensPath) &&
    (!modelFiles.encoderPath || isAsciiPath(modelFiles.encoderPath)) &&
    (!modelFiles.decoderPath || isAsciiPath(modelFiles.decoderPath)) &&
    (!modelFiles.bpeVocabPath || isAsciiPath(modelFiles.bpeVocabPath)) &&
    (!modelFiles.hotwordsPath || isAsciiPath(modelFiles.hotwordsPath))
  );
}

function sanitizeLinkName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'model';
}

function tryCreateWritableDirectory(candidate: string | null | undefined): string | null {
  if (!candidate || !isAsciiPath(candidate)) {
    return null;
  }

  try {
    fs.mkdirSync(candidate, { recursive: true });
    const probe = path.join(candidate, `.probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return candidate;
  } catch {
    return null;
  }
}

function getAsciiModelLinkRoot(): string | null {
  const candidates = [
    process.env.TYPETYPE_MODEL_LINK_DIR,
    process.env.PROGRAMDATA ? path.join(process.env.PROGRAMDATA, 'typetype', 'model-links') : null,
    'C:\\ProgramData\\typetype\\model-links',
    (() => {
      try {
        const userData = app.getPath('userData');
        return isAsciiPath(userData) ? path.join(userData, 'model-links') : null;
      } catch {
        return null;
      }
    })(),
    process.env.TEMP && isAsciiPath(process.env.TEMP)
      ? path.join(process.env.TEMP, 'typetype-model-links')
      : null,
  ];

  for (const candidate of candidates) {
    const writable = tryCreateWritableDirectory(candidate);
    if (writable) {
      return writable;
    }
  }

  return null;
}

function ensureAsciiModelFiles(modelFiles: ModelFiles): ModelFiles {
  if (hasOnlyAsciiModelPaths(modelFiles)) {
    return modelFiles;
  }

  const modelDirectory = path.dirname(modelFiles.modelPath);
  const linkRoot = getAsciiModelLinkRoot();
  if (!linkRoot) {
    return modelFiles;
  }

  const linkName = [
    sanitizeLinkName(path.basename(modelDirectory)),
    crypto.createHash('sha1').update(modelDirectory).digest('hex').slice(0, 10),
  ].join('-');
  const linkDirectory = path.join(linkRoot, linkName);

  try {
    if (fs.existsSync(linkDirectory) && !getModelFilesFromDirectory(linkDirectory)) {
      fs.rmSync(linkDirectory, { recursive: true, force: true });
    }

    if (!fs.existsSync(linkDirectory)) {
      fs.symlinkSync(modelDirectory, linkDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    }

    const linkedModelFiles = getModelFilesFromDirectory(linkDirectory);
    if (linkedModelFiles && hasOnlyAsciiModelPaths(linkedModelFiles)) {
      return linkedModelFiles;
    }
  } catch (error) {
    console.warn('Failed to create ASCII model path link:', error);
  }

  return modelFiles;
}

function isModelDirectoryCompatible(
  modelDirectory: string,
  recognitionMode?: RecognitionMode
): boolean {
  if (!recognitionMode) {
    return true;
  }

  const directoryName = path.basename(modelDirectory).toLowerCase();
  const hasBpeVocab =
    fs.existsSync(path.join(modelDirectory, 'bpe.model')) ||
    fs.existsSync(path.join(modelDirectory, 'bbpe.model'));
  const hasParaformerFiles =
    (
      fs.existsSync(path.join(modelDirectory, 'encoder.int8.onnx')) ||
      fs.existsSync(path.join(modelDirectory, 'encoder.fp16.onnx')) ||
      fs.existsSync(path.join(modelDirectory, 'encoder.onnx'))
    ) &&
    (
      fs.existsSync(path.join(modelDirectory, 'decoder.int8.onnx')) ||
      fs.existsSync(path.join(modelDirectory, 'decoder.fp16.onnx')) ||
      fs.existsSync(path.join(modelDirectory, 'decoder.onnx'))
    );
  const looksStreaming =
    directoryName.includes('streaming') ||
    directoryName.includes('zipformer') ||
    directoryName.includes('paraformer') ||
    hasParaformerFiles ||
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

    this.modelFiles = ensureAsciiModelFiles(this.modelFiles);

    if (!fs.existsSync(this.modelFiles.modelPath)) {
      throw new Error(`Model file not found: ${this.modelFiles.modelPath}`);
    }

    if (!fs.existsSync(this.modelFiles.tokensPath)) {
      throw new Error(`Tokens file not found: ${this.modelFiles.tokensPath}`);
    }

    if (this.modelFiles.bpeVocabPath && !fs.existsSync(this.modelFiles.bpeVocabPath)) {
      throw new Error(`BPE vocab file not found: ${this.modelFiles.bpeVocabPath}`);
    }

    if (this.modelFiles.encoderPath && !fs.existsSync(this.modelFiles.encoderPath)) {
      throw new Error(`Encoder file not found: ${this.modelFiles.encoderPath}`);
    }

    if (this.modelFiles.decoderPath && !fs.existsSync(this.modelFiles.decoderPath)) {
      throw new Error(`Decoder file not found: ${this.modelFiles.decoderPath}`);
    }

    if (this.modelFiles.hotwordsPath && !fs.existsSync(this.modelFiles.hotwordsPath)) {
      throw new Error(`Hotwords file not found: ${this.modelFiles.hotwordsPath}`);
    }

    const sherpaOnnx = loadSherpaOnnxNode();
    let lastError: unknown = null;

    for (const provider of getProviderCandidates(this.computeBackend)) {
      try {
        if (this.recognitionMode === 'streaming_output') {
          const config = createStreamingRecognizerConfig(
            this.modelFiles,
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
          this.recognizer = new sherpaOnnx.OfflineRecognizer(config);
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
    return (await this.transcribeRich(audioSamples)).text;
  }

  async transcribeRich(audioSamples: Float32Array): Promise<RichAsrResult> {
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
    return normalizeOfflineResult(result);
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

    return stripUnknownTokens(this.recognizer.getResult(this.streamingStream).text || '');
  }

  finishStreamingSession(): string {
    if (!this.streamingStream || !this.recognizer) {
      return '';
    }

    this.streamingStream.inputFinished();
    while (this.recognizer.isReady(this.streamingStream)) {
      this.recognizer.decode(this.streamingStream);
    }

    const text = stripUnknownTokens(this.recognizer.getResult(this.streamingStream).text || '');
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

function normalizeOfflineResult(result: any): RichAsrResult {
  const text = stripUnknownTokens(String(result?.text ?? ''));
  const tokens: string[] = Array.isArray(result?.tokens)
    ? result.tokens.map((token: unknown) => stripUnknownTokens(String(token))).filter(Boolean)
    : [];
  const timestamps: number[] = Array.isArray(result?.timestamps) ? result.timestamps.map(Number) : [];
  const durations: number[] = Array.isArray(result?.durations) ? result.durations.map(Number) : [];
  const logProbs: number[] = Array.isArray(result?.ys_log_probs) ? result.ys_log_probs.map(Number) : [];
  const confidence = logProbs.length > 0
    ? Math.max(0, Math.min(1, Math.exp(logProbs.reduce((sum, value) => sum + value, 0) / logProbs.length)))
    : undefined;

  return {
    text,
    language: typeof result?.lang === 'string' ? result.lang : undefined,
    confidence,
    segments: tokens.map((token, index) => ({
      text: token,
      start: Number.isFinite(timestamps[index]) ? timestamps[index] : undefined,
      end: Number.isFinite(timestamps[index]) && Number.isFinite(durations[index])
        ? timestamps[index] + durations[index]
        : undefined,
    })),
    candidates: text ? [text] : [],
    code_switch_hints: [],
  };
}
