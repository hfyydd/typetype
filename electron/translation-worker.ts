interface TranslateRequestMessage {
  type: 'translate';
  requestId: number;
  modelId: string;
  cacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
}

interface TranslateResponseMessage {
  type: 'result' | 'error';
  requestId: number;
  text?: string;
  error?: string;
}

type TranslationPipeline = (text: string, options: Record<string, unknown>) => Promise<Array<{
  translation_text?: string;
  generated_text?: string;
}>>;

let configuredCacheDir: string | null = null;
const pipelineCache = new Map<string, Promise<TranslationPipeline>>();
const PIPELINE_LOAD_ATTEMPTS = 3;

const messagePort = typeof process.send === 'function'
  ? {
      onMessage(handler: (message: TranslateRequestMessage) => void) {
        process.on('message', (message) => {
          handler(message as TranslateRequestMessage);
        });
      },
      send(message: TranslateResponseMessage) {
        process.send?.(message);
      },
    }
  : null;

async function loadPipeline(cacheDir: string, modelId: string): Promise<TranslationPipeline> {
  if (configuredCacheDir !== cacheDir) {
    const { env } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    env.remoteHost = process.env.TYPETYPE_HF_REMOTE_HOST || 'https://hf-mirror.com/';
    configuredCacheDir = cacheDir;
  }

  const cacheKey = `${cacheDir}:${modelId}`;
  let pipelinePromise = pipelineCache.get(cacheKey);
  if (!pipelinePromise) {
    console.log('[translation-debug] worker-load-pipeline', {
      cacheDir,
      modelId,
      dtype: 'q8',
    });
    pipelinePromise = loadPipelineWithRetry(cacheDir, modelId);
    pipelineCache.set(cacheKey, pipelinePromise);
  }

  return pipelinePromise;
}

async function loadPipelineWithRetry(cacheDir: string, modelId: string): Promise<TranslationPipeline> {
  const { pipeline } = await import('@huggingface/transformers');
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= PIPELINE_LOAD_ATTEMPTS; attempt += 1) {
    try {
      cleanupPartialDownloads(cacheDir, modelId);
      console.log('[translation-debug] worker-load-attempt', {
        modelId,
        attempt,
        maxAttempts: PIPELINE_LOAD_ATTEMPTS,
      });
      return await pipeline('translation', modelId, {
        dtype: 'q8',
        progress_callback: createProgressLogger(modelId),
      }) as TranslationPipeline;
    } catch (error) {
      lastError = error;
      console.error('[translation-debug] worker-load-attempt-error', {
        modelId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt < PIPELINE_LOAD_ATTEMPTS) {
        await delay(1000 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function cleanupPartialDownloads(cacheDir: string, modelId: string): void {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const modelDir = path.join(cacheDir, ...modelId.split('/'));

  if (!fs.existsSync(modelDir)) {
    return;
  }

  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (entry.name.includes('.tmp.')) {
        try {
          fs.rmSync(fullPath, { force: true });
          console.log('[translation-debug] removed-partial-download', { file: fullPath });
        } catch {
          // Best-effort cleanup only. The next download attempt can still fail normally.
        }
      }
    }
  };

  visit(modelDir);
}

function createProgressLogger(modelId: string): (data: Record<string, unknown>) => void {
  const loggedProgress = new Map<string, number>();

  return (data: Record<string, unknown>) => {
    if (data.status !== 'progress') {
      return;
    }

    const file = String(data.file ?? data.name ?? '');
    const progress = typeof data.progress === 'number' ? data.progress : 0;
    const bucket = Math.floor(progress / 20) * 20;
    const key = `${file}:${bucket}`;

    if (!file || loggedProgress.has(key)) {
      return;
    }

    loggedProgress.set(key, bucket);
    console.log('[translation-debug] worker-download-progress', {
      modelId,
      file,
      progress: Math.round(progress),
    });
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleTranslate(message: TranslateRequestMessage): Promise<TranslateResponseMessage> {
  try {
    console.log('[translation-debug] worker-handle-translate', {
      requestId: message.requestId,
      sourceLanguage: message.sourceLanguage,
      targetLanguage: message.targetLanguage,
      text: message.text,
    });
    const translator = await loadPipeline(message.cacheDir, message.modelId);
    const output = await translator(message.text, {
      src_lang: message.sourceLanguage,
      tgt_lang: message.targetLanguage,
      max_length: 256,
    });
    const translated = output[0]?.translation_text ?? output[0]?.generated_text ?? '';
    console.log('[translation-debug] worker-handle-result', {
      requestId: message.requestId,
      text: translated.trim(),
    });

    return {
      type: 'result',
      requestId: message.requestId,
      text: translated.trim(),
    };
  } catch (error) {
    console.error('[translation-debug] worker-handle-error', error);
    return {
      type: 'error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!messagePort) {
  throw new Error('translation worker started without IPC channel');
}

messagePort.onMessage(async (message: TranslateRequestMessage) => {
  if (message.type !== 'translate') {
    return;
  }

  const response = await handleTranslate(message);
  messagePort.send(response);
});
