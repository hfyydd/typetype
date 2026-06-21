import * as fs from 'fs';
import * as path from 'path';

import type { ModelFiles } from './asr-engine';
import { AsrHotwordStatus, Settings } from './types';

export interface AsrHotwordContext {
  modelFiles: ModelFiles;
  settings: Settings;
  codeSwitchTerms?: string[];
  dictionaryTerms?: string[];
  systemTerms?: string[];
}

const MAX_HOTWORD_COUNT = 5000;
const HOTWORD_DIR_NAME = 'asr-hotwords';
const HOTWORD_FILE_NAME = 'hotwords.txt';
const HIGH_VALUE_RE = /[A-Za-z0-9]|狱|侦|监|押|犯|刑|法|警|检|诉|审|政法|公安|法院|检察|看守|拘留|矫正/u;

export class AsrHotwordManager {
  constructor(private readonly options: { dataDir: string }) {}

  prepareHotwords(context: AsrHotwordContext): AsrHotwordStatus {
    const support = getHotwordSupport(context.modelFiles, context.settings);
    if (!support.supported) {
      return {
        supported: false,
        enabled: false,
        path: null,
        count: 0,
        reason: support.reason,
      };
    }

    const terms = buildHotwordTerms([
      ...(context.dictionaryTerms ?? []),
      ...(context.systemTerms ?? []),
      ...(context.codeSwitchTerms ?? []),
      ...context.settings.custom_dictionary.flatMap((entry) => [entry.from, entry.to]),
    ]);

    if (terms.length === 0) {
      return {
        supported: true,
        enabled: false,
        path: null,
        count: 0,
        reason: '没有可用热词',
      };
    }

    const hotwordDir = path.join(this.options.dataDir, HOTWORD_DIR_NAME);
    const hotwordPath = path.join(hotwordDir, HOTWORD_FILE_NAME);
    fs.mkdirSync(hotwordDir, { recursive: true });
    fs.writeFileSync(hotwordPath, `${terms.join('\n')}\n`, 'utf-8');

    return {
      supported: true,
      enabled: true,
      path: hotwordPath,
      count: terms.length,
      reason: '已生成运行时热词',
    };
  }
}

export function buildHotwordTerms(values: string[], limit = MAX_HOTWORD_COUNT): string[] {
  const seen = new Set<string>();
  const scored: Array<{ value: string; score: number }> = [];

  for (const raw of values) {
    const value = normalizeHotword(raw);
    if (!value) {
      continue;
    }
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    scored.push({ value, score: scoreHotword(value) });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, 'zh-CN'))
    .slice(0, limit)
    .map((item) => item.value);
}

function getHotwordSupport(
  modelFiles: ModelFiles,
  settings: Settings
): { supported: boolean; reason: string } {
  if (settings.recognition_mode !== 'streaming_output') {
    return { supported: false, reason: '整段识别不使用底层流式热词' };
  }

  if (modelFiles.modelKind === 'paraformer' || (modelFiles.encoderPath && modelFiles.decoderPath)) {
    return { supported: false, reason: '当前流式模型不支持底层热词参数' };
  }

  if (!modelFiles.bpeVocabPath) {
    return { supported: false, reason: '当前流式模型缺少 BPE 词表，不启用底层热词' };
  }

  return { supported: true, reason: '当前高精度流式模型支持底层热词' };
}

function normalizeHotword(value: string): string | null {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length < 2 || normalized.length > 48) {
    return null;
  }
  if (/[\r\n\t]/.test(normalized)) {
    return null;
  }
  if (/^[,，。.!！?？、;；:：'"“”‘’()（）[\]{}<>《》]+$/.test(normalized)) {
    return null;
  }
  if (!HIGH_VALUE_RE.test(normalized) && normalized.length <= 3) {
    return null;
  }
  return normalized;
}

function scoreHotword(value: string): number {
  let score = 0;
  if (/[A-Za-z]/.test(value)) score += 8;
  if (/\d/.test(value)) score += 4;
  if (/狱|侦|监|押|犯|刑|法|警|检|诉|审|政法|公安|法院|检察|看守|拘留|矫正/u.test(value)) score += 9;
  if (/AI|API|RAG|LLM|GPT|Qwen|DeepSeek|Kimi|Doubao|Microsoft|Office|Adobe/i.test(value)) score += 7;
  if (value.length >= 4 && value.length <= 18) score += 2;
  if (value.length > 32) score -= 3;
  return score;
}
