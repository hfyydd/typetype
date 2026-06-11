import * as fs from 'fs';
import * as path from 'path';

export type CodeSwitchRisk = 'low' | 'medium' | 'high';

export interface CodeSwitchLexiconEntry {
  term: string;
  aliases: string[];
  category: string;
  regions?: string[];
  tags?: string[];
  risk?: CodeSwitchRisk;
  false_positive_context?: string[];
  context_keywords?: string[];
}

export interface CodeSwitchLexiconFile {
  version: 1;
  entries: CodeSwitchLexiconEntry[];
}

export interface CodeSwitchApplyOptions {
  partial?: boolean;
}

export interface CodeSwitchApplyResult {
  text: string;
  matchedTerms: string[];
  replacementCount: number;
  highRiskCount: number;
}

export interface CodeSwitchAnalysis {
  matchedTerms: string[];
  mixedTermCount: number;
  suspectedAliasCount: number;
  highRiskCount: number;
}

interface NormalizedAlias {
  alias: string;
  entry: CodeSwitchLexiconEntry;
}

const LEXICON_RELATIVE_PATH = path.join('lexicons', 'code-switch-lexicon.json');
const CJK_RE = /[\u3400-\u9fff]/u;
const LATIN_RE = /[A-Za-z0-9]/u;

export class CodeSwitchLexicon {
  private entries: CodeSwitchLexiconEntry[] = [];
  private aliases: NormalizedAlias[] = [];
  private aliasBuckets = new Map<string, NormalizedAlias[]>();

  constructor(options: { resourcesPath: string; dataDir?: string }) {
    this.entries = this.loadEntries(options);
    this.aliases = this.buildAliasIndex(this.entries);
    this.aliasBuckets = this.buildAliasBuckets(this.aliases);
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  getHotwordTerms(limit = 5000): string[] {
    return this.entries
      .filter((entry) => shouldPreferAsrHotword(entry.term, entry.risk))
      .sort((a, b) => scoreAsrHotword(b) - scoreAsrHotword(a) || a.term.localeCompare(b.term, 'zh-CN'))
      .slice(0, limit)
      .map((entry) => entry.term);
  }

  applyToText(text: string, options: CodeSwitchApplyOptions = {}): CodeSwitchApplyResult {
    if (!text.trim() || this.aliases.length === 0) {
      return {
        text,
        matchedTerms: this.getMatchedTerms(text),
        replacementCount: 0,
        highRiskCount: 0,
      };
    }

    let result = text;
    const matchedTerms = new Set<string>();
    let replacementCount = 0;
    let highRiskCount = 0;

    for (const { alias, entry } of this.getCandidateAliases(result)) {
      if (!result.includes(alias) || alias === entry.term) {
        continue;
      }

      const pattern = new RegExp(escapeRegExp(alias), LATIN_RE.test(alias) ? 'giu' : 'gu');
      result = result.replace(pattern, (match, offset: number, fullText: string) => {
        if (!this.shouldReplaceAlias(fullText, offset, match, entry, options)) {
          return match;
        }
        matchedTerms.add(entry.term);
        replacementCount += 1;
        if ((entry.risk ?? 'medium') === 'high') {
          highRiskCount += 1;
        }
        return entry.term;
      });
    }

    const textWithSpacing = normalizeMixedSpacing(result);
    for (const term of this.getMatchedTerms(textWithSpacing)) {
      matchedTerms.add(term);
    }

    return {
      text: textWithSpacing,
      matchedTerms: Array.from(matchedTerms).slice(0, 80),
      replacementCount,
      highRiskCount,
    };
  }

  getMatchedTerms(text: string, limit = 60): string[] {
    if (!text.trim()) {
      return [];
    }

    const matched = new Set<string>();
    for (const entry of this.entries) {
      if (matched.size >= limit) {
        break;
      }
      if (text.includes(entry.term)) {
        matched.add(entry.term);
        continue;
      }
      for (const alias of entry.aliases) {
        if (alias && text.includes(alias)) {
          matched.add(entry.term);
          break;
        }
      }
    }
    return Array.from(matched);
  }

  analyzeText(text: string): CodeSwitchAnalysis {
    if (!text.trim()) {
      return {
        matchedTerms: [],
        mixedTermCount: 0,
        suspectedAliasCount: 0,
        highRiskCount: 0,
      };
    }

    const matchedTerms = new Set<string>();
    let suspectedAliasCount = 0;
    let highRiskCount = 0;

    for (const entry of this.entries) {
      const risk = entry.risk ?? 'medium';
      if (text.includes(entry.term)) {
        matchedTerms.add(entry.term);
      }
      for (const alias of entry.aliases) {
        if (alias !== entry.term && alias && text.includes(alias)) {
          suspectedAliasCount += 1;
          matchedTerms.add(entry.term);
          if (risk === 'high') {
            highRiskCount += 1;
          }
        }
      }
    }

    return {
      matchedTerms: Array.from(matchedTerms).slice(0, 80),
      mixedTermCount: matchedTerms.size,
      suspectedAliasCount,
      highRiskCount,
    };
  }

  private loadEntries(options: { resourcesPath: string; dataDir?: string }): CodeSwitchLexiconEntry[] {
    const paths = [
      path.join(options.resourcesPath, LEXICON_RELATIVE_PATH),
      options.dataDir ? path.join(options.dataDir, LEXICON_RELATIVE_PATH) : null,
    ].filter((value): value is string => Boolean(value));

    const entries: CodeSwitchLexiconEntry[] = [];
    for (const lexiconPath of paths) {
      try {
        if (!fs.existsSync(lexiconPath)) {
          continue;
        }
        const parsed = JSON.parse(fs.readFileSync(lexiconPath, 'utf-8')) as Partial<CodeSwitchLexiconFile>;
        entries.push(...(parsed.entries ?? []).filter(isValidEntry));
      } catch (error) {
        console.warn('[code-switch] failed to load lexicon', {
          path: lexiconPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return dedupeEntries(entries);
  }

  private buildAliasIndex(entries: CodeSwitchLexiconEntry[]): NormalizedAlias[] {
    return entries
      .flatMap((entry) => {
        const aliases = entry.aliases.flatMap((alias) => {
          const trimmed = alias.trim();
          if (!LATIN_RE.test(trimmed)) {
            return [trimmed];
          }
          return [trimmed, trimmed.toLocaleLowerCase(), trimmed.toLocaleUpperCase()];
        });
        return dedupe(aliases).map((alias) => ({ alias, entry }));
      })
      .filter((item) => item.alias.length >= 2)
      .filter((item) => {
        const alias = item.alias.toLocaleLowerCase();
        const term = item.entry.term.toLocaleLowerCase();
        return alias === term || !alias.includes(term);
      })
      .sort((a, b) => b.alias.length - a.alias.length || b.entry.term.length - a.entry.term.length);
  }

  private buildAliasBuckets(aliases: NormalizedAlias[]): Map<string, NormalizedAlias[]> {
    const buckets = new Map<string, NormalizedAlias[]>();
    for (const alias of aliases) {
      const first = Array.from(alias.alias)[0] ?? '';
      if (!first) {
        continue;
      }
      const bucket = buckets.get(first) ?? [];
      bucket.push(alias);
      buckets.set(first, bucket);
    }
    return buckets;
  }

  private getCandidateAliases(text: string): NormalizedAlias[] {
    const seen = new Set<NormalizedAlias>();
    const result: NormalizedAlias[] = [];
    for (const char of new Set(Array.from(text))) {
      const bucket = this.aliasBuckets.get(char);
      if (!bucket) {
        continue;
      }
      for (const alias of bucket) {
        if (seen.has(alias)) {
          continue;
        }
        seen.add(alias);
        result.push(alias);
      }
    }
    return result.sort((a, b) => b.alias.length - a.alias.length || b.entry.term.length - a.entry.term.length);
  }

  private shouldReplaceAlias(
    text: string,
    offset: number,
    alias: string,
    entry: CodeSwitchLexiconEntry,
    options: CodeSwitchApplyOptions
  ): boolean {
    const risk = entry.risk ?? 'medium';
    const before = text.slice(Math.max(0, offset - 16), offset);
    const after = text.slice(offset + alias.length, offset + alias.length + 16);
    const context = `${before}${after}`;

    if (entry.false_positive_context?.some((item) => item && context.includes(item))) {
      return false;
    }

    if (risk === 'high') {
      const hasContext = entry.context_keywords?.some((keyword) => context.includes(keyword)) ?? false;
      const hasMixedContext = LATIN_RE.test(context) || /项目|产品|会议|代码|合并|上线|设计|客户|接口|需求|排期/u.test(context);
      if (!hasContext && !hasMixedContext) {
        return false;
      }
    }

    if (options.partial && risk === 'high' && alias.length <= 2) {
      return false;
    }

    return true;
  }
}

function isValidEntry(entry: CodeSwitchLexiconEntry): boolean {
  return Boolean(entry?.term?.trim() && Array.isArray(entry.aliases) && entry.aliases.length > 0);
}

function dedupeEntries(entries: CodeSwitchLexiconEntry[]): CodeSwitchLexiconEntry[] {
  const byTerm = new Map<string, CodeSwitchLexiconEntry>();
  for (const entry of entries) {
    const term = entry.term.trim();
    const existing = byTerm.get(term);
    if (!existing) {
      byTerm.set(term, {
        ...entry,
        term,
        aliases: dedupe([term, ...entry.aliases]),
      });
      continue;
    }
    existing.aliases = dedupe([...existing.aliases, ...entry.aliases, term]);
    existing.context_keywords = dedupe([...(existing.context_keywords ?? []), ...(entry.context_keywords ?? [])]);
    existing.false_positive_context = dedupe([...(existing.false_positive_context ?? []), ...(entry.false_positive_context ?? [])]);
  }
  return Array.from(byTerm.values()).sort((a, b) => a.term.localeCompare(b.term, 'en'));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeMixedSpacing(text: string): string {
  return text
    .replace(new RegExp(`(${CJK_RE.source})([A-Za-z][A-Za-z0-9.+#/_-]*)`, 'gu'), '$1 $2')
    .replace(new RegExp(`([A-Za-z0-9.+#/_-]+)(${CJK_RE.source})`, 'gu'), '$1 $2')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\s+([，。！？；：、])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldPreferAsrHotword(term: string, risk: CodeSwitchRisk = 'medium'): boolean {
  if (risk === 'high' && term.length <= 3) {
    return false;
  }
  return /[A-Za-z0-9]|狱|侦|监|押|犯|刑|法|警|检|诉|审|政法|公安|法院|检察|看守|拘留|矫正/u.test(term);
}

function scoreAsrHotword(entry: CodeSwitchLexiconEntry): number {
  let score = 0;
  if (/[A-Za-z]/.test(entry.term)) score += 8;
  if (/\d/.test(entry.term)) score += 4;
  if (/狱|侦|监|押|犯|刑|法|警|检|诉|审|政法|公安|法院|检察|看守|拘留|矫正/u.test(entry.term)) score += 9;
  if ((entry.tags ?? []).some((tag) => ['ai', 'china-ai', 'law-enforcement', 'justice', 'prison'].includes(tag))) {
    score += 5;
  }
  if (entry.risk === 'low') score += 2;
  if (entry.term.length > 32) score -= 3;
  return score;
}
