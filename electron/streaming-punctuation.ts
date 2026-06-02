import { ensureFinalPunctuation } from './transcript-punctuation';

export function prefixStreamingBoundaryPunctuation(previousText: string, nextText: string): string {
  void previousText;
  return nextText;
}

export function ensureStreamingFinalPunctuation(text: string): string {
  return ensureFinalPunctuation(text);
}
