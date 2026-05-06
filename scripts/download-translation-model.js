const fs = require('fs');
const path = require('path');

const { SettingsStore } = require('../dist-electron/settings-store.js');
const {
  getTranslationCacheDir,
  getTranslationLanguageDefinition,
} = require('../dist-electron/translation-model-registry.js');

async function main() {
  const { env, pipeline } = await import('@huggingface/transformers');
  const store = new SettingsStore();
  const cacheDir = getTranslationCacheDir(store.getDataDir());

  fs.mkdirSync(cacheDir, { recursive: true });
  env.cacheDir = cacheDir;
  env.remoteHost = 'https://hf-mirror.com/';

  const modelId = getTranslationLanguageDefinition('en').modelId;
  const modelDir = path.join(cacheDir, ...modelId.split('/'));
  console.log(`Downloading ${modelId} to ${cacheDir} ...`);

  const timer = setInterval(() => {
    const bytes = getDirectorySize(modelDir);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\rDownloaded: ${mb} MB`);
  }, 1000);

  try {
    await pipeline('translation', modelId, { dtype: 'q8' });
  } finally {
    clearInterval(timer);
    const bytes = getDirectorySize(modelDir);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\rDownloaded: ${mb} MB\n`);
  }

  console.log('Download complete');
}

function getDirectorySize(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

main().catch((error) => {
  console.error('Download failed:', error);
  process.exitCode = 1;
});
