import { app } from 'electron';

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as tar from 'tar-stream';
import * as bzip2 from 'bzip2';

import { AsrEngine } from './asr-engine';
import { Settings } from './types';
import { getModelSearchPaths } from './model-search-paths';

export interface InitializeAsrEngineOptions {
  dataDir: string;
  settings: Settings;
  processResourcesPath?: string;
  appPath?: string;
}

const SENSE_VOICE_MODEL_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09';
const STREAMING_XLARGE_MODEL_DIR = 'sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8-2025-06-30';

const MODEL_DOWNLOAD_URLS = {
  'sherpa-onnx-sense-voice': {
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${SENSE_VOICE_MODEL_DIR}.tar.bz2`,
    archiveName: `${SENSE_VOICE_MODEL_DIR}.tar.bz2`,
    modelDirName: SENSE_VOICE_MODEL_DIR,
  },
  'sherpa-onnx-streaming-zipformer-ctc-zh-xlarge': {
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${STREAMING_XLARGE_MODEL_DIR}.tar.bz2`,
    archiveName: `${STREAMING_XLARGE_MODEL_DIR}.tar.bz2`,
    modelDirName: STREAMING_XLARGE_MODEL_DIR,
  },
};

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
  redirectCount = 0
): Promise<void> {
  if (redirectCount > 5) {
    throw new Error('Download failed: too many redirects');
  }

  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true });

  const tempPath = path.join(
    destDir,
    `${path.basename(destPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.download`
  );

  return new Promise((resolve, reject) => {
    let file: fs.WriteStream | null = null;
    let settled = false;
    let receivedBytes = 0;
    let totalBytes = 0;

    const cleanupTempFile = () => {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup only; download failure should not crash the main process.
      }
    };

    const settleWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (file && !file.closed) {
        file.destroy();
      }
      cleanupTempFile();
      reject(error);
    };

    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);

      if (isRedirect) {
        response.resume();
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          settleWithError(new Error(`Download redirect missing location header: ${statusCode}`));
          return;
        }

        settled = true;
        const nextUrl = new URL(redirectUrl, url).toString();
        downloadFile(nextUrl, destPath, onProgress, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        settleWithError(new Error(`Download failed with status ${statusCode}`));
        return;
      }

      totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      file = fs.createWriteStream(tempPath, { flags: 'wx' });

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (onProgress && totalBytes > 0) {
          onProgress(receivedBytes, totalBytes);
        }
      });

      response.on('error', (error) => {
        settleWithError(error instanceof Error ? error : new Error(String(error)));
      });

      file.on('error', (error) => {
        settleWithError(error instanceof Error ? error : new Error(String(error)));
      });

      file.on('finish', () => {
        file?.close((closeError) => {
          if (closeError) {
            settleWithError(closeError);
            return;
          }

          try {
            fs.rmSync(destPath, { force: true });
            fs.renameSync(tempPath, destPath);
            settled = true;
            resolve();
          } catch (error) {
            settleWithError(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });

      response.pipe(file);
    });

    request.on('error', (error) => {
      settleWithError(error instanceof Error ? error : new Error(String(error)));
    });

    request.setTimeout(120000, () => {
      request.destroy(new Error('Download timeout'));
    });
  });
}

function modelDirectoryHasRequiredFiles(modelDir: string): boolean {
  return (
    fs.existsSync(path.join(modelDir, 'tokens.txt')) &&
    (
      fs.existsSync(path.join(modelDir, 'model.int8.onnx')) ||
      fs.existsSync(path.join(modelDir, 'model.onnx'))
    )
  );
}

async function extractModelArchive(archivePath: string, modelsDir: string, modelDir: string): Promise<void> {
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.rmSync(modelDir, { recursive: true, force: true });

  try {
    const fileContent = fs.readFileSync(archivePath);
    const decompressed = bzip2.decompress(fileContent);
    const extractor = tar.extract();

    await new Promise<void>((resolve, reject) => {
      const entries: { name: string; data: Buffer[] }[] = [];

      extractor.on('entry', (headers, stream, next) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          entries.push({ name: headers.name, data: chunks });
          next();
        });
        stream.resume();
      });

      extractor.on('finish', () => {
        try {
          for (const entry of entries) {
            const entryPath = path.join(modelsDir, entry.name);
            if (entry.name.endsWith('/')) {
              fs.mkdirSync(entryPath, { recursive: true });
            } else {
              fs.mkdirSync(path.dirname(entryPath), { recursive: true });
              fs.writeFileSync(entryPath, Buffer.concat(entry.data));
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      extractor.on('error', reject);
      extractor.end(decompressed);
    });

    if (!modelDirectoryHasRequiredFiles(modelDir)) {
      throw new Error(`Extracted model is missing model.int8.onnx/model.onnx or tokens.txt: ${modelDir}`);
    }
  } catch (error) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
}

async function downloadModel(modelName: string, dataDir: string): Promise<string | null> {
  const modelInfo = MODEL_DOWNLOAD_URLS[modelName as keyof typeof MODEL_DOWNLOAD_URLS];
  if (!modelInfo) {
    console.error(`No download URL for model: ${modelName}`);
    return null;
  }

  const modelsDir = path.join(dataDir, 'models');
  const modelDir = path.join(modelsDir, modelInfo.modelDirName);
  const archivePath = path.join(modelsDir, modelInfo.archiveName);

  if (modelDirectoryHasRequiredFiles(modelDir)) {
    console.log(`Model ${modelName} already exists at ${modelDir}`);
    return modelDir;
  }

  console.log(`Downloading model ${modelName} to ${modelsDir}...`);

  try {
    await downloadFile(modelInfo.url, archivePath, (received, total) => {
      const mb = (received / (1024 * 1024)).toFixed(1);
      const totalMb = (total / (1024 * 1024)).toFixed(1);
      process.stdout.write(`\r  Downloading: ${mb} MB / ${totalMb} MB`);
    });
    console.log('\n  Download complete, extracting model');

    await extractModelArchive(archivePath, modelsDir, modelDir);
    console.log('  Extraction complete');
    return modelDir;
  } catch (error) {
    console.error(`Failed to download model ${modelName}:`, error);
    try { fs.rmSync(archivePath, { force: true }); } catch {}
    return null;
  }
}

export async function initializeAsrEngine({
  dataDir,
  settings,
  processResourcesPath = process.resourcesPath,
  appPath = app.getAppPath(),
}: InitializeAsrEngineOptions): Promise<AsrEngine | null> {
  if (settings.recognition_mode === 'streaming_output') {
    const engine = await tryCreateEngine(
      getStreamingModelSearchPaths({
        dataDir,
        processResourcesPath,
        appPath,
        settings,
      }),
      settings
    );
    if (engine) return engine;

    const downloadCandidates = ['sherpa-onnx-streaming-zipformer-ctc-zh-xlarge'];
    for (const candidate of downloadCandidates) {
      const downloadedPath = await downloadModel(candidate, dataDir);
      if (downloadedPath) {
        const downloadedEngine = await tryCreateEngine([downloadedPath], settings);
        if (downloadedEngine) {
          return downloadedEngine;
        }
      }
    }
    return null;
  }

  if (settings.model_path) {
    const configuredModel = await tryCreateEngine([settings.model_path], settings);
    if (configuredModel) {
      return configuredModel;
    }
  }

  const searchPaths = getModelSearchPaths({
    dataDir,
    processResourcesPath,
    appPath,
  });

  const engine = await tryCreateEngine(searchPaths, settings);
  if (engine) return engine;

  const downloadedPath = await downloadModel(settings.pinned_model_version || 'sherpa-onnx-sense-voice', dataDir);
  if (downloadedPath) {
    return tryCreateEngine([downloadedPath], settings);
  }

  return null;
}

async function tryCreateEngine(searchPaths: string[], settings: Settings): Promise<AsrEngine | null> {
  const modelInfo = AsrEngine.findModelPath(searchPaths, settings.recognition_mode);
  if (!modelInfo) {
    return null;
  }

  const engine = new AsrEngine(modelInfo, {
    computeBackend: settings.compute_backend,
    recognitionMode: settings.recognition_mode,
  });
  try {
    await engine.initialize();
    return engine;
  } catch (error) {
    console.error('Failed to initialize ASR engine:', error);
    return null;
  }
}

function getStreamingModelSearchPaths({
  dataDir,
  processResourcesPath,
  appPath,
  settings,
}: {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
  settings: Settings;
}): string[] {
  const modelDirs = [STREAMING_XLARGE_MODEL_DIR];

  return [
    ...modelDirs.flatMap((modelDir) => [
      pathJoin(dataDir, 'models', modelDir),
      pathJoin(processResourcesPath, 'models', modelDir),
      pathJoin(appPath, 'resources', 'models', modelDir),
    ]),
    ...getModelSearchPaths({ dataDir, processResourcesPath, appPath }),
  ];
}

function pathJoin(...parts: string[]): string {
  return require('path').join(...parts);
}
