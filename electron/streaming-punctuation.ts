import { ensureFinalPunctuation } from './transcript-punctuation';

const ANY_ENDING_PUNCTUATION_RE = /[。！？!?，,、；;：:]$/u;
const LEADING_PUNCTUATION_RE = /^[。！？!?，,、；;：:]/u;

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
  return ensureFinalPunctuation(text);
}
