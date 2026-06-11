import { app } from 'electron';

import * as fs from 'fs';
import * as path from 'path';

import { AsrEngine } from './asr-engine';
import { AsrEngineProxy } from './asr-engine-proxy';
import { Settings } from './types';
import { getModelSearchPaths } from './model-search-paths';

export interface InitializeAsrEngineOptions {
  dataDir: string;
  settings: Settings;
  processResourcesPath?: string;
  appPath?: string;
}

const SENSE_VOICE_MODEL_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09';
const STREAMING_MIXED_MODEL_DIR = 'sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en';
const STREAMING_XLARGE_MODEL_DIR = 'sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8-2025-06-30';
const PRO_HIGH_ACCURACY_MODEL_DIR = 'typetype-professional-high-accuracy-voice-package';

// All ASR / translation / punctuation models are shipped inside the
// application bundle under Contents/Resources/models (and the two
// companion directories). When `tryCreateEngine` cannot locate the
// requested model in any of the packaged search paths, the bootstrap
// now fails fast with a clear error log instead of silently downloading
// an archive from the internet. This keeps the user experience offline
// and predictable — a missing model is a packaging defect, not a
// recoverable runtime condition.
function logMissingPackagedModel(modelName: string, searchPaths: string[]): null {
  console.error(
    `[asr-bootstrap] Packaged model "${modelName}" was not found in any of the bundled search paths. ` +
    `This is a packaging defect, not a network condition. Searched:\n  - ${searchPaths.join('\n  - ')}`
  );
  return null;
}

export async function initializeAsrEngine({
  dataDir,
  settings,
  processResourcesPath = process.resourcesPath,
  appPath = app.getAppPath(),
}: InitializeAsrEngineOptions): Promise<AsrEngineProxy | null> {
  if (settings.recognition_mode === 'streaming_output') {
    if (settings.streaming_model === 'multilingual_segmented') {
      const segmentedStreamingSettings: Settings = {
        ...settings,
        recognition_mode: 'non_streaming',
        pinned_model_version: 'sherpa-onnx-sense-voice',
      };

      const configuredEngine = settings.model_path
        ? await tryCreateEngine([settings.model_path], segmentedStreamingSettings)
        : null;
      if (configuredEngine) return configuredEngine;

      const segmentedSearchPaths = getMixedSegmentedStreamingModelSearchPaths({
        dataDir,
        processResourcesPath,
        appPath,
      });
      const engine = await tryCreateEngine(segmentedSearchPaths, segmentedStreamingSettings);
      if (engine) return engine;

      console.warn(
        '[asr-bootstrap] Mixed segmented streaming model is unavailable; falling back to Chinese online streaming. ' +
        `Looked in: ${segmentedSearchPaths.join(', ')}`
      );
    }

    const streamingSearchPaths = getStreamingModelSearchPaths({
      dataDir,
      processResourcesPath,
      appPath,
      settings,
    });
    const engine = await tryCreateEngine(streamingSearchPaths, settings);
    if (engine) return engine;

    return logMissingPackagedModel(
      settings.streaming_model === 'zh_high_accuracy_realtime'
        ? STREAMING_XLARGE_MODEL_DIR
        : STREAMING_MIXED_MODEL_DIR,
      streamingSearchPaths
    );
  }

  if (settings.model_path) {
    const configuredModel = await tryCreateEngine([settings.model_path], settings);
    if (configuredModel) {
      return configuredModel;
    }
  }

  if (settings.voice_package === 'pro_high_accuracy') {
    const professionalSettings: Settings = {
      ...settings,
      compute_backend: 'gpu',
    };
    const professionalSearchPaths = getProfessionalModelSearchPaths({
      dataDir,
      processResourcesPath,
      appPath,
    });
    const professionalEngine = await tryCreateEngine(professionalSearchPaths, professionalSettings);
    if (professionalEngine) {
      return professionalEngine;
    }

    console.warn(
      '[asr-bootstrap] Professional voice package is unavailable; falling back to the fast offline package. ' +
      `Looked in: ${professionalSearchPaths.join(', ')}`
    );
  }

  const searchPaths = getModelSearchPaths({
    dataDir,
    processResourcesPath,
    appPath,
  });

  const engine = await tryCreateEngine(searchPaths, settings);
  if (engine) return engine;

  return logMissingPackagedModel(
    settings.pinned_model_version || SENSE_VOICE_MODEL_DIR,
    searchPaths
  );
}

function getProfessionalModelSearchPaths({
  dataDir,
  processResourcesPath,
  appPath,
}: {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}): string[] {
  const modelDirs = [
    PRO_HIGH_ACCURACY_MODEL_DIR,
    'pro-high-accuracy',
    'professional-high-accuracy',
  ];

  return modelDirs.flatMap((modelDir) => [
    pathJoin(dataDir, 'models', modelDir),
    pathJoin(processResourcesPath, 'models', modelDir),
    pathJoin(appPath, 'resources', 'models', modelDir),
  ]);
}

async function tryCreateEngine(searchPaths: string[], settings: Settings): Promise<AsrEngineProxy | null> {
  const modelInfo = AsrEngine.findModelPath(searchPaths, settings.recognition_mode);
  if (!modelInfo) {
    return null;
  }

  // The proxy spawns a child process that runs the sherpa-onnx recognizer
  // constructor. By keeping the heavy C++ initialization off the main
  // process event loop, the settings panel stays responsive when the
  // user switches recognition mode / streaming model / voice package.
  const proxy = new AsrEngineProxy({
    modelFiles: modelInfo,
    recognitionMode: settings.recognition_mode,
    computeBackend: settings.compute_backend,
  });
  try {
    await proxy.initialize();
    return proxy;
  } catch (error) {
    console.error('Failed to initialize ASR engine:', error);
    await proxy.destroy().catch(() => undefined);
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
  const preferredModelDirs = settings.streaming_model === 'zh_high_accuracy_realtime'
    ? [STREAMING_XLARGE_MODEL_DIR, STREAMING_MIXED_MODEL_DIR]
    : [STREAMING_MIXED_MODEL_DIR, STREAMING_XLARGE_MODEL_DIR];
  const modelDirs = Array.from(new Set(preferredModelDirs));

  return [
    ...modelDirs.flatMap((modelDir) => [
      pathJoin(dataDir, 'models', modelDir),
      pathJoin(processResourcesPath, 'models', modelDir),
      pathJoin(appPath, 'resources', 'models', modelDir),
    ]),
    ...getModelSearchPaths({ dataDir, processResourcesPath, appPath }),
  ];
}

function getMixedSegmentedStreamingModelSearchPaths({
  dataDir,
  processResourcesPath,
  appPath,
}: {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}): string[] {
  return [
    pathJoin(dataDir, 'models', SENSE_VOICE_MODEL_DIR),
    pathJoin(processResourcesPath, 'models', SENSE_VOICE_MODEL_DIR),
    pathJoin(appPath, 'resources', 'models', SENSE_VOICE_MODEL_DIR),
    ...getModelSearchPaths({ dataDir, processResourcesPath, appPath }),
  ];
}

function pathJoin(...parts: string[]): string {
  return require('path').join(...parts);
}
