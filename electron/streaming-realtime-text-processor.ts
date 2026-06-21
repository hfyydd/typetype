import { CodeSwitchApplyResult } from './code-switch-lexicon';
import { Settings } from './types';
import { cleanupTranscript, mergeTranscriptText, stripUnknownTokens } from './transcript-cleanup';
import { applyVoiceFormattingCommands } from './transcript-formatting';
import { TextNormalizationEngine } from './text-normalization-engine';
import { StreamingPauseReason } from './streaming-segmentation';

export interface StreamingRealtimeTextProcessorDependencies {
  textNormalizationEngine: TextNormalizationEngine;
  applyDictionary(text: string, options: { partial?: boolean }): string;
  applyCodeSwitch(text: string, options: { partial?: boolean }): CodeSwitchApplyResult;
}

export interface StreamingTailCorrection {
  replacementText: string;
  charsToReplace: number;
  correctedRealtimeText: string;
}

export interface StreamingRealtimeProcessResult {
  rawText: string;
  realtimeText: string;
  stableText: string;
  displayDelta: string;
  cursorText: string;
  stablePunctuationCandidate: string;
  tailCorrection: StreamingTailCorrection | null;
  metrics: {
    raw_delta_length: number;
    tail_chars_processed: number;
  };
}

export interface StreamingStableSegmentOptions {
  final?: boolean;
  stablePause?: boolean;
  pauseMs?: number;
  pauseReason?: StreamingPauseReason;
}

const DEFAULT_TAIL_WINDOW_CHARS = 120;
const MIN_TAIL_REPLACE_CHARS = 4;
const MAX_TAIL_REPLACE_CHARS = 80;
const SOFT_BOUNDARY_WORDS = [
  '然后',
  '同时',
  '而且',
  '并且',
  '还有',
  '比如',
  '就是',
  '那就是',
];
const STRONG_BOUNDARY_WORDS = [
  '另外',
  '但是',
  '不过',
  '所以',
  '因此',
  '接下来',
  '下一个',
  '也就是说',
  '换句话说',
  '最后',
];
const SENTENCE_BOUNDARY_WORDS = [
  '另外',
  '接下来',
  '下一个',
  '也就是说',
  '换句话说',
  '最后',
];
const ALL_BOUNDARY_WORDS = [...STRONG_BOUNDARY_WORDS, ...SOFT_BOUNDARY_WORDS]
  .sort((left, right) => right.length - left.length);
const QUESTION_ENDING_RE =
  /(吗|嘛|么|呢|什么|为什么|怎么|怎样|咋|如何|哪里|哪儿|哪个|哪些|几|多少|谁|啥|是否|是不是|能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会)$/u;
const QUESTION_PHRASE_RE =
  /(能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会|找没找着|带没带)[\p{Script=Han}A-Za-z0-9]{0,8}$/u;
const INCOMPLETE_STABLE_PAUSE_RE =
  /(我感觉|我觉得|应该|因为|如果|比如|就是|然后|另外|但是|不过|所以|接下来|下一个|要|需要|可以|通过|先|再|把|让)$/u;
const COMPLETE_CLAUSE_END_RE =
  /(了|着|过|完|好|对|是|可以|完成|结束|下了|没问题|差不多)$/u;

export class StreamingRealtimeTextProcessor {
  private rawText = '';
  private realtimeText = '';
  private tailWindowChars: number;

  constructor(
    private dependencies: StreamingRealtimeTextProcessorDependencies,
    options: { tailWindowChars?: number } = {}
  ) {
    this.tailWindowChars = options.tailWindowChars ?? DEFAULT_TAIL_WINDOW_CHARS;
  }

  reset(): void {
    this.rawText = '';
    this.realtimeText = '';
  }

  getRawText(): string {
    return this.rawText;
  }

  getRealtimeText(): string {
    return this.realtimeText;
  }

  acceptAppliedText(text: string): void {
    this.realtimeText = stripUnknownTokens(text);
  }

  processPartial(
    rawCumulativeText: string,
    settings: Settings,
    options: StreamingStableSegmentOptions = {}
  ): StreamingRealtimeProcessResult {
    const rawText = stripUnknownTokens(rawCumulativeText);
    const rawDelta = getAppendDelta(this.rawText, rawText);
    const displayDelta = this.cleanRealtimeDelta(rawDelta, settings);
    const realtimeText = displayDelta
      ? mergeTranscriptText(this.realtimeText, displayDelta)
      : this.realtimeText;

    const stableText = this.processTailWindow(realtimeText, settings, options);
    const tailCorrection = this.buildTailCorrection(realtimeText, stableText);

    this.rawText = rawText;
    this.realtimeText = realtimeText;

    return {
      rawText,
      realtimeText,
      stableText,
      displayDelta,
      cursorText: realtimeText,
      stablePunctuationCandidate: stableText,
      tailCorrection,
      metrics: {
        raw_delta_length: Array.from(rawDelta).length,
        tail_chars_processed: Math.min(Array.from(realtimeText).length, this.tailWindowChars),
      },
    };
  }

  processStableSegment(
    text: string,
    settings: Settings,
    options: StreamingStableSegmentOptions = {}
  ): string {
    const cleaned = cleanupTranscript(text, settings);
    const dictionaryApplied = this.dependencies.applyDictionary(cleaned, { partial: !options.final });
    const codeSwitchResult = this.dependencies.applyCodeSwitch(dictionaryApplied, { partial: !options.final });
    const normalized = this.dependencies.textNormalizationEngine.normalize(codeSwitchResult.text, {
      mode: options.final ? 'streaming_final' : 'streaming_partial',
      strength: 'conservative',
      preserveTerms: codeSwitchResult.matchedTerms,
    });
    const formatted = applyVoiceFormattingCommands(normalized, {
      partial: !options.final,
      enabled: settings.voice_formatting_enabled,
    });
    return applyStableStreamingPunctuation(formatted, {
      final: Boolean(options.final),
      stablePause: Boolean(options.stablePause),
      pauseMs: options.pauseMs ?? 0,
      pauseReason: options.pauseReason,
    });
  }

  private cleanRealtimeDelta(delta: string, settings: Settings): string {
    if (!delta) {
      return '';
    }
    return applyExplicitPunctuationCommands(
      applyVoiceFormattingCommands(stripUnknownTokens(delta), {
        partial: true,
        enabled: settings.voice_formatting_enabled,
      })
    ).trim();
  }

  private processTailWindow(text: string, settings: Settings, options: StreamingStableSegmentOptions): string {
    const { prefix, tail } = splitTailByChars(text, this.tailWindowChars);
    if (!tail) {
      return text;
    }

    const stableTail = this.processStableSegment(tail, settings, {
      final: false,
      stablePause: options.stablePause,
    });
    return `${prefix}${stableTail}`;
  }

  private buildTailCorrection(
    realtimeText: string,
    stableText: string
  ): StreamingTailCorrection | null {
    if (!stableText || stableText === realtimeText) {
      return null;
    }

    const commonPrefixLength = commonPrefixCharLength(realtimeText, stableText);
    const realtimeChars = Array.from(realtimeText);
    const stableChars = Array.from(stableText);
    const charsToReplace = realtimeChars.length - commonPrefixLength;
    const replacementText = stableChars.slice(commonPrefixLength).join('');

    if (
      charsToReplace < MIN_TAIL_REPLACE_CHARS
      || charsToReplace > MAX_TAIL_REPLACE_CHARS
      || !replacementText
    ) {
      return null;
    }

    return {
      replacementText,
      charsToReplace,
      correctedRealtimeText: stableText,
    };
  }
}

function applyExplicitPunctuationCommands(text: string): string {
  return text
    .replace(/(?:加)?逗号/gu, '，')
    .replace(/(?:加)?句号/gu, '。')
    .replace(/(?:加)?问号/gu, '？')
    .replace(/(?:加)?感叹号/gu, '！');
}

function applyStableStreamingPunctuation(
  text: string,
  options: { final: boolean; stablePause: boolean; pauseMs?: number; pauseReason?: StreamingPauseReason }
): string {
  let result = applyExplicitPunctuationCommands(text)
    .replace(/\s+([，。！？；：、,.!?;:])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .trim();

  result = insertQuestionBoundaryPunctuation(result);
  result = insertSemanticBoundaryPunctuation(result, options.final || options.pauseReason === 'hard_pause');
  result = insertDiscourseMarkerComma(result);

  if ((QUESTION_ENDING_RE.test(result) || QUESTION_PHRASE_RE.test(result)) && !/[？?]$/u.test(result)) {
    return result.replace(/[，,、；;：:]+$/u, '') + '？';
  }

  if (options.final && result && !/[。！？!?]$/u.test(result)) {
    return result.replace(/[，,、；;：:]+$/u, '') + '。';
  }

  if (
    options.stablePause
    && result
    && !/[，,。！？!?；;：:]$/u.test(result)
    && !INCOMPLETE_STABLE_PAUSE_RE.test(result)
  ) {
    const lastClause = getLastClause(result);
    const lastClauseLength = Array.from(lastClause).length;
    const hardPause = options.pauseReason === 'hard_pause' || (options.pauseMs ?? 0) >= 700;
    if (hardPause && lastClauseLength >= 6 && COMPLETE_CLAUSE_END_RE.test(lastClause)) {
      return `${result}。`;
    }
    if (lastClauseLength >= 8) {
      return `${result}，`;
    }
  }

  return result;
}

function insertQuestionBoundaryPunctuation(text: string): string {
  return text
    .replace(
      /([了着过完好对是])((?:你|我|他|她|它|我们|他们)?(?:带没带|找没找着|有没有|能不能|可不可以|要不要|是不是|会不会|行不行))/gu,
      '$1。$2'
    )
    .replace(
      /((?:你|我|他|她|它|我们|他们)?(?:带没带|找没找着|有没有|能不能|可不可以|要不要|是不是|会不会|行不行)[^，。！？!?]{0,8}(?:啊|呀|呢|吗)?)(?=(?:耳机|手机|钥匙|文件|东西|你|我|他|她|它|我们|他们|今天|明天|后天|现在|然后|另外|但是|不过|所以|接下来|下一个))/gu,
      '$1？'
    );
}

function insertSemanticBoundaryPunctuation(text: string, final: boolean): string {
  if (!text || ALL_BOUNDARY_WORDS.length === 0) {
    return text;
  }

  const pattern = new RegExp(
    `([^。！？!?，,、；;：:\\s])(${ALL_BOUNDARY_WORDS.map(escapeRegExp).join('|')})`,
    'gu'
  );

  return text.replace(pattern, (match, previousChar: string, word: string, offset: number, whole: string) => {
    void match;
    if (word === '就是' && previousChar === '那') {
      return `${previousChar}${word}`;
    }
    const beforeWord = `${whole.slice(0, offset)}${previousChar}`;
    const previousClause = getLastClause(beforeWord);
    const previousClauseLength = Array.from(previousClause).length;
    const isStrongBoundary = STRONG_BOUNDARY_WORDS.includes(word);
    const isSentenceBoundary = SENTENCE_BOUNDARY_WORDS.includes(word);
    const punctuation = isStrongBoundary && isSentenceBoundary && (final || previousClauseLength >= 16)
      ? '。'
      : '，';
    return `${previousChar}${punctuation}${word}`;
  });
}

function insertDiscourseMarkerComma(text: string): string {
  return text.replace(/(也就是说|换句话说|比如)([^，,。！？!?；;：:\s])/gu, '$1，$2');
}

function getLastClause(text: string): string {
  const parts = text.split(/[，,。！？!?；;：:\n]/u);
  return (parts.at(-1) ?? text).trim();
}

function splitTailByChars(text: string, tailChars: number): { prefix: string; tail: string } {
  const chars = Array.from(text);
  if (chars.length <= tailChars) {
    return { prefix: '', tail: text };
  }
  return {
    prefix: chars.slice(0, -tailChars).join(''),
    tail: chars.slice(-tailChars).join(''),
  };
}

function getAppendDelta(previous: string, current: string): string {
  if (!previous) {
    return current;
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  const previousChars = Array.from(previous);
  const currentChars = Array.from(current);
  let index = 0;
  while (
    index < previousChars.length
    && index < currentChars.length
    && previousChars[index] === currentChars[index]
  ) {
    index += 1;
  }

  if (index >= previousChars.length - DEFAULT_TAIL_WINDOW_CHARS) {
    return currentChars.slice(previousChars.length).join('');
  }
  return current;
}

function commonPrefixCharLength(left: string, right: string): number {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  let index = 0;
  while (index < leftChars.length && index < rightChars.length && leftChars[index] === rightChars[index]) {
    index += 1;
  }
  return index;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
