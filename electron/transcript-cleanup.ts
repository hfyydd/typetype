import { Settings } from './types';

export function cleanupTranscript(text: string, settings: Pick<Settings, 'custom_dictionary'>): string {
  let result = text;

  for (const entry of settings.custom_dictionary || []) {
    if (entry.from && entry.to) {
      result = result.split(entry.from).join(entry.to);
    }
  }

  result = result.replace(/ ,/g, ',');
  result = result.replace(/ \./g, '.');
  result = result.replace(/ !/g, '!');
  result = result.replace(/ \?/g, '?');
  result = result.replace(/ 、/g, '，');
  result = result.replace(/ 。/g, '。');
  result = result.replace(/  +/g, ' ');

  return result.trim();
}

export function mergeTranscriptText(existing: string, nextChunk: string): string {
  if (!nextChunk) {
    return existing;
  }

  if (!existing) {
    return nextChunk;
  }

  const last = existing.at(-1) ?? '';
  const first = nextChunk.at(0) ?? '';
  const needsSpace =
    /[A-Za-z0-9)]/.test(last) &&
    /[A-Za-z0-9(]/.test(first) &&
    !/\s/.test(last) &&
    !/\s/.test(first);

  return needsSpace ? `${existing} ${nextChunk}` : `${existing}${nextChunk}`;
}
