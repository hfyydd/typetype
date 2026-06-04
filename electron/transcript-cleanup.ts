import { Settings } from './types';

const UNKNOWN_TOKEN_PATTERN = /(?:<\s*unk\s*>|＜\s*unk\s*＞)/giu;

export function stripUnknownTokens(text: string): string {
  return (text || '')
    .replace(UNKNOWN_TOKEN_PATTERN, '')
    .replace(/\s+([，。！？；：、,.!?;:])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .replace(/(\p{Script=Han})\s+(\p{Script=Han})/gu, '$1$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function cleanupTranscript(text: string, settings: Pick<Settings, 'custom_dictionary'>): string {
  let result = stripUnknownTokens(text);

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

  return stripUnknownTokens(result);
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
