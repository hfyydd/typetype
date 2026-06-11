/**
 * ASR engine worker — runs in a forked child process so the synchronous
 * sherpa-onnx recognizer constructor (and every ASR call) never touches
 * the main process event loop. The main process talks to us over IPC
 * via the message protocol declared below; see `asr-engine-proxy.ts` for
 * the other half of that contract.
 */
import { AsrEngine } from './asr-engine';
import type { ModelFiles } from './asr-engine';
import type { RichAsrSegment } from './types';
import { ProviderName, getDefaultNumThreads } from './asr-runtime';
import { stripUnknownTokens } from './transcript-cleanup';

export type AsrRecognitionMode = 'non_streaming' | 'streaming_output';

// Catch any import-time error (e.g. an unpacked native module that
// cannot be located in the plain-Node child process) and surface it
// as a structured initError so the main process can see exactly what
// went wrong instead of just 'worker exited with code 1'.
process.on('uncaughtException', (error) => {
  console.error('[asr-engine-worker] startup-uncaughtException', error);
  if (process.send) {
    process.send({
      type: 'initError',
      message: `startup failed: ${error instanceof Error ? error.message : String(error)}`,
    } satisfies AsrWorkerResponse);
  }
  // Give the IPC a tick to flush before exiting.
  setImmediate(() => process.exit(1));
});
export type AsrComputeBackend = 'auto' | 'cpu' | 'gpu';

export type AsrWorkerRequest =
  | {
      type: 'init';
      modelFiles: ModelFiles;
      recognitionMode: AsrRecognitionMode;
      computeBackend: AsrComputeBackend;
      numThreads?: number;
    }
  | {
      type: 'transcribe';
      requestId: number;
      samples: number[];
    }
  | {
      type: 'startStreaming';
    }
  | {
      type: 'feedAudio';
      requestId: number;
      samples: number[];
    }
  | {
      type: 'finishStreaming';
      requestId: number;
    }
  | {
      type: 'cancelStreaming';
    }
  | {
      type: 'getStatus';
    }
  | {
      type: 'destroy';
    }
  | {
      type: 'shutdown';
    };

export type AsrWorkerResponse =
  | {
      type: 'ready';
      provider: ProviderName;
      runtimeLabel: string;
      recognitionMode: AsrRecognitionMode;
      modelPath: string | null;
      modelDirectory: string | null;
    }
  | { type: 'initError'; message: string }
  | { type: 'transcribeResult'; requestId: number; text: string; language: string | null; confidence: number | null; segments: RichAsrSegment[]; candidates: string[]; code_switch_hints: string[] }
  | { type: 'transcribeError'; requestId: number; message: string }
  | { type: 'streamingStarted' }
  | { type: 'streamingResult'; requestId: number; text: string; isFinal: boolean }
  | { type: 'streamingError'; requestId: number; message: string }
  | {
      type: 'status';
      provider: ProviderName | null;
      runtimeLabel: string;
      recognitionMode: AsrRecognitionMode | null;
      modelPath: string | null;
      modelDirectory: string | null;
    }
  | { type: 'destroyed' }
  | { type: 'shutdownComplete' };

let engine: AsrEngine | null = null;

function samplesToFloat32(samples: number[]): Float32Array {
  const buffer = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    buffer[i] = samples[i];
  }
  return buffer;
}

function send(message: AsrWorkerResponse): void {
  if (process.send) {
    process.send(message);
  }
}

async function handleInit(message: Extract<AsrWorkerRequest, { type: 'init' }>): Promise<void> {
  if (engine) {
    engine.destroy();
    engine = null;
  }
  const next = new AsrEngine(message.modelFiles, {
    computeBackend: message.computeBackend,
    recognitionMode: message.recognitionMode,
    numThreads: message.numThreads ?? getDefaultNumThreads(),
  });
  await next.initialize();
  engine = next;
  send({
    type: 'ready',
    provider: next.getActiveProvider() ?? 'cpu',
    runtimeLabel: next.getRuntimeLabel(),
    recognitionMode: message.recognitionMode,
    modelPath: next.getModelPath(),
    modelDirectory: next.getModelDirectory(),
  });
}

async function handleTranscribe(
  message: Extract<AsrWorkerRequest, { type: 'transcribe' }>,
): Promise<void> {
  if (!engine) {
    throw new Error('ASR engine not initialized');
  }
  const samples = samplesToFloat32(message.samples);
  const result = await engine.transcribeRich(samples);
  send({
    type: 'transcribeResult',
    requestId: message.requestId,
    text: result.text,
    language: result.language ?? null,
    confidence: result.confidence ?? null,
    segments: result.segments ?? [],
    candidates: result.candidates ?? [],
    code_switch_hints: result.code_switch_hints ?? [],
  });
}

function handleStartStreaming(): void {
  if (!engine) {
    throw new Error('ASR engine not initialized');
  }
  engine.startStreamingSession();
  send({ type: 'streamingStarted' });
}

function handleFeedAudio(message: Extract<AsrWorkerRequest, { type: 'feedAudio' }>): void {
  if (!engine) {
    throw new Error('ASR engine not initialized');
  }
  const samples = samplesToFloat32(message.samples);
  const text = engine.acceptStreamingAudio(samples);
  send({
    type: 'streamingResult',
    requestId: message.requestId,
    text: stripUnknownTokens(text),
    isFinal: false,
  });
}

function handleFinishStreaming(
  message: Extract<AsrWorkerRequest, { type: 'finishStreaming' }>,
): void {
  if (!engine) {
    throw new Error('ASR engine not initialized');
  }
  const text = engine.finishStreamingSession();
  send({
    type: 'streamingResult',
    requestId: message.requestId,
    text: stripUnknownTokens(text),
    isFinal: true,
  });
}

function handleCancelStreaming(): void {
  engine?.cancelStreamingSession();
}

function handleGetStatus(): void {
  if (!engine) {
    send({
      type: 'status',
      provider: null,
      runtimeLabel: 'not initialized',
      recognitionMode: null,
      modelPath: null,
      modelDirectory: null,
    });
    return;
  }
  send({
    type: 'status',
    provider: engine.getActiveProvider(),
    runtimeLabel: engine.getRuntimeLabel(),
    recognitionMode: engine.getRecognitionMode(),
    modelPath: engine.getModelPath(),
    modelDirectory: engine.getModelDirectory(),
  });
}

function handleDestroy(): void {
  if (engine) {
    engine.destroy();
    engine = null;
  }
  send({ type: 'destroyed' });
}

function handleShutdown(): void {
  if (engine) {
    engine.destroy();
    engine = null;
  }
  send({ type: 'shutdownComplete' });
  // Give the IPC a tick to flush, then exit.
  setImmediate(() => {
    process.exit(0);
  });
}

function reportError(message: AsrWorkerRequest, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  if (message.type === 'init') {
    send({ type: 'initError', message: text });
    return;
  }
  if (message.type === 'transcribe') {
    send({ type: 'transcribeError', requestId: message.requestId, message: text });
    return;
  }
  if (message.type === 'feedAudio' || message.type === 'finishStreaming') {
    send({ type: 'streamingError', requestId: message.requestId, message: text });
    return;
  }
  // For non-request messages we just log; the main process will see the
  // process exit and tear down the proxy.
  console.error('[asr-engine-worker] unhandled error', error);
}

process.on('message', (raw: unknown) => {
  const message = raw as AsrWorkerRequest;
  void (async () => {
    try {
      switch (message.type) {
        case 'init':
          await handleInit(message);
          return;
        case 'transcribe':
          await handleTranscribe(message);
          return;
        case 'startStreaming':
          handleStartStreaming();
          return;
        case 'feedAudio':
          handleFeedAudio(message);
          return;
        case 'finishStreaming':
          handleFinishStreaming(message);
          return;
        case 'cancelStreaming':
          handleCancelStreaming();
          return;
        case 'getStatus':
          handleGetStatus();
          return;
        case 'destroy':
          handleDestroy();
          return;
        case 'shutdown':
          handleShutdown();
          return;
        default: {
          const exhaustive: never = message;
          throw new Error(`Unknown ASR worker request: ${JSON.stringify(exhaustive)}`);
        }
      }
    } catch (error) {
      reportError(message, error);
    }
  })();
});

process.on('uncaughtException', (error) => {
  console.error('[asr-engine-worker] uncaughtException', error);
  send({ type: 'initError', message: error.message });
});

process.on('unhandledRejection', (error) => {
  console.error('[asr-engine-worker] unhandledRejection', error);
  const message = error instanceof Error ? error.message : String(error);
  send({ type: 'initError', message });
});
