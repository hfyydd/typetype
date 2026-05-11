const SENTENCE_ENDING_RE = /[。！？!?]$/u;
const ANY_ENDING_PUNCTUATION_RE = /[。！？!?，,、；;：:]$/u;
const LEADING_PUNCTUATION_RE = /^[。！？!?，,、；;：:]/u;

const QUESTION_ENDING_RE =
  /(吗|嘛|么|呢|什么|为什么|怎么|怎样|咋|如何|哪里|哪儿|哪个|哪些|几|多少|谁|啥|是否|是不是|能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会)$/u;
const QUESTION_PREFIX_RE = /^(请问|问一下|我想问|想问一下|麻烦问一下)/u;

export function prefixStreamingBoundaryPunctuation(previousText: string, nextText: string): string {
  const previous = previousText.trim();
  const next = nextText.trimStart();

  if (!previous || !next) {
    return nextText;
  }

  if (ANY_ENDING_PUNCTUATION_RE.test(previous) || LEADING_PUNCTUATION_RE.test(next)) {
    return nextText;
  }

  return `，${nextText}`;
}

export function ensureStreamingFinalPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (SENTENCE_ENDING_RE.test(trimmed)) {
    return trimmed;
  }

  const withoutTrailingClausePunctuation = trimmed.replace(/[，,、；;：:]+$/u, '');
  const punctuation = chooseFinalPunctuation(withoutTrailingClausePunctuation);
  return `${withoutTrailingClausePunctuation}${punctuation}`;
}

function chooseFinalPunctuation(text: string): string {
  if (QUESTION_ENDING_RE.test(text) || QUESTION_PREFIX_RE.test(text)) {
    return '？';
  }

  return '。';
}
