import * as path from 'path';
import * as fs from 'fs';

import { RecognitionMode, TranslationTargetLanguage } from './types';

export interface TranslationLanguageDefinition {
  label: string;
  experimental?: boolean;
  modelId: string;
  sourceLanguage: string;
  targetLanguage: string;
}

const SHARED_NLLB_MODEL_ID = 'Xenova/nllb-200-distilled-600M';

const TRANSLATION_LANGUAGES: Record<TranslationTargetLanguage, TranslationLanguageDefinition> = {
  en: {
    label: '英语',
    modelId: SHARED_NLLB_MODEL_ID,
    sourceLanguage: 'zho_Hans',
    targetLanguage: 'eng_Latn',
  },
  ja: {
    label: '日语',
    modelId: SHARED_NLLB_MODEL_ID,
    sourceLanguage: 'zho_Hans',
    targetLanguage: 'jpn_Jpan',
  },
  de: {
    label: '德语',
    modelId: SHARED_NLLB_MODEL_ID,
    sourceLanguage: 'zho_Hans',
    targetLanguage: 'deu_Latn',
  },
  yue: {
    label: '粤语（实验性）',
    experimental: true,
    modelId: SHARED_NLLB_MODEL_ID,
    sourceLanguage: 'zho_Hans',
    targetLanguage: 'yue_Hant',
  },
};

export function getTranslationLanguageDefinition(
  language: TranslationTargetLanguage
): TranslationLanguageDefinition {
  return TRANSLATION_LANGUAGES[language];
}

export function getSupportedTranslationLanguages(): TranslationTargetLanguage[] {
  return Object.keys(TRANSLATION_LANGUAGES) as TranslationTargetLanguage[];
}

export function translationSupportsRecognitionMode(mode: RecognitionMode): boolean {
  return mode === 'non_streaming';
}

export function getTranslationCacheDir(dataDir: string): string {
  return path.join(dataDir, 'translation-models');
}

export function resolveBundledTranslationModelPath(
  modelId: string,
  processResourcesPath: string,
  appPath: string
): string | null {
  const relativeModelPath = modelId.split('/').join(path.sep);
  const candidates = [
    path.join(processResourcesPath, 'translation-models', relativeModelPath),
    path.join(appPath, 'resources', 'translation-models', relativeModelPath),
    path.join(appPath, 'translation-models', relativeModelPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
