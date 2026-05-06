import { AsrEngine } from './asr-engine';

type WorkerRequest =
  | {
      type: 'init';
      modelPath: string;
      tokensPath: string;
    }
  | {
      type: 'transcribe';
      requestId: number;
      samplesBuffer: Buffer | Uint8Array;
    };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; requestId: number; text: string }
  | { type: 'error'; requestId?: number; message: string };

let engine: AsrEngine | null = null;

function toFloat32Array(samplesBuffer: Buffer | Uint8Array): Float32Array {
  const buffer = Buffer.isBuffer(samplesBuffer) ? samplesBuffer : Buffer.from(samplesBuffer);
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
  ).slice();
}

async function handleInit(message: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  engine = new AsrEngine({
    modelPath: message.modelPath,
    tokensPath: message.tokensPath,
  });
  await engine.initialize();
  process.send?.({ type: 'ready' } satisfies WorkerResponse);
}

async function handleTranscribe(
  message: Extract<WorkerRequest, { type: 'transcribe' }>
): Promise<void> {
  if (!engine) {
    throw new Error('ASR engine not initialized');
  }

  const text = await engine.transcribe(toFloat32Array(message.samplesBuffer));
  process.send?.({
    type: 'result',
    requestId: message.requestId,
    text,
  } satisfies WorkerResponse);
}

process.on('message', (message: WorkerRequest) => {
  void (async () => {
    try {
      if (message.type === 'init') {
        await handleInit(message);
        return;
      }

      if (message.type === 'transcribe') {
        await handleTranscribe(message);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      process.send?.({
        type: 'error',
        requestId: message.type === 'transcribe' ? message.requestId : undefined,
        message: messageText,
      } satisfies WorkerResponse);
    }
  })();
});
