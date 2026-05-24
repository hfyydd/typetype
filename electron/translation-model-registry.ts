import * as path from 'path';
import * as fs from 'fs';

import { RecognitionMode, TranslationTargetLanguage } from './types';

export interface TranslationLanguageDefinition {
  label: string;
  experimental?: boolean;
  modelId: string;
  sourceLanguage: string;
  targetLanguage: string;
  hyTargetLanguage: string;
}

export const SHARED_NLLB_MODEL_ID = 'Xenova/nllb-200-distilled-600M';
export const HY_MT2_MODEL_ID = 'tencent/Hy-MT2-1.8B-GGUF';
export const HY_MT2_MODEL_FILE = 'Hy-MT2-1.8B-Q4_K_M.gguf';

const NLLB_SOURCE_LANGUAGE = 'zho_Hans';

function language(
  label: string,
  hyTargetLanguage: string,
  targetLanguage: string,
  options: { experimental?: boolean } = {}
): TranslationLanguageDefinition {
  return {
    label,
    modelId: SHARED_NLLB_MODEL_ID,
    sourceLanguage: NLLB_SOURCE_LANGUAGE,
    targetLanguage,
    hyTargetLanguage,
    experimental: options.experimental,
  };
}

const TRANSLATION_LANGUAGES: Record<TranslationTargetLanguage, TranslationLanguageDefinition> = {
  zh: language('中文（简体）', '中文', 'zho_Hans'),
  en: language('英语', '英语', 'eng_Latn'),
  fr: language('法语', '法语', 'fra_Latn'),
  pt: language('葡萄牙语', '葡萄牙语', 'por_Latn'),
  es: language('西班牙语', '西班牙语', 'spa_Latn'),
  ja: language('日语', '日语', 'jpn_Jpan'),
  tr: language('土耳其语', '土耳其语', 'tur_Latn'),
  ru: language('俄语', '俄语', 'rus_Cyrl'),
  ar: language('阿拉伯语', '阿拉伯语', 'arb_Arab'),
  ko: language('韩语', '韩语', 'kor_Hang'),
  th: language('泰语', '泰语', 'tha_Thai'),
  it: language('意大利语', '意大利语', 'ita_Latn'),
  de: language('德语', '德语', 'deu_Latn'),
  vi: language('越南语', '越南语', 'vie_Latn'),
  ms: language('马来语', '马来语', 'zsm_Latn'),
  id: language('印尼语', '印尼语', 'ind_Latn'),
  tl: language('菲律宾语', '菲律宾语', 'tgl_Latn'),
  hi: language('印地语', '印地语', 'hin_Deva'),
  'zh-Hant': language('繁体中文', '繁体中文', 'zho_Hant'),
  pl: language('波兰语', '波兰语', 'pol_Latn'),
  cs: language('捷克语', '捷克语', 'ces_Latn'),
  nl: language('荷兰语', '荷兰语', 'nld_Latn'),
  km: language('高棉语', '高棉语', 'khm_Khmr'),
  my: language('缅甸语', '缅甸语', 'mya_Mymr'),
  fa: language('波斯语', '波斯语', 'pes_Arab'),
  gu: language('古吉拉特语', '古吉拉特语', 'guj_Gujr'),
  ur: language('乌尔都语', '乌尔都语', 'urd_Arab'),
  te: language('泰卢固语', '泰卢固语', 'tel_Telu'),
  mr: language('马拉地语', '马拉地语', 'mar_Deva'),
  he: language('希伯来语', '希伯来语', 'heb_Hebr'),
  bn: language('孟加拉语', '孟加拉语', 'ben_Beng'),
  ta: language('泰米尔语', '泰米尔语', 'tam_Taml'),
  uk: language('乌克兰语', '乌克兰语', 'ukr_Cyrl'),
  bo: language('藏语', '藏语', 'bod_Tibt'),
  kk: language('哈萨克语', '哈萨克语', 'kaz_Cyrl'),
  mn: language('蒙古语', '蒙古语', 'khk_Cyrl'),
  ug: language('维吾尔语', '维吾尔语', 'uig_Arab'),
  yue: language('粤语', '粤语', 'yue_Hant', { experimental: true }),
};

export function getTranslationLanguageDefinition(
  language: TranslationTargetLanguage
): TranslationLanguageDefinition {
  return TRANSLATION_LANGUAGES[language] ?? TRANSLATION_LANGUAGES.en;
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

  return firstExistingPath(candidates);
}

export function resolveBundledHyMt2ModelPath(
  processResourcesPath: string,
  appPath: string
): string | null {
  const relativeModelPath = path.join(...HY_MT2_MODEL_ID.split('/'), HY_MT2_MODEL_FILE);
  const candidates = [
    path.join(processResourcesPath, 'translation-models', relativeModelPath),
    path.join(appPath, 'resources', 'translation-models', relativeModelPath),
    path.join(appPath, 'translation-models', relativeModelPath),
  ];

  return firstExistingPath(candidates);
}

export function resolveBundledLlamaCliPath(
  processResourcesPath: string,
  appPath: string
): string | null {
  const executableNames = process.platform === 'win32'
    ? ['llama-cli.exe', 'main.exe']
    : ['llama-cli', 'main'];
  const baseDirs = [
    path.join(processResourcesPath, 'runtimes', 'llama.cpp'),
    path.join(appPath, 'resources', 'runtimes', 'llama.cpp'),
    path.join(appPath, 'runtimes', 'llama.cpp'),
  ];
  const candidates = baseDirs.flatMap((dir) => executableNames.map((name) => path.join(dir, name)));

  return firstExistingPath(candidates);
}

function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
