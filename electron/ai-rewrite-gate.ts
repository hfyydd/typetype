import { CodeSwitchAnalysis } from './code-switch-lexicon';
import { RewriteScenario, Settings } from './types';

export interface AiRewriteGateInput {
  text: string;
  settings: Settings;
  codeSwitch?: CodeSwitchAnalysis;
  final?: boolean;
}

export interface AiRewriteGateDecision {
  shouldRun: boolean;
  reasons: string[];
}

const FORMAL_SCENARIOS = new Set<RewriteScenario>([
  'meeting_notes',
  'work_report',
  'customer_service',
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
  'business_notice',
  'business_plan',
  'business_summary',
  'business_proposal',
  'business_email',
  'business_memo',
  'business_application',
  'business_meeting_minutes',
]);

const UNSTABLE_PUNCTUATION_RE = /[，,、；;：:]{2,}|[。！？!?][。！？!?]+|[，,、；;：:]$/u;
const LONG_TEXT_CHARS = 80;

export class AiRewriteGate {
  decide(input: AiRewriteGateInput): AiRewriteGateDecision {
    const text = input.text.trim();
    const settings = input.settings;
    const reasons: string[] = [];

    if (!settings.llm_rewrite?.enabled || !settings.llm_rewrite.api_key?.trim()) {
      return { shouldRun: false, reasons: ['llm_disabled'] };
    }

    if (!text) {
      return { shouldRun: false, reasons: ['empty_text'] };
    }

    if (text.length >= LONG_TEXT_CHARS) {
      reasons.push('long_text');
    }

    if (FORMAL_SCENARIOS.has(settings.rewrite_scenario)) {
      reasons.push('formal_scenario');
    }

    if (input.codeSwitch?.suspectedAliasCount) {
      reasons.push('suspected_code_switch_alias');
    }

    if ((input.codeSwitch?.highRiskCount ?? 0) >= 2) {
      reasons.push('multiple_high_risk_code_switch_terms');
    }

    if (UNSTABLE_PUNCTUATION_RE.test(text) || weakSentenceBoundaryCount(text) >= 2) {
      reasons.push('unstable_punctuation');
    }

    if (settings.voice_formatting_enabled && /[\n]|第[一二三四五六七八九十]|首先|其次|最后|待办|总结/u.test(text)) {
      reasons.push('structured_voice_formatting');
    }

    if (input.final && text.length >= 36 && (input.codeSwitch?.mixedTermCount ?? 0) >= 2) {
      reasons.push('final_mixed_speech');
    }

    return {
      shouldRun: reasons.length > 0,
      reasons,
    };
  }
}

function weakSentenceBoundaryCount(text: string): number {
  const punctuationCount = (text.match(/[。！？!?；;\n]/gu) ?? []).length;
  if (punctuationCount > 0) {
    return 0;
  }
  const cjkCount = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  return Math.floor(cjkCount / 38);
}
