// Downloads the paraformer trilingual streaming ASR model into resources/models/
// so it is bundled into the macOS (and future) packages.
//
// Why: the streaming ASR recognition mode (multilingual_realtime) resolves to
// STREAMING_MIXED_MODEL_DIR = 'sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en'
// (asr-bootstrap.ts). If that directory is missing, the bootstrap falls back to the
// bundled zipformer-small-ctc model, whose tokens/config do not match the streaming
// config, so every decoded chunk returns empty text (the "录音无文字" bug on Intel).
//
// This script is a build-time provisioning step — run once before packaging:
//   node scripts/download-streaming-paraformer-model.js
// The model dir is gitignored (resources/models/), so this reproduces the local asset.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MODEL_DIR_NAME = 'sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en';
const ARCHIVE_NAME = `${MODEL_DIR_NAME}.tar.bz2`;
const DOWNLOAD_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ARCHIVE_NAME}`;

const MODELS_ROOT = path.resolve(__dirname, '..', 'resources', 'models');
const MODEL_DIR = path.join(MODELS_ROOT, MODEL_DIR_NAME);

// Files required at runtime by asr-engine paraformer branch (getModelFilesFromDirectory).
const REQUIRED_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt', 'am.mvn'];
// Files we deliberately drop to slim the bundle (fp32 weights + dev-only scripts).
const DROP_FILES = ['encoder.onnx', 'decoder.onnx', 'add-model-metadata.py', 'generate-tokens.py'];

function isModelPresent() {
  return REQUIRED_FILES.every((f) => fs.existsSync(path.join(MODEL_DIR, f)));
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function main() {
  if (isModelPresent()) {
    console.log(`[paraformer-model] already present at ${MODEL_DIR}, nothing to do.`);
    return;
  }

  fs.mkdirSync(MODELS_ROOT, { recursive: true });
  const archivePath = path.join(MODELS_ROOT, ARCHIVE_NAME);

  console.log(`[paraformer-model] downloading from ${DOWNLOAD_URL} ...`);
  run('curl', ['-L', '--fail', '--show-error', DOWNLOAD_URL, '-o', archivePath]);

  console.log('[paraformer-model] verifying archive integrity ...');
  run('bzip2', ['-t', archivePath]);

  console.log('[paraformer-model] extracting (excluding test_wavs) ...');
  run('tar', [
    'xjf', archivePath,
    '-C', MODELS_ROOT,
    '--exclude=*/test_wavs',
    '--exclude=*/test_wavs/*',
  ]);

  // Slim: drop fp32 weights (engine uses int8) and dev-only scripts.
  for (const f of DROP_FILES) {
    const p = path.join(MODEL_DIR, f);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  fs.rmSync(archivePath, { force: true });

  if (!isModelPresent()) {
    throw new Error(`[paraformer-model] extraction finished but required files missing in ${MODEL_DIR}`);
  }

  console.log(`[paraformer-model] done. Model ready at ${MODEL_DIR}`);
}

try {
  main();
} catch (error) {
  console.error(`[paraformer-model] failed: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
}
