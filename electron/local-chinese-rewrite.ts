import { RewriteScenario } from './types';

export interface LocalChineseRewriteInput {
  rawText: string;
  scenario?: RewriteScenario;
  preserveTerms?: string[];
  final?: boolean;
}

export interface LocalChineseRewriteResult {
  refinedRawText: string;
  structuredText: string;
  outlineText: string;
  preserveTerms: string[];
}

type BoundaryPunctuation = '，' | '。' | '；' | '：';

interface ProtectedText {
  text: string;
  values: string[];
}

interface BoundaryCandidate {
  index: number;
  punctuation: BoundaryPunctuation;
  score: number;
  reason: string;
}

const SENTENCE_END_RE = /[。！？!?]$/u;
const CJK_RE = /[\u3400-\u9fff]/u;
const ANY_STRONG_PUNCTUATION_RE = /[。！？!?；;\n]/u;
const ANY_PUNCTUATION_RE = /[，,。！？!?、；;：:\n]/u;
const QUESTION_RE =
  /(吗|嘛|么|呢|什么|为什么|怎么|怎样|咋|如何|哪里|哪儿|哪个|哪些|几|多少|谁|啥|是否|是不是|能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会)$/u;
const QUESTION_PREFIX_RE = /^(请问|问一下|我想问|想问一下|麻烦问一下)/u;
const FILLER_RE =
  /(?:^|[，,。！？!?；;\s])(嗯+|啊+|呃+|额+|那个|这个|就是说|怎么说呢|然后吧|对吧|是吧|你知道吧|其实吧)(?=[，,。！？!?；;\s]|$)/gu;
const SECTION_HEADING_RE = /^(?:一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|（一）|（二）|（三）|（四）|（五）|（六）|（七）|（八）|（九）|（十）)/u;

const CLAUSE_BOUNDARY_WORDS = [
  '首先',
  '其次',
  '再次',
  '最后',
  '另外',
  '同时',
  '然后',
  '接下来',
  '下一步',
  '但是',
  '不过',
  '虽然',
  '因此',
  '所以',
  '因为',
  '总之',
  '综上',
  '并且',
  '而且',
  '以及',
  '其中',
  '特别是',
  '相较而言',
  '与此同时',
  '当前',
  '一方面',
  '另一方面',
  '由此',
  '进而',
  '仍',
  '仍然',
  '亟待',
  '需要注意的是',
  '要求',
  '时间',
  '地点',
  '人员',
  '参会人员',
  '联系人',
  '问题',
  '结论',
  '形成了',
  '存在',
];

const STRUCTURE_BOUNDARY_WORDS = [
  '第一',
  '第二',
  '第三',
  '第四',
  '第五',
  '第六',
  '第七',
  '第八',
  '第九',
  '第十',
  '首先',
  '其次',
  '再次',
  '最后',
  '一是',
  '二是',
  '三是',
  '四是',
  '五是',
];

const COLON_LABELS = [
  '标题',
  '主题',
  '时间',
  '地点',
  '人员',
  '参会人员',
  '通知对象',
  '工作要求',
  '具体要求',
  '联系人',
  '联系电话',
  '风险',
  '问题',
  '结论',
  '待办',
  '下一步',
  '主要内容',
  '重点内容',
  '自查内容',
];

const BEFORE_BOUNDARY_RULES: Array<{ marker: string; punctuation: BoundaryPunctuation; score: number; reason: string }> = [
  { marker: '相较而言', punctuation: '。', score: 9, reason: 'comparative_turn' },
  { marker: '相比之下', punctuation: '。', score: 9, reason: 'comparative_turn' },
  { marker: '与此同时', punctuation: '。', score: 8, reason: 'parallel_turn' },
  { marker: '当前', punctuation: '。', score: 8, reason: 'new_stage' },
  { marker: '同时', punctuation: '，', score: 6, reason: 'parallel_clause' },
  { marker: '一方面', punctuation: '。', score: 8, reason: 'parallel_structure' },
  { marker: '另一方面', punctuation: '；', score: 8, reason: 'parallel_structure' },
  { marker: '但是', punctuation: '。', score: 8, reason: 'adversative' },
  { marker: '不过', punctuation: '。', score: 8, reason: 'adversative' },
  { marker: '然而', punctuation: '。', score: 8, reason: 'adversative' },
  { marker: '因此', punctuation: '。', score: 8, reason: 'causal_result' },
  { marker: '所以', punctuation: '。', score: 8, reason: 'causal_result' },
  { marker: '由此可见', punctuation: '。', score: 9, reason: 'conclusion' },
  { marker: '综上', punctuation: '。', score: 9, reason: 'conclusion' },
  { marker: '总之', punctuation: '。', score: 9, reason: 'conclusion' },
  { marker: '具体来看', punctuation: '。', score: 8, reason: 'explanation' },
  { marker: '具体而言', punctuation: '。', score: 8, reason: 'explanation' },
  { marker: '主要表现为', punctuation: '：', score: 10, reason: 'explanation_colon' },
  { marker: '表现为', punctuation: '：', score: 10, reason: 'explanation_colon' },
  { marker: '主要包括', punctuation: '：', score: 10, reason: 'enumeration_colon' },
  { marker: '具体包括', punctuation: '：', score: 10, reason: 'enumeration_colon' },
];

const AFTER_BOUNDARY_RULES: Array<{ pattern: RegExp; punctuation: BoundaryPunctuation; score: number; reason: string }> = [
  { pattern: /(相较而言|相比之下)(?=针对|当前|在|与|对|其)/gu, punctuation: '，', score: 8, reason: 'comparative_intro' },
  { pattern: /(进程中|过程中|背景下|情况下|基础上|前提下)/gu, punctuation: '，', score: 7, reason: 'adverbial_boundary' },
  { pattern: /(政务与商业领域|商业领域|政务领域|研究领域|管理领域|业务领域)/gu, punctuation: '。', score: 9, reason: 'domain_boundary' },
  { pattern: /(特殊场域|重点领域|关键环节|重要场景)/gu, punctuation: '，', score: 7, reason: 'subject_continuation' },
  { pattern: /(研究|框架|体系|机制)(?=仍|仍然|亟待|待|有待)/gu, punctuation: '，', score: 7, reason: 'research_status' },
  { pattern: /(的同时|同时)(?=也|因|仍|还|又|暴露|形成|存在|需要|应当)/gu, punctuation: '，', score: 9, reason: 'parallel_transition' },
  { pattern: /(深入探索|深入研究|进一步完善|持续推进|持续优化)/gu, punctuation: '。', score: 10, reason: 'complete_statement' },
  { pattern: /(显著成果|明显成效|积极进展|阶段性成果)/gu, punctuation: '，', score: 7, reason: 'achievement_transition' },
  { pattern: /(数据困境|现实困境|突出问题|深层问题|安全隐患|风险隐患)/gu, punctuation: '：', score: 10, reason: 'problem_enumeration' },
  { pattern: /(标准不一|口径不一|流程不一|建设分散)/gu, punctuation: '，', score: 7, reason: 'cause_to_result' },
  { pattern: /(数据孤岛|信息孤岛|管理盲区|薄弱环节)/gu, punctuation: '；', score: 9, reason: 'parallel_problem' },
  { pattern: /(效率较低|效率偏低|成本较高|协同不足)/gu, punctuation: '，', score: 7, reason: 'problem_continuation' },
  { pattern: /(错误频发|问题频发|反复出现)/gu, punctuation: '；', score: 9, reason: 'parallel_problem' },
  { pattern: /(参差不齐|不够规范|不够统一)/gu, punctuation: '，', score: 7, reason: 'risk_continuation' },
  { pattern: /(存在隐患|存在问题|亟待解决|有待完善)/gu, punctuation: '。', score: 10, reason: 'complete_problem' },
];

const SAFE_LENGTH_BREAK_AFTER_RE = /[中下后时来内外上方域究索果境一低发齐题患况成效展项点]/u;
const SAFE_LENGTH_BREAK_BEFORE_RE = /[相当同目各跨并且但仍亟因由对在主具问结风要需]/u;
const UNSAFE_LENGTH_BOUNDARY_PAIRS = new Set([
  '国家',
  '治理',
  '体系',
  '能力',
  '现代',
  '数据',
  '管理',
  '框架',
  '研究',
  '亟待',
  '较薄',
  '薄弱',
  '深入',
  '探索',
  '监狱',
  '信息',
  '化建',
  '建设',
  '历史',
  '发展',
  '认知',
  '局限',
  '深层',
  '困境',
  '业务',
  '系统',
  '独立',
  '标准',
  '不一',
  '互通',
  '孤岛',
  '部门',
  '协作',
  '人工',
  '对接',
  '文件',
  '流转',
  '效率',
  '错误',
  '频发',
  '参差',
  '不齐',
  '安全',
  '隐患',
]);

const OFFICIAL_SCENARIOS = new Set<RewriteScenario>([
  'official_resolution',
  'official_decision',
  'official_order',
  'official_communique',
  'official_announcement',
  'official_public_notice',
  'official_opinion',
  'official_notice',
  'official_circular',
  'official_report',
  'official_request',
  'official_reply',
  'official_proposal',
  'official_letter',
  'official_minutes',
]);

const NOTICE_SCENARIOS = new Set<RewriteScenario>([
  'official_notice',
  'business_notice',
]);

const MEETING_SCENARIOS = new Set<RewriteScenario>([
  'meeting_notes',
  'official_minutes',
  'business_meeting_minutes',
]);

const WORK_REPORT_SCENARIOS = new Set<RewriteScenario>([
  'work_report',
  'official_report',
  'business_summary',
  'business_plan',
  'business_proposal',
]);

const TODO_SCENARIOS = new Set<RewriteScenario>([
  'todo_list',
  'business_application',
]);

const DOCUMENT_SCENARIO_LABELS: Partial<Record<RewriteScenario, string>> = {
  official_resolution: '决议',
  official_decision: '决定',
  official_order: '命令（令）',
  official_communique: '公报',
  official_announcement: '公告',
  official_public_notice: '通告',
  official_opinion: '意见',
  official_notice: '通知',
  official_circular: '通报',
  official_report: '报告',
  official_request: '请示',
  official_reply: '批复',
  official_proposal: '议案',
  official_letter: '函',
  official_minutes: '纪要',
  business_notice: '通知',
  business_plan: '工作计划',
  business_summary: '工作总结',
  business_proposal: '工作方案',
  business_email: '商务邮件',
  business_memo: '备忘录',
  business_application: '申请审批说明',
  business_meeting_minutes: '会议纪要',
  student_leave_note: '请假条',
  student_report: '实践报告',
  student_activity_plan: '活动策划',
  student_speech: '演讲稿',
  student_review: '学习总结',
};

export function rewriteChineseLocally(input: LocalChineseRewriteInput): LocalChineseRewriteResult {
  const scenario = input.scenario ?? 'general';
  const protectedTerms = dedupeTerms(input.preserveTerms ?? []);
  const normalized = normalizeSpeechText(input.rawText, protectedTerms);
  const refinedRawText = refineRawText(normalized, scenario, input.final ?? false, protectedTerms);
  const sections = splitIntoSemanticSections(refinedRawText);
  const structuredText = buildStructuredText(sections, scenario, refinedRawText);
  const outlineText = buildOutlineText(sections);

  return {
    refinedRawText,
    structuredText,
    outlineText,
    preserveTerms: protectedTerms,
  };
}

export function buildLocalRewritePromptContext(result: LocalChineseRewriteResult): string {
  return [
    '<本地规则预处理>',
    '本地修正原文：',
    result.refinedRawText || '（无）',
    '',
    '本地分段要点：',
    result.outlineText || '（无）',
    '',
    '本地结构化草稿：',
    result.structuredText || '（无）',
    '',
    result.preserveTerms.length > 0
      ? `必须保留术语：${result.preserveTerms.join('、')}`
      : '必须保留术语：（无）',
    '</本地规则预处理>',
  ].join('\n');
}

function normalizeSpeechText(text: string, protectedTerms: string[]): string {
  let result = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*([，,。！？!?、；;：:])\s*/gu, '$1')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .trim();

  result = restoreCommonPunctuationCommands(result);
  result = removeFillers(result);
  result = collapseRepeatedWords(result);
  result = collapseRepeatedFragments(result);
  return result.trim();
}

function restoreCommonPunctuationCommands(text: string): string {
  return text
    .replace(/(?:加)?逗号/gu, '，')
    .replace(/(?:加)?句号/gu, '。')
    .replace(/(?:加)?问号/gu, '？')
    .replace(/(?:加)?感叹号/gu, '！')
    .replace(/(?:加)?冒号/gu, '：')
    .replace(/(?:加)?分号/gu, '；')
    .replace(/(?:加)?顿号/gu, '、')
    .replace(/(?:空一格|空格|加个空格)/gu, ' ')
    .replace(/(?:换行|下一行|另起一行)/gu, '\n')
    .replace(/(?:空一行|隔一行|另起一段)/gu, '\n\n');
}

function removeFillers(text: string): string {
  return text
    .replace(FILLER_RE, (match, filler) => {
      const prefix = match.startsWith(filler) ? '' : match[0];
      return /[，,。！？!?；;\s]/u.test(prefix) ? prefix : '';
    })
    .replace(/(^|[，,。！？!?；;\s])(?:嗯+|啊+|呃+|额+)(?=$|[，,。！？!?；;\s])/gu, '$1')
    .replace(/(^|[，,。！？!?；;\s])(?:嗯+|啊+|呃+|额+)(?=现在|我|你|他|她|它|我们|他们|这|那|今天|刚才|测试|看看)/gu, '$1')
    .replace(/(现在|然后|不过|但是|可是|我|你|他|她|这|那|兄弟|哥们)啊(?=我|你|他|她|这|那|现在|看看|真|整|说|人)/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .replace(/^[，,。！？!?；;\s]+/u, '')
    .trim();
}

function collapseRepeatedWords(text: string): string {
  return text.replace(/([\u4e00-\u9fa5]{2,4})\1+/gu, (_match, word) => {
    return word;
  });
}

function collapseRepeatedFragments(text: string): string {
  const sentences = text.split(/(?<=[。！？!?；;])|\n+/u).map((item) => item.trim()).filter(Boolean);
  if (sentences.length <= 1) {
    return text;
  }

  const kept: string[] = [];
  for (const sentence of sentences) {
    const previous = kept[kept.length - 1];
    if (previous && similarityKey(previous) === similarityKey(sentence)) {
      continue;
    }
    kept.push(sentence);
  }
  return kept.join('');
}

function similarityKey(text: string): string {
  return text.replace(/[，,。！？!?、；;：:\s]/gu, '').slice(0, 40);
}

function refineRawText(text: string, scenario: RewriteScenario, final: boolean, protectedTerms: string[]): string {
  if (!text) {
    return '';
  }

  const lines = text.split('\n');
  const refinedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '';
    }
    return punctuateLine(trimmed, scenario, final, protectedTerms);
  });

  return refinedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function punctuateLine(line: string, scenario: RewriteScenario, final: boolean, protectedTerms: string[]): string {
  const protectedLine = protectSemanticFragments(line, protectedTerms);
  let result = protectedLine.text
    .replace(/\s+([，。！？；：、])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .trim();

  result = insertColonsAfterLabels(result);
  result = insertAcademicPhraseBreaks(result);
  result = insertSpokenPhraseBreaks(result);
  result = insertCommasBeforeBoundaryWords(result);
  result = insertOfficialStylePhraseBreaks(result);
  result = insertEnumerationBoundaries(result);
  result = applySemanticBoundaryScoring(result, scenario);
  result = normalizeClausePunctuation(result, scenario);
  result = restoreProtectedFragments(result, protectedLine.values);

  if (!final && !SENTENCE_END_RE.test(result) && result.length < 18) {
    return result;
  }

  return ensureSentenceEnding(result, scenario);
}

function protectSemanticFragments(text: string, protectedTerms: string[]): ProtectedText {
  const values: string[] = [];
  let result = text;
  const patterns = [
    /https?:\/\/[^\s，。！？；：、]+/giu,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu,
    /sk-[A-Za-z0-9_-]{8,}/gu,
    /GB\/T\s*\d+(?:[.-]\d+)*(?:-\d{4})?/giu,
    /\d{4}年\d{1,2}月\d{1,2}日/gu,
    /\d{4}年\d{1,2}月/gu,
    /\d{1,2}月\d{1,2}日/gu,
    /\d{1,2}[:：]\d{2}(?:[:：]\d{2})?/gu,
    /\d+(?:\.\d+)?%/gu,
    /[A-Za-z][A-Za-z0-9]*(?:[-_.\/][A-Za-z0-9]+)+/gu,
    /[A-Za-z]{2,}\d+(?:[-_.][A-Za-z0-9]+)*/gu,
  ];

  const protect = (value: string): string => {
    const token = `@@${values.length}@@`;
    values.push(value);
    return token;
  };

  for (const pattern of patterns) {
    result = result.replace(pattern, (match) => protect(match));
  }

  for (const term of protectedTerms.sort((a, b) => b.length - a.length)) {
    if (!term || term.length < 2 || result.includes(term) === false) {
      continue;
    }
    result = result.replace(new RegExp(escapeRegExp(term), 'gu'), (match) => protect(match));
  }

  return { text: result, values };
}

function restoreProtectedFragments(text: string, values: string[]): string {
  return text.replace(/@@(\d+)@@/gu, (_match, indexText) => {
    const value = values[Number(indexText)];
    return typeof value === 'string' ? value : '';
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySemanticBoundaryScoring(text: string, scenario: RewriteScenario): string {
  let result = text;

  for (let i = 0; i < 16; i += 1) {
    const segment = findLongestWeaklyPunctuatedSegment(result);
    if (!segment || countCjk(segment.text) <= 45) {
      break;
    }

    const candidate = chooseBestBoundaryCandidate(segment.text, scenario);
    if (!candidate) {
      break;
    }

    const insertIndex = segment.start + candidate.index;
    result = insertSemanticPunctuation(result, insertIndex, candidate);
  }

  return result;
}

function findLongestWeaklyPunctuatedSegment(text: string): { start: number; end: number; text: string } | null {
  let best: { start: number; end: number; text: string } | null = null;
  let start = 0;

  for (let i = 0; i <= text.length; i += 1) {
    const char = text[i] ?? '';
    if (i === text.length || ANY_PUNCTUATION_RE.test(char)) {
      const segmentText = text.slice(start, i).trim();
      const offset = text.slice(start, i).indexOf(segmentText);
      const actualStart = offset >= 0 ? start + offset : start;
      const current = { start: actualStart, end: i, text: segmentText };
      if (segmentText && (!best || countCjk(segmentText) > countCjk(best.text))) {
        best = current;
      }
      start = i + 1;
    }
  }

  return best;
}

function chooseBestBoundaryCandidate(segment: string, scenario: RewriteScenario): BoundaryCandidate | null {
  const candidates = collectBoundaryCandidates(segment, scenario)
    .map((candidate) => ({
      ...candidate,
      score: scoreBoundaryCandidate(segment, candidate, scenario),
    }))
    .filter((candidate) => candidate.score >= 7)
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return buildLengthFallbackCandidate(segment);
}

function collectBoundaryCandidates(segment: string, scenario: RewriteScenario): BoundaryCandidate[] {
  const candidates: BoundaryCandidate[] = [];

  for (const rule of BEFORE_BOUNDARY_RULES) {
    for (const index of findAllIndexes(segment, rule.marker)) {
      const insertIndex = rule.punctuation === '：' ? index + rule.marker.length : index;
      candidates.push({
        index: insertIndex,
        punctuation: normalizeBoundaryPunctuation(rule.punctuation, scenario, rule.reason),
        score: rule.score,
        reason: rule.reason,
      });
    }
  }

  for (const rule of AFTER_BOUNDARY_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(segment)) !== null) {
      candidates.push({
        index: match.index + match[0].length,
        punctuation: normalizeBoundaryPunctuation(rule.punctuation, scenario, rule.reason),
        score: rule.score,
        reason: rule.reason,
      });
    }
  }

  for (const marker of CLAUSE_BOUNDARY_WORDS) {
    for (const index of findAllIndexes(segment, marker)) {
      candidates.push({
        index,
        punctuation: marker === '形成了' || marker === '存在' ? '，' : '，',
        score: 5,
        reason: 'clause_marker',
      });
    }
  }

  return dedupeCandidates(candidates)
    .filter((candidate) => isValidBoundaryIndex(segment, candidate.index));
}

function scoreBoundaryCandidate(segment: string, candidate: BoundaryCandidate, scenario: RewriteScenario): number {
  const before = segment.slice(0, candidate.index);
  const after = segment.slice(candidate.index);
  const beforeLength = countCjk(before);
  const afterLength = countCjk(after);
  let score = candidate.score;

  if (beforeLength < 8 || afterLength < 5) {
    score -= 6;
  }
  if (beforeLength >= 16 && afterLength >= 8) {
    score += 2;
  }
  if (beforeLength >= 28) {
    score += 2;
  }
  if (beforeLength >= 45) {
    score += 4;
  }
  if (afterLength >= 45) {
    score += 2;
  }
  if (candidate.punctuation === '。' && beforeLength < 16) {
    score -= 3;
  }
  if (candidate.punctuation === '；' && (beforeLength < 18 || afterLength < 12)) {
    score -= 2;
  }
  if (OFFICIAL_SCENARIOS.has(scenario) && candidate.punctuation === '。') {
    score += 1;
  }
  if (/[，,、：:]$/u.test(before) || /^[，,、：:。！？!?；;]/u.test(after)) {
    score -= 8;
  }

  return score;
}

function buildLengthFallbackCandidate(segment: string): BoundaryCandidate | null {
  const chars = Array.from(segment);
  let cjkCount = 0;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let fallbackIndex = -1;
  let fallbackDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < chars.length; i += 1) {
    if (CJK_RE.test(chars[i])) {
      cjkCount += 1;
    }
    if (cjkCount < 26 || cjkCount > 42) {
      continue;
    }
    if (!CJK_RE.test(chars[i])) {
      continue;
    }
    const distance = Math.abs(cjkCount - 34);
    if (isUnsafeLengthBoundary(chars, i)) {
      continue;
    }
    if (distance < fallbackDistance) {
      fallbackDistance = distance;
      fallbackIndex = stringIndexFromArrayIndex(chars, i + 1);
    }
    if (!isSafeLengthBoundary(chars, i)) {
      continue;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = stringIndexFromArrayIndex(chars, i + 1);
    }
  }

  const chosenIndex = bestIndex >= 0 ? bestIndex : fallbackIndex;
  if (chosenIndex < 0) {
    return null;
  }

  return {
    index: chosenIndex,
    punctuation: '，',
    score: 7,
    reason: 'length_fallback',
  };
}

function isUnsafeLengthBoundary(chars: string[], index: number): boolean {
  const before = chars[index] ?? '';
  const after = chars[index + 1] ?? '';
  if (!CJK_RE.test(before) || !CJK_RE.test(after)) {
    return true;
  }
  if (UNSAFE_LENGTH_BOUNDARY_PAIRS.has(`${before}${after}`)) {
    return true;
  }
  if (/[的地得了着过与和及并或把将于对从到]/u.test(before)) {
    return true;
  }
  if (/[的地得了着过与和及并或]/u.test(after)) {
    return true;
  }
  return false;
}

function isSafeLengthBoundary(chars: string[], index: number): boolean {
  const before = chars[index] ?? '';
  const after = chars[index + 1] ?? '';
  return SAFE_LENGTH_BREAK_AFTER_RE.test(before) || SAFE_LENGTH_BREAK_BEFORE_RE.test(after);
}

function insertSemanticPunctuation(text: string, index: number, candidate: BoundaryCandidate): string {
  const before = text.slice(0, index).replace(/[，,、；;：:]+$/u, '');
  const after = text.slice(index).replace(/^[，,、；;：:]+/u, '');
  const separator = candidate.punctuation === '。' && (candidate.reason.includes('turn') || candidate.reason.includes('complete') || candidate.reason.includes('domain'))
    ? '。\n'
    : candidate.punctuation;

  return `${before}${separator}${after}`;
}

function normalizeBoundaryPunctuation(
  punctuation: BoundaryPunctuation,
  scenario: RewriteScenario,
  reason: string
): BoundaryPunctuation {
  if (OFFICIAL_SCENARIOS.has(scenario) && punctuation === '；' && reason === 'parallel_problem') {
    return '；';
  }
  return punctuation;
}

function isValidBoundaryIndex(segment: string, index: number): boolean {
  if (index <= 0 || index >= segment.length) {
    return false;
  }
  const before = segment[index - 1] ?? '';
  const after = segment[index] ?? '';
  if (ANY_PUNCTUATION_RE.test(before) || ANY_PUNCTUATION_RE.test(after)) {
    return false;
  }
  if (!segment.slice(0, index).trim() || !segment.slice(index).trim()) {
    return false;
  }
  return true;
}

function dedupeCandidates(candidates: BoundaryCandidate[]): BoundaryCandidate[] {
  const map = new Map<string, BoundaryCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.index}:${candidate.punctuation}`;
    const existing = map.get(key);
    if (!existing || existing.score < candidate.score) {
      map.set(key, candidate);
    }
  }
  return Array.from(map.values());
}

function findAllIndexes(text: string, marker: string): number[] {
  const indexes: number[] = [];
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(marker, start);
    if (index < 0) {
      break;
    }
    indexes.push(index);
    start = index + marker.length;
  }
  return indexes;
}

function countCjk(text: string): number {
  return Array.from(text).filter((char) => CJK_RE.test(char)).length;
}

function stringIndexFromArrayIndex(chars: string[], arrayIndex: number): number {
  return chars.slice(0, arrayIndex).join('').length;
}

function insertColonsAfterLabels(text: string): string {
  let result = text;
  for (const label of COLON_LABELS) {
    const pattern = new RegExp(`(^|[。！？!?；;\\n])(${label})(?![：:])(?=[\\u4e00-\\u9fa5A-Za-z0-9])`, 'gu');
    result = result.replace(pattern, `$1$2：`);
  }
  return result;
}

function insertCommasBeforeBoundaryWords(text: string): string {
  let result = text;
  for (const word of CLAUSE_BOUNDARY_WORDS) {
    const pattern = new RegExp(`([^。！？!?，,、；;：:\\n\\s])(${word})(?=[\\u3400-\\u9fffA-Za-z0-9])`, 'gu');
    result = result.replace(pattern, (match, before: string, marker: string) => {
      if (marker === '同时' && before === '的') {
        return match;
      }
      return `${before}，${marker}`;
    });
  }
  return result;
}

function insertEnumerationBoundaries(text: string): string {
  let result = text;
  for (const word of STRUCTURE_BOUNDARY_WORDS) {
    const pattern = new RegExp(`([^。！？!?；;\\n])(${word})(?=[\\u3400-\\u9fffA-Za-z0-9])`, 'gu');
    result = result.replace(pattern, `$1\n$2`);
  }
  return result;
}

function insertAcademicPhraseBreaks(text: string): string {
  return text
    .replace(/(相较而言|相比之下)(?=针对|当前|在|与|对|其)/gu, '$1，')
    .replace(/(进程中)(?=数据治理|相关研究|各项工作)/gu, '$1，')
    .replace(/(领域)(?=相较而言|相比之下|而|但|针对)/gu, '$1。\n')
    .replace(/(特殊场域)(?=其|在|由于|仍|亟待)/gu, '$1，')
    .replace(/(研究)(?=仍|仍然|亟待|待|有待)/gu, '$1，')
    .replace(/(深入探索)(?=当前|同时|另外|因此)/gu, '$1。\n')
    .replace(/(显著成果的同时)(?=也|因|仍|还|又|暴露|形成|存在)/gu, '$1，')
    .replace(/(显著成果)(?=同时|但|但是|不过)/gu, '$1，')
    .replace(/(数据困境)(?=各类|主要|具体|表现为)/gu, '$1。')
    .replace(/(标准不一)(?=形成|导致|造成|使得)/gu, '$1，')
    .replace(/(数据孤岛)(?=跨部门|导致|造成|影响)/gu, '$1。')
    .replace(/(文件流转效率较低)(?=且|并且|同时|错误)/gu, '$1，')
    .replace(/(错误频乏|错误频繁)(?=错误频发)/gu, '')
    .replace(/错误频发[，,](?=各类|同时|并且)/gu, '错误频发。')
    .replace(/错误频发(?=各类|同时|并且|$)/gu, '错误频发。')
    .replace(/(数据参差不齐)(?=安全|并|且|存在)/gu, '$1，')
    .replace(/(安全)(?=存在隐患)/gu, '$1')
    .replace(/(存在隐患)(?![。！？!?])/gu, '$1。');
}

function insertSpokenPhraseBreaks(text: string): string {
  return text
    .replace(/(吗)(?=你|我|他|她|它|这|那|测试|兄弟|哥们|$)/gu, '$1？')
    .replace(/(呢)(?=你|我|他|她|它|这|那|测试|兄弟|哥们|$)/gu, '$1？')
    .replace(/(咋解释|怎么解释|咋办|怎么办|什么情况|啥情况)(?=我|你|他|她|它|这|那|测试|兄弟|哥们|$)/gu, '$1？')
    .replace(/(你整啥呢|你干啥呢|你说啥呢|干嘛呢|整啥呢)(?=测试|你|我|他|她|它|这|那|$)/gu, '$1？')
    .replace(/(不是扯淡呢吗|这不是扯淡呢吗|扯淡呢吗)(?=你|我|他|她|它|这|那|测试|兄弟|哥们|$)/gu, '$1？')
    .replace(/(得了呗|算了吧|算了|就这样吧|没事吧|没啥事|没关系|先这样)(?=不过|但是|可是|然后|兄弟|哥们|现在|我|你|他|她|它|这|那|测试|$)/gu, '$1。')
    .replace(/(太幽默了|太离谱了|太夸张了|爆了|炸了|完了|结束了|没了|行了)(?=这|那|兄弟|哥们|现在|我|你|他|她|它|测试|$)/gu, '$1。')
    .replace(/(没啥事|没事了|没什么事|没有事)(?=就|不管|然后|不过|但是|可是|我|你|他|她|它|这|那|测试|$)/gu, '$1。')
    .replace(/(昨昨的|刚才的|前面的|后面的)(?=兄弟|哥们|现在|我|你|他|她|它|这|那)/gu, '$1。')
    .replace(/([吧呗嘛呀啦啊])(?=不过|但是|可是|然后|兄弟|哥们|现在|我|你|他|她|它|这|那|人真|测试)/gu, '$1。')
    .replace(/(兄弟|哥们|朋友们|各位)(?=现在|我|你|他|她|它|这|那|测试)/gu, '$1，')
    .replace(/(测试)(?=[\u3400-\u9fff]|$)/gu, '$1。');
}

function insertOfficialStylePhraseBreaks(text: string): string {
  return text
    .replace(/(工作)(?=将其|作为|并|对|要|需要)/gu, '$1，')
    .replace(/(重要抓手)(?=对照|按照|根据|并|同时)/gu, '$1，')
    .replace(/(管理规范)(?=采取|开展|进行|对|并)/gu, '$1，')
    .replace(/(的方式)(?=对|向|为|进行|开展)/gu, '$1，')
    .replace(/(全覆盖式的廉政体检)(?=此次|本次|并|同时)/gu, '$1，')
    .replace(/(填报格式)(?=领导干部|本人|相关|以及)/gu, '$1、')
    .replace(/(述职报告)(?=本人|相关|以及)/gu, '$1、')
    .replace(/(本人承诺)(?=等)/gu, '$1');
}

function splitLongChineseSentence(text: string): string {
  if (text.length <= 48 || /[。！？!?\n]/u.test(text)) {
    return text;
  }

  let result = '';
  let count = 0;
  for (const char of Array.from(text)) {
    result += char;
    count += CJK_RE.test(char) ? 1 : 0;
    if (count >= 34 && /[，,；;、]/u.test(char)) {
      result += '\n';
      count = 0;
    }
  }
  return result;
}

function normalizeClausePunctuation(text: string, scenario: RewriteScenario): string {
  let result = text
    .replace(/[，,]{2,}/gu, '，')
    .replace(/[。]{2,}/gu, '。')
    .replace(/[？?]{2,}/gu, '？')
    .replace(/[！!]{2,}/gu, '！')
    .replace(/[；;]{2,}/gu, '；')
    .replace(/[：:]{2,}/gu, '：')
    .replace(/，([。！？!?；;])/gu, '$1')
    .replace(/、([。！？!?；;])/gu, '$1')
    .replace(/([。！？!?；;：:])([。！？!?；;：:])/gu, '$1');

  if (OFFICIAL_SCENARIOS.has(scenario)) {
    result = result.replace(/[!！]+/gu, '。').replace(/…+/gu, '。');
  }

  return result;
}

function ensureSentenceEnding(text: string, scenario: RewriteScenario): string {
  const trimmed = text.trim().replace(/[，,、；;：:]+$/u, '');
  if (!trimmed || SENTENCE_END_RE.test(trimmed)) {
    return trimmed;
  }

  if (!OFFICIAL_SCENARIOS.has(scenario) && (QUESTION_RE.test(trimmed) || QUESTION_PREFIX_RE.test(trimmed))) {
    return `${trimmed}？`;
  }

  return CJK_RE.test(trimmed) ? `${trimmed}。` : `${trimmed}.`;
}

function splitIntoSemanticSections(text: string): string[] {
  const rawLines = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const line of rawLines) {
    if (line.length <= 58) {
      pieces.push(line);
      continue;
    }
    const parts = line.split(/(?<=[。！？!?；;])/u).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      pieces.push(...parts);
    } else {
      pieces.push(line);
    }
  }

  return dedupeAdjacentSections(pieces).map((section) => ensureSentenceEnding(section, 'general'));
}

function dedupeAdjacentSections(sections: string[]): string[] {
  const kept: string[] = [];
  for (const section of sections) {
    const previous = kept[kept.length - 1];
    if (previous && similarityKey(previous) === similarityKey(section)) {
      continue;
    }
    kept.push(section);
  }
  return kept;
}

function buildStructuredText(sections: string[], scenario: RewriteScenario, fallback: string): string {
  const useful = sections.filter(Boolean);
  if (useful.length === 0) {
    return fallback;
  }

  if (MEETING_SCENARIOS.has(scenario)) {
    return buildMeetingNotes(useful);
  }
  if (NOTICE_SCENARIOS.has(scenario)) {
    return buildNotice(useful, scenario);
  }
  if (TODO_SCENARIOS.has(scenario)) {
    return buildTodoList(useful);
  }
  if (OFFICIAL_SCENARIOS.has(scenario)) {
    return buildOfficialDraft(useful, scenario);
  }
  if (WORK_REPORT_SCENARIOS.has(scenario)) {
    return buildWorkReport(useful, scenario);
  }
  if (scenario === 'business_email' || scenario === 'message_reply') {
    return buildMessageDraft(useful);
  }
  if (scenario === 'student_leave_note') {
    return buildStudentLeaveNote(useful);
  }
  if (scenario.startsWith('student_')) {
    return buildStudentDraft(useful, scenario);
  }
  if (useful.length <= 2 && fallback.length < 80) {
    return fallback;
  }
  return buildGeneralStructuredText(useful);
}

function buildMeetingNotes(sections: string[]): string {
  return [
    '一、会议主题',
    extractTitleLike(sections) || '待补充',
    '',
    '二、主要内容',
    ...numberedLines(sections),
    '',
    '三、决定事项',
    ...filterByKeywords(sections, ['决定', '确定', '通过', '同意', '要求', '明确'], '待根据会议内容补充。'),
    '',
    '四、待办事项',
    ...filterByKeywords(sections, ['负责', '完成', '推进', '落实', '提交', '下周', '明天', '之前'], '待根据会议内容补充。'),
    '',
    '五、风险提醒',
    ...filterByKeywords(sections, ['风险', '问题', '困难', '隐患', '不足', '注意'], '暂无明确风险。'),
  ].join('\n');
}

function buildWorkReport(sections: string[], scenario: RewriteScenario): string {
  const title = DOCUMENT_SCENARIO_LABELS[scenario] ?? '工作汇报';
  return [
    title,
    '',
    '一、工作进展',
    ...numberedLines(filterSections(sections, ['完成', '推进', '开展', '落实', '检查', '自查'], sections)),
    '',
    '二、存在问题',
    ...filterByKeywords(sections, ['问题', '困难', '不足', '风险', '隐患'], '暂无明确问题。'),
    '',
    '三、下一步计划',
    ...filterByKeywords(sections, ['下一步', '接下来', '计划', '继续', '准备', '安排'], '待补充。'),
    '',
    '四、需协调事项',
    ...filterByKeywords(sections, ['协调', '支持', '配合', '审批', '资源'], '暂无需协调事项。'),
  ].join('\n');
}

function buildNotice(sections: string[], scenario: RewriteScenario): string {
  const label = DOCUMENT_SCENARIO_LABELS[scenario] ?? '通知';
  return [
    `关于${extractTitleLike(sections) || '有关事项'}的${label}`,
    '',
    '通知对象：待补充',
    '',
    '一、通知事项',
    ...numberedLines(sections),
    '',
    '二、工作要求',
    ...filterByKeywords(sections, ['要求', '必须', '请', '注意', '落实', '报送'], '请相关人员按要求落实。'),
    '',
    '三、其他事项',
    '联系人、联系电话、发文机关和日期待补充。',
  ].join('\n');
}

function buildTodoList(sections: string[]): string {
  return [
    '一、待办事项',
    ...numberedLines(sections),
    '',
    '二、时间要求',
    ...filterByKeywords(sections, ['今天', '明天', '本周', '下周', '之前', '截止', '时间'], '待补充。'),
    '',
    '三、责任分工',
    ...filterByKeywords(sections, ['负责', '负责人', '部门', '人员', '我来', '你来'], '待补充。'),
  ].join('\n');
}

function buildOfficialDraft(sections: string[], scenario: RewriteScenario): string {
  const label = DOCUMENT_SCENARIO_LABELS[scenario] ?? '公文草稿';
  const bodyHeading = scenario === 'official_request'
    ? '一、请示事项'
    : scenario === 'official_reply'
      ? '一、批复意见'
      : scenario === 'official_report'
        ? '一、报告事项'
        : '一、主要内容';
  return [
    `${label}（草稿）`,
    '',
    '主送机关：待补充',
    '',
    bodyHeading,
    ...numberedLines(sections),
    '',
    '二、有关要求',
    ...filterByKeywords(sections, ['要求', '规范', '落实', '执行', '防范', '管理', '监督'], '请按相关要求抓好落实。'),
    '',
    '三、待补充要素',
    '发文机关、发文字号、成文日期、联系人及附件信息待补充。',
  ].join('\n');
}

function buildMessageDraft(sections: string[]): string {
  if (sections.length <= 2) {
    return sections.join('\n');
  }
  return [
    '您好，',
    '',
    ...sections,
    '',
    '请您参考。'
  ].join('\n');
}

function buildStudentLeaveNote(sections: string[]): string {
  return [
    '请假条',
    '',
    '尊敬的老师：',
    '',
    ...sections,
    '',
    '请假人、班级和日期待补充。'
  ].join('\n');
}

function buildStudentDraft(sections: string[], scenario: RewriteScenario): string {
  return [
    DOCUMENT_SCENARIO_LABELS[scenario] ?? '校园文稿',
    '',
    '一、主要内容',
    ...numberedLines(sections),
    '',
    '二、收获与反思',
    '待结合实际情况补充。',
    '',
    '三、下一步安排',
    ...filterByKeywords(sections, ['下一步', '计划', '继续', '改进'], '待补充。'),
  ].join('\n');
}

function buildGeneralStructuredText(sections: string[]): string {
  return [
    '一、主要内容',
    ...numberedLines(sections),
    '',
    '二、重点事项',
    ...filterByKeywords(sections, ['重点', '关键', '要求', '风险', '问题', '结论'], '以上内容请结合实际进一步确认。'),
    '',
    '三、下一步',
    ...filterByKeywords(sections, ['下一步', '接下来', '计划', '落实', '完成'], '待补充。'),
  ].join('\n');
}

function buildOutlineText(sections: string[]): string {
  return sections.map((section, index) => `${index + 1}. ${section}`).join('\n');
}

function numberedLines(sections: string[]): string[] {
  return sections.map((section, index) => `${index + 1}. ${stripLeadingStructure(section)}`);
}

function filterByKeywords(sections: string[], keywords: string[], fallback: string): string[] {
  const matched = filterSections(sections, keywords, []);
  return matched.length > 0 ? numberedLines(matched) : [fallback];
}

function filterSections(sections: string[], keywords: string[], fallback: string[]): string[] {
  const matched = sections.filter((section) => keywords.some((keyword) => section.includes(keyword)));
  return matched.length > 0 ? matched : fallback;
}

function stripLeadingStructure(text: string): string {
  return text.replace(SECTION_HEADING_RE, '').trim();
}

function extractTitleLike(sections: string[]): string | null {
  const titleSection = sections.find((section) => /(?:标题|主题|关于)/u.test(section));
  if (titleSection) {
    return stripLeadingStructure(titleSection)
      .replace(/^标题[:：]?/u, '')
      .replace(/^主题[:：]?/u, '')
      .replace(/[。！？!?]$/u, '')
      .slice(0, 36);
  }
  return sections[0]?.replace(/[。！？!?]$/u, '').slice(0, 28) || null;
}

function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const normalized = term.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result.slice(0, 60);
}
