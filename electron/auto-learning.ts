import { DictionaryEntry } from './types';
import { normalizeDictionaryText } from './dictionary-engine';

export interface AutoLearnedTerm {
  term: string;
  reason: string;
}

const COMMON_SURNAME = '[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹]';
const PRIVACY_PATTERNS = [
  /https?:\/\/\S+/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /sk-[A-Za-z0-9_-]{16,}/,
  /\b(?:api[_-]?key|secret|token)[=:：]?[A-Za-z0-9_-]{12,}\b/i,
  /\.(?:com|cn|net|org|io|ai)\b/i,
  /\b1[3-9]\d{9}\b/,
  /\b\d{17}[\dXx]\b/,
  /\b\d{6,}\b/,
];

const STOP_WORDS = new Set([
  '今天',
  '明天',
  '昨天',
  '然后',
  '这个',
  '那个',
  '我们',
  '你们',
  '他们',
  '客户',
  '会议',
  '功能',
  '测试',
]);

export function extractAutoLearnedTerms(text: string, existingEntries: DictionaryEntry[] = []): AutoLearnedTerm[] {
  const normalizedText = String(text || '');
  if (!normalizedText.trim()) {
    return [];
  }

  const existing = new Set(
    existingEntries
      .flatMap((entry) => [entry.term, entry.replacement, ...(entry.aliases ?? [])])
      .map((value) => normalizeDictionaryText(value).toLocaleLowerCase())
      .filter(Boolean)
  );

  const candidates = new Map<string, AutoLearnedTerm>();
  const collect = (term: string, reason: string) => {
    const normalized = normalizeDictionaryText(term);
    if (!isLearnableTerm(normalized) || existing.has(normalized.toLocaleLowerCase())) {
      return;
    }
    candidates.set(normalized.toLocaleLowerCase(), { term: normalized, reason });
  };

  for (const match of normalizedText.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)+\b/g)) {
    collect(match[0], '英文产品名/模型名');
  }

  for (const match of normalizedText.matchAll(/\b[A-Z][A-Za-z0-9]{1,}(?:[A-Z][A-Za-z0-9]+)+\b/g)) {
    collect(match[0], '英文品牌词');
  }

  for (const match of normalizedText.matchAll(/[\u4e00-\u9fff]{2,12}(?:客户|项目|模型|系统|平台|软件|公司|医院|学校|会议|方案|产品|服务|团队|门店|课程)/g)) {
    const term = match[0].replace(/^(还|也|并|和|及|与|提到|联系|负责|对接|关于|今天|明天|昨天|通知|安排)+/u, '');
    collect(term, '中文业务术语');
  }

  const nameCounts = new Map<string, number>();
  const nameRegex = new RegExp(`${COMMON_SURNAME}[\\u4e00-\\u9fff]{1,2}`, 'g');
  for (const match of normalizedText.matchAll(nameRegex)) {
    const name = match[0];
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count >= 2 || /(?:客户|老师|经理|主任|医生|同事|负责人)/.test(normalizedText)) {
      collect(name, '中文人名');
    }
  }

  return Array.from(candidates.values()).slice(0, 20);
}

export function isLearnableTerm(term: string): boolean {
  if (!term || term.length < 2 || term.length > 40) {
    return false;
  }
  if (STOP_WORDS.has(term)) {
    return false;
  }
  if (/[\n。！？；]/.test(term)) {
    return false;
  }
  if (PRIVACY_PATTERNS.some((pattern) => pattern.test(term))) {
    return false;
  }
  if (/^\d+$/.test(term)) {
    return false;
  }
  return true;
}
