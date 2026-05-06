import { ChildProcess, ForkOptions, fork } from 'child_process';

export const TRANSCRIPTION_STOPPED_ERROR_MESSAGE = 'Transcription stopped';

interface EnsureReadyOptions {
  modelPath: string;
  tokensPath: string;
}

interface TranscribeOptions extends EnsureReadyOptions {
  samples: Float32Array;
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; requestId: number; text: string }
  | { type: 'error'; requestId?: number; message: string };

type ForkFn = (modulePath: string, args?: readonly string[], options?: ForkOptions) => ChildProcess;

export class TranscriptionRunner {
  private worker: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyKey: string | null = null;
  private requestId = 0;

  constructor(
    private readonly workerPath: string,
    private readonly forkProcess: ForkFn = fork
  ) {}

  async ensureReady({ modelPath, tokensPath }: EnsureReadyOptions): Promise<void> {
    const nextKey = `${modelPath}::${tokensPath}`;
    if (this.worker && this.readyPromise && this.readyKey === nextKey) {
      return this.readyPromise;
    }

    this.cancel();
    const worker = this.createWorker();
    this.worker = worker;
    this.readyKey = nextKey;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      };

      const onMessage = (message: WorkerMessage) => {
        if (message.type === 'ready') {
          cleanup();
          resolve();
          return;
        }

        if (message.type === 'error' && message.requestId === undefined) {
          cleanup();
          reject(new Error(message.message));
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onExit = () => {
        cleanup();
        reject(new Error(TRANSCRIPTION_STOPPED_ERROR_MESSAGE));
      };

      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.send({ type: 'init', modelPath, tokensPath });
    }).catch((error) => {
      if (this.worker === worker) {
        this.worker = null;
        this.readyPromise = null;
        this.readyKey = null;
      }
      throw error;
    });

    return this.readyPromise;
  }

  async transcribe({ modelPath, tokensPath, samples }: TranscribeOptions): Promise<string> {
    await this.ensureReady({ modelPath, tokensPath });
    if (!this.worker) {
      throw new Error(TRANSCRIPTION_STOPPED_ERROR_MESSAGE);
    }

    const worker = this.worker;
    const requestId = ++this.requestId;

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      };

      const onMessage = (message: WorkerMessage) => {
        if (message.type === 'result' && message.requestId === requestId) {
          cleanup();
          resolve(message.text);
          return;
        }

        if (message.type === 'error' && message.requestId === requestId) {
          cleanup();
          reject(new Error(message.message));
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onExit = () => {
        cleanup();
        reject(new Error(TRANSCRIPTION_STOPPED_ERROR_MESSAGE));
      };

      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.send({
        type: 'transcribe',
        requestId,
        samplesBuffer: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
      });
    });
  }

  cancel(): void {
    const worker = this.worker;
    this.worker = null;
    this.readyPromise = null;
    this.readyKey = null;
    if (!worker) {
      return;
    }

    worker.kill('SIGTERM');
  }

  private createWorker(): ChildProcess {
    return this.forkProcess(this.workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
  }
}
