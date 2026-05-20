const SENTENCE_ENDING_RE = /[。！？!?]$/u;
const ANY_PUNCTUATION_RE = /[。！？!?，,、；;：:]/u;
const TRAILING_CLAUSE_PUNCTUATION_RE = /[，,、；;：:]+$/u;
const CJK_RE = /[\u3400-\u9fff]/u;
const QUESTION_ENDING_RE =
  /(吗|嘛|么|呢|什么|为什么|怎么|怎样|咋|如何|哪里|哪儿|哪个|哪些|几|多少|谁|啥|是否|是不是|能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会)$/u;
const QUESTION_PREFIX_RE = /^(请问|问一下|我想问|想问一下|麻烦问一下)/u;

const BOUNDARY_WORDS = [
  '然后',
  '另外',
  '但是',
  '不过',
  '所以',
  '同时',
  '接下来',
  '最后',
  '还有',
  '而且',
  '并且',
  '以及',
];

export function applyBasicTranscriptPunctuation(text: string): string {
  let result = normalizePunctuationSpacing(text);
  if (!result) {
    return '';
  }

  if (CJK_RE.test(result)) {
    result = insertConservativeCommas(result);
  }

  return ensureFinalPunctuation(result);
}

export function ensureFinalPunctuation(text: string): string {
  const trimmed = normalizePunctuationSpacing(text);
  if (!trimmed) {
    return '';
  }

  if (SENTENCE_ENDING_RE.test(trimmed)) {
    return trimmed;
  }

  const withoutTrailingClausePunctuation = trimmed.replace(TRAILING_CLAUSE_PUNCTUATION_RE, '');
  const punctuation = chooseFinalPunctuation(withoutTrailingClausePunctuation);
  return `${withoutTrailingClausePunctuation}${punctuation}`;
}

function normalizePunctuationSpacing(text: string): string {
  return text
    .replace(/\s+([，,。！？!?、；;：:])/gu, '$1')
    .replace(/([，,。！？!?、；;：:])\s+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function insertConservativeCommas(text: string): string {
  let result = text;

  for (const word of BOUNDARY_WORDS) {
    const pattern = new RegExp(`([^。！？!?，,、；;：:\\s])${word}`, 'gu');
    result = result.replace(pattern, `$1，${word}`);
  }

  if (!ANY_PUNCTUATION_RE.test(result)) {
    result = result.replace(/(第一|第二|第三|第四|第五)(?=[\u3400-\u9fffA-Za-z0-9])/gu, '$1，');
  }

  return result;
}

function chooseFinalPunctuation(text: string): string {
  if (QUESTION_ENDING_RE.test(text) || QUESTION_PREFIX_RE.test(text)) {
    return '？';
  }

  return CJK_RE.test(text) ? '。' : '.';
}
