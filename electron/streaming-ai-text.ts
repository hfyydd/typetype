import { stripUnknownTokens } from './transcript-cleanup';

export interface StreamingAiParsedResult {
  refinedRawText: string;
  summaryText: string;
}

const GENERATED_SECTION_NAMES = [
  '功能介绍',
  '功能特点',
  '当前状态',
  '演示说明',
  '状态说明',
  '处理说明',
  '模型说明',
  '备注',
  '说明',
];

const DIAGNOSTIC_LINE_PATTERNS = [
  /ONNX\s*Runtime/iu,
  /onnxruntime/iu,
  /onnxruntime_binding\.node/iu,
  /app\.asar/iu,
  /node_modules/iu,
  /The operating system cannot run %1/iu,
  /dynamic link library/iu,
  /DLL initialization/iu,
  /Visual C\+\+/iu,
  /Microsoft Visual C\+\+/iu,
  /系统运行库/u,
  /本地断句增强需要/u,
  /基础断句已可用/u,
  /请安装.*运行库/u,
  /安装\/修复/u,
  /整理稿已更新/u,
  /最近整理/u,
  /自动回填/u,
  /API\s*(?:稳定|正在|纠错|整理|未配置)/iu,
  /Thinking/iu,
  /^[A-Z]:\\/u,
  /\\\\\?\\/u,
];

function stripMarkdownLine(line: string): string {
  const withoutMarkdown = line
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^\s*[-*•·]\s+/u, '')
    .replace(/^\s*\d+\)\s+/u, '')
    .replace(/^>\s*/u, '')
    .replace(/`/g, '')
    .trim();

  return stripUnknownTokens(withoutMarkdown
    .replace(/\s+([，。！？；：、])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .trim());
}

function normalizedHeadingName(line: string): string {
  return stripMarkdownLine(line)
    .replace(/[【】\[\]]/gu, '')
    .replace(/\s+/gu, '')
    .replace(/[：:]+$/u, '');
}

function isGeneratedSectionHeading(line: string): boolean {
  return GENERATED_SECTION_NAMES.includes(normalizedHeadingName(line));
}

function isGeneratedStatusLine(line: string): boolean {
  const normalized = stripMarkdownLine(line).replace(/\s+/gu, '');
  return GENERATED_SECTION_NAMES.some((name) => normalized.startsWith(`${name}:`) || normalized.startsWith(`${name}：`));
}

function isBoilerplateLine(line: string): boolean {
  const normalized = stripMarkdownLine(line).replace(/\s+/gu, '');
  if (!normalized) {
    return true;
  }

  return [
    /^以下是(?:整理|润写|优化|修正|会议纪要|结构化)?(?:后)?(?:的)?(?:内容|正文)?[:：]?$/u,
    /^下面是(?:整理|润写|优化|修正|会议纪要|结构化)?(?:后)?(?:的)?(?:内容|正文)?[:：]?$/u,
    /^整理如下[:：]?$/u,
    /^润写如下[:：]?$/u,
    /^输出如下[:：]?$/u,
    /^根据(?:你|您)?(?:提供|输入|转写)?(?:的)?内容整理如下[:：]?$/u,
  ].some((pattern) => pattern.test(normalized));
}

function isDiagnosticLine(line: string): boolean {
  const cleaned = stripMarkdownLine(line);
  return DIAGNOSTIC_LINE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function isUsefulSectionHeading(line: string): boolean {
  return /^(?:AI\s*修正原文|修正原文|原文精修|整理稿|会议纪要|结构化草稿|AI\s*整理稿)\s*[:：]?\s*$/u.test(stripMarkdownLine(line));
}

export function sanitizeStreamingAiText(text: string): string {
  const normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/^```[a-zA-Z0-9_-]*\n?/u, '').replace(/\n?```$/u, ''))
    .replace(/^\s*[-*_]{3,}\s*$/gmu, '')
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`/g, '');

  const lines = normalized.split('\n');
  const kept: string[] = [];
  let droppingGeneratedSection = false;

  for (const originalLine of lines) {
    const rawLine = originalLine.trim();
    if (!rawLine) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      droppingGeneratedSection = false;
      continue;
    }

    if (isBoilerplateLine(rawLine) || isGeneratedStatusLine(rawLine) || isDiagnosticLine(rawLine)) {
      continue;
    }

    if (isGeneratedSectionHeading(rawLine)) {
      droppingGeneratedSection = true;
      continue;
    }

    if (droppingGeneratedSection && !isUsefulSectionHeading(rawLine)) {
      continue;
    }

    droppingGeneratedSection = false;
    kept.push(stripMarkdownLine(rawLine));
  }

  return stripUnknownTokens(kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

export function parseStreamingAiResult(text: string, fallbackRawText: string): StreamingAiParsedResult {
  const cleaned = sanitizeStreamingAiText(text);
  const refinedMatch = cleaned.match(/(?:AI\s*修正原文|修正原文|原文精修)\s*[:：]\s*([\s\S]*?)(?=\n(?:会议纪要|整理稿|结构化草稿|AI\s*整理稿)\s*[:：]|$)/u);
  const summaryMatch = cleaned.match(/(?:会议纪要|整理稿|结构化草稿|AI\s*整理稿)\s*[:：]\s*([\s\S]*)$/u);

  if (refinedMatch || summaryMatch) {
    return {
      refinedRawText: sanitizeStreamingAiText(refinedMatch?.[1] || fallbackRawText),
      summaryText: sanitizeStreamingAiText(summaryMatch?.[1] || cleaned),
    };
  }

  return {
    refinedRawText: sanitizeStreamingAiText(fallbackRawText),
    summaryText: cleaned,
  };
}
