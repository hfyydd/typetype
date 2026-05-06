import { app } from 'electron';

import { AsrEngine } from './asr-engine';
import { Settings } from './types';
import { getModelSearchPaths } from './model-search-paths';

export interface InitializeAsrEngineOptions {
  dataDir: string;
  settings: Settings;
  processResourcesPath?: string;
  appPath?: string;
}

export async function initializeAsrEngine({
  dataDir,
  settings,
  processResourcesPath = process.resourcesPath,
  appPath = app.getAppPath(),
}: InitializeAsrEngineOptions): Promise<AsrEngine | null> {
  if (settings.recognition_mode === 'streaming_output') {
    return tryCreateEngine(
      getStreamingModelSearchPaths({
        dataDir,
        processResourcesPath,
        appPath,
      }),
      settings
    );
  }

  // 先尊重用户手动配置的模型路径；只有找不到时才回退到应用内置搜索路径。
  if (settings.model_path) {
    const configuredModel = await tryCreateEngine([settings.model_path], settings);
    if (configuredModel) {
      return configuredModel;
    }
  }

  return tryCreateEngine(
    getModelSearchPaths({
      dataDir,
      processResourcesPath,
      appPath,
    }),
    settings
  );
}

async function tryCreateEngine(searchPaths: string[], settings: Settings): Promise<AsrEngine | null> {
  const modelInfo = AsrEngine.findModelPath(searchPaths);
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
}: {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}): string[] {
  return [
    pathJoin(dataDir, 'models', 'sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01'),
    pathJoin(processResourcesPath, 'models', 'sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01'),
    pathJoin(appPath, 'resources', 'models', 'sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01'),
    ...getModelSearchPaths({
      dataDir,
      processResourcesPath,
      appPath,
    }),
  ];
}

function pathJoin(...parts: string[]): string {
  return require('path').join(...parts);
}
