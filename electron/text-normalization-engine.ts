export type TextNormalizationMode = 'streaming_partial' | 'streaming_final' | 'non_streaming';
export type TextNormalizationStrength = 'conservative';

export interface TextNormalizationOptions {
  mode?: TextNormalizationMode;
  strength?: TextNormalizationStrength;
  preserveTerms?: string[];
}

interface ProtectedToken {
  token: string;
  value: string;
}

const CN_DIGIT_VALUES = new Map<string, number>([
  ['零', 0],
  ['〇', 0],
  ['○', 0],
  ['O', 0],
  ['Ｏ', 0],
  ['一', 1],
  ['幺', 1],
  ['二', 2],
  ['两', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
]);

const CN_NUMBER_RE = '[零〇○OＯ一二两三四五六七八九十百千万亿幺]';
const CN_DIGIT_RE = '[零〇○OＯ一二两三四五六七八九幺]';
const WEEKDAY_RE = /(?:周|星期|礼拜)[一二三四五六日天]/g;
const IDIOMS_TO_PRESERVE = [
  '一心一意',
  '三三两两',
  '三心二意',
  '不三不四',
  '五花八门',
  '七上八下',
  '乱七八糟',
  '一五一十',
  '十全十美',
  '一干二净',
  '一清二楚',
  '一模一样',
  '一来二去',
];

export class TextNormalizationEngine {
  normalize(text: string, options: TextNormalizationOptions = {}): string {
    if (!text.trim()) {
      return text;
    }

    const mode = options.mode ?? 'non_streaming';
    let { text: working, tokens } = protectValues(text, [
      ...IDIOMS_TO_PRESERVE,
      ...Array.from(text.matchAll(WEEKDAY_RE), (match) => match[0]),
      ...collectAutoPreserveTerms(text),
      ...(options.preserveTerms ?? []).filter(shouldPreserveExternalTerm),
    ]);

    working = normalizeVersionNumbers(working);
    working = normalizePhoneNumbers(working, mode);
    working = normalizeIdentifierNumbers(working, mode);
    working = normalizeDates(working);
    working = normalizePercentages(working);
    working = normalizeMoney(working);
    working = normalizeTimes(working);

    return restoreValues(working, tokens);
  }
}

function collectAutoPreserveTerms(text: string): string[] {
  const matches = text.match(/\b[A-Za-z][A-Za-z0-9.+#-]*(?:\s+[A-Za-z0-9.+#-]+){0,3}\b/g) ?? [];
  return matches.filter((term) => /[A-Za-z]/.test(term) && /\d|[-.+#]/.test(term));
}

function shouldPreserveExternalTerm(term: string): boolean {
  const normalized = term.trim();
  if (!normalized) {
    return false;
  }
  if (/[A-Za-z0-9]/.test(normalized)) {
    return true;
  }
  return !new RegExp(CN_NUMBER_RE, 'u').test(normalized);
}

function protectValues(text: string, values: string[]): { text: string; tokens: ProtectedToken[] } {
  let result = text;
  const tokens: ProtectedToken[] = [];
  const uniqueValues = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  for (const value of uniqueValues) {
    if (!result.includes(value)) {
      continue;
    }
    const token = `\uE000TN${tokens.length}\uE001`;
    result = result.replace(new RegExp(escapeRegExp(value), 'gu'), token);
    tokens.push({ token, value });
  }

  return { text: result, tokens };
}

function restoreValues(text: string, tokens: ProtectedToken[]): string {
  let result = text;
  for (const { token, value } of tokens) {
    result = result.replace(new RegExp(escapeRegExp(token), 'gu'), value);
  }
  return result;
}

function normalizePhoneNumbers(text: string, mode: TextNormalizationMode): string {
  const context = '(手机号|手机号码|电话号码|联系电话|客服电话|客服热线|服务热线|热线电话|座机号码|座机|电话|分机号|分机)';
  const connector = '([是为叫:]|：)?';
  const digitSeq = `(${CN_DIGIT_RE}{2,}(?:[\\s-]*${CN_DIGIT_RE})*)`;
  const pattern = new RegExp(`${context}${connector}${digitSeq}`, 'gu');

  return text.replace(pattern, (match, label: string, joiner: string | undefined, sequence: string) => {
    const digits = chineseDigitsToArabic(sequence);
    const isExtension = label.includes('分机');
    if (!digits || (mode === 'streaming_partial' && !isExtension && digits.length < 7)) {
      return match;
    }
    if (!isExtension && digits.length < 5) {
      return match;
    }
    return `${label}${joiner ?? ''}${digits}`;
  });
}

function normalizeIdentifierNumbers(text: string, mode: TextNormalizationMode): string {
  const context = '(订单号|订单编号|编号|单号|工号|验证码|取件码|房间号|门牌号|卡号|账号|帐号|单据号)';
  const connector = '([是为叫:]|：)?';
  const digitSeq = `(${CN_DIGIT_RE}{2,}(?:[\\s-]*${CN_DIGIT_RE})*)`;
  const pattern = new RegExp(`${context}${connector}${digitSeq}`, 'gu');

  return text.replace(pattern, (match, label: string, joiner: string | undefined, sequence: string) => {
    const digits = chineseDigitsToArabic(sequence);
    if (!digits || (mode === 'streaming_partial' && digits.length < 4)) {
      return match;
    }
    return `${label}${joiner ?? ''}${digits}`;
  });
}

function normalizeDates(text: string): string {
  let result = text.replace(new RegExp(`(${CN_DIGIT_RE}{2,4})年`, 'gu'), (match, year: string) => {
    const value = chineseDigitsToArabic(year);
    if (!value) {
      return match;
    }
    const normalizedYear = value.length === 3 && value.startsWith('0')
      ? `2${value}`
      : value;
    return `${normalizedYear}年`;
  });

  result = result.replace(new RegExp(`(${CN_NUMBER_RE}{1,3})月`, 'gu'), (match, month: string) => {
    const value = parseChineseInteger(month);
    return value && value >= 1 && value <= 12 ? `${value}月` : match;
  });

  result = result.replace(new RegExp(`(${CN_NUMBER_RE}{1,3})(日|号)`, 'gu'), (match, day: string, suffix: string) => {
    const value = parseChineseInteger(day);
    return value && value >= 1 && value <= 31 ? `${value}${suffix}` : match;
  });

  return result;
}

function normalizeTimes(text: string): string {
  const daypart = '(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|今晚|明早|明天上午|明天下午|明天晚上)?';
  const timePattern = new RegExp(`${daypart}(${CN_NUMBER_RE}{1,3})点(半|${CN_NUMBER_RE}{1,3}分|${CN_NUMBER_RE}{1,3})?`, 'gu');
  let result = text.replace(timePattern, (match, prefix: string | undefined, hourText: string, suffix: string | undefined) => {
    const hour = parseChineseInteger(hourText);
    if (hour === null || hour < 0 || hour > 24) {
      return match;
    }
    if (!prefix && /^(一点|两点|二点)$/.test(`${hourText}点`) && !suffix) {
      return match;
    }
    if (!suffix || suffix === '半') {
      return `${prefix ?? ''}${hour}点${suffix ?? ''}`;
    }
    if (suffix.endsWith('分')) {
      const minute = parseChineseInteger(suffix.slice(0, -1));
      return minute !== null && minute >= 0 && minute <= 59
        ? `${prefix ?? ''}${hour}点${minute}分`
        : match;
    }
    const minute = parseChineseInteger(suffix);
    return minute !== null && minute >= 0 && minute <= 59
      ? `${prefix ?? ''}${hour}点${minute}`
      : match;
  });

  result = result.replace(new RegExp(`(${CN_NUMBER_RE}{1,3})分(钟)?`, 'gu'), (match, minuteText: string, suffix: string | undefined) => {
    const minute = parseChineseInteger(minuteText);
    return minute !== null && minute >= 0 && minute <= 59 ? `${minute}分${suffix ?? ''}` : match;
  });

  return result;
}

function normalizePercentages(text: string): string {
  return text.replace(new RegExp(`百分之(${CN_NUMBER_RE}{1,8})`, 'gu'), (match, valueText: string) => {
    const value = parseChineseInteger(valueText);
    return value !== null ? `${value}%` : match;
  });
}

function normalizeMoney(text: string): string {
  return text.replace(new RegExp(`(${CN_NUMBER_RE}{2,10})(元|块钱|块|人民币|美元|万元|千元)`, 'gu'), (match, amountText: string, unit: string) => {
    const value = parseChineseInteger(amountText);
    return value !== null && value > 0 ? `${value}${unit}` : match;
  });
}

function normalizeVersionNumbers(text: string): string {
  const versionPattern = new RegExp(`(版本号?|version|v|V)([是为:]|：)?\\s*(${CN_NUMBER_RE}+(?:点${CN_NUMBER_RE}+){1,4})`, 'gu');
  return text.replace(versionPattern, (match, label: string, joiner: string | undefined, sequence: string) => {
    const parts = sequence.split('点').map((part) => parseChineseInteger(part));
    if (parts.some((part) => part === null)) {
      return match;
    }
    return `${label}${joiner ?? ''}${parts.join('.')}`;
  });
}

function chineseDigitsToArabic(value: string): string | null {
  const digits: string[] = [];
  for (const char of value.replace(/[\s-]/g, '')) {
    const digit = CN_DIGIT_VALUES.get(char);
    if (digit === undefined) {
      return null;
    }
    digits.push(String(digit));
  }
  return digits.join('');
}

function parseChineseInteger(value: string): number | null {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return null;
  }

  if ([...compact].every((char) => CN_DIGIT_VALUES.has(char))) {
    const digits = [...compact].map((char) => CN_DIGIT_VALUES.get(char));
    if (digits.some((digit) => digit === undefined)) {
      return null;
    }
    return Number(digits.join(''));
  }

  const unitValues = new Map<string, number>([
    ['十', 10],
    ['百', 100],
    ['千', 1000],
    ['万', 10000],
    ['亿', 100000000],
  ]);

  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of compact) {
    const digit = CN_DIGIT_VALUES.get(char);
    if (digit !== undefined) {
      number = digit;
      continue;
    }

    const unit = unitValues.get(char);
    if (!unit) {
      return null;
    }

    if (unit >= 10000) {
      section += number;
      total += (section || 1) * unit;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * unit;
      number = 0;
    }
  }

  return total + section + number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
