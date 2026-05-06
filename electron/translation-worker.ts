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
    env.remoteHost = 'https://hf-mirror.com/';
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
    pipelinePromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('translation', modelId, { dtype: 'q8' })
    ) as Promise<TranslationPipeline>;
    pipelineCache.set(cacheKey, pipelinePromise);
  }

  return pipelinePromise;
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
