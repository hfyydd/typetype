import {
  DictionaryEntry,
  DictionaryEntryKind,
  DictionaryEntrySource,
  DictionaryImportPreview,
  DictionaryImportPreviewItem,
  SystemLexiconEntry,
} from './types';

export const MAX_DICTIONARY_ENTRY_LENGTH = 80;
export const MAX_IMPORT_ITEMS = 5000;

export interface DictionaryCandidate {
  term: string;
  aliases?: string[];
  kind?: DictionaryEntryKind;
  replacement?: string;
  source?: DictionaryEntrySource;
  raw?: string;
}

export function normalizeDictionaryText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, '')
    .trim();
}

export function splitAliasText(value: string): string[] {
  return uniqueStrings(
    value
      .split(/[\n,，;；、]+/g)
      .map(normalizeDictionaryText)
      .filter(Boolean)
  );
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function createDictionaryEntry(candidate: DictionaryCandidate): DictionaryEntry {
  const term = normalizeDictionaryText(candidate.term);
  const aliases = uniqueStrings((candidate.aliases ?? []).map(normalizeDictionaryText).filter(Boolean));
  const kind = candidate.kind ?? (aliases.length > 0 ? 'replacement' : 'term');
  const replacement = normalizeDictionaryText(candidate.replacement || term);
  const now = new Date().toISOString();

  return {
    id: createDictionaryEntryId(),
    kind,
    term,
    aliases,
    replacement,
    enabled: true,
    source: candidate.source ?? 'manual',
    created_at: now,
    updated_at: now,
  };
}

export function sanitizeDictionaryEntry(entry: Partial<DictionaryEntry>): DictionaryEntry {
  const term = normalizeDictionaryText(entry.term ?? '');
  const aliases = uniqueStrings((entry.aliases ?? []).map(normalizeDictionaryText).filter(Boolean));
  const kind = entry.kind ?? (aliases.length > 0 ? 'replacement' : 'term');
  const now = new Date().toISOString();

  return {
    id: entry.id || createDictionaryEntryId(),
    kind,
    term,
    aliases,
    replacement: normalizeDictionaryText(entry.replacement || term),
    enabled: entry.enabled ?? true,
    source: entry.source ?? 'manual',
    created_at: entry.created_at || now,
    updated_at: now,
  };
}

export function validateDictionaryEntry(entry: Pick<DictionaryEntry, 'term' | 'aliases' | 'kind'>): { ok: boolean; reason?: string; tooLong?: boolean } {
  if (!entry.term) {
    return { ok: false, reason: '缺少正确词' };
  }

  if (entry.term.length > MAX_DICTIONARY_ENTRY_LENGTH) {
    return { ok: false, reason: '正确词超过 80 个字符', tooLong: true };
  }

  const tooLongAlias = (entry.aliases ?? []).find((alias) => alias.length > MAX_DICTIONARY_ENTRY_LENGTH);
  if (tooLongAlias) {
    return { ok: false, reason: `可能识别错的词超过 80 个字符：${tooLongAlias}`, tooLong: true };
  }

  if (entry.kind === 'replacement' && (entry.aliases ?? []).length === 0) {
    return { ok: false, reason: '纠错词需要至少填写一个可能识别错的词' };
  }

  return { ok: true };
}

export function applyDictionaryReplacements(
  text: string,
  entries: DictionaryEntry[],
  options: { partial?: boolean } = {}
): string {
  if (!text || entries.length === 0) {
    return text;
  }

  const rules = entries
    .filter((entry) => entry.enabled && entry.kind === 'replacement')
    .flatMap((entry) => {
      const replacement = entry.replacement || entry.term;
      return entry.aliases
        .filter((alias) => alias && alias !== replacement)
        .map((alias) => ({ from: alias, to: replacement }));
    })
    .filter((rule) => !options.partial || rule.from.length >= 2)
    .sort((a, b) => b.from.length - a.from.length);

  let result = text;
  for (const rule of rules) {
    result = result.split(rule.from).join(rule.to);
  }

  return result;
}

export function findMatchedDictionaryTerms(
  text: string,
  userEntries: DictionaryEntry[],
  systemEntries: SystemLexiconEntry[],
  limit = 50
): string[] {
  if (!text) {
    return [];
  }

  const candidates = [
    ...userEntries
      .filter((entry) => entry.enabled)
      .flatMap((entry) => [entry.term, entry.replacement, ...entry.aliases]),
    ...systemEntries.map((entry) => entry.term),
  ];

  return uniqueStrings(candidates)
    .filter((term) => term && text.includes(term))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

export function buildImportPreview(
  candidates: DictionaryCandidate[],
  existingEntries: DictionaryEntry[],
  sourceName: string
): DictionaryImportPreview {
  const warnings: string[] = [];
  const items: DictionaryImportPreviewItem[] = [];
  const seenKeys = new Set<string>();
  const existingByKey = new Map(existingEntries.map((entry) => [entryKey(entry), entry]));

  const limitedCandidates = candidates.slice(0, MAX_IMPORT_ITEMS);
  if (candidates.length > MAX_IMPORT_ITEMS) {
    warnings.push(`单次最多导入 ${MAX_IMPORT_ITEMS} 条，已截断后续 ${candidates.length - MAX_IMPORT_ITEMS} 条。`);
  }

  for (const candidate of limitedCandidates) {
    const raw = candidate.raw || candidate.term;
    const entry = createDictionaryEntry({
      ...candidate,
      source: 'import',
    });
    const validation = validateDictionaryEntry(entry);

    if (!validation.ok) {
      items.push({
        status: validation.tooLong ? 'too_long' : 'invalid',
        raw,
        reason: validation.reason,
      });
      continue;
    }

    const key = entryKey(entry);
    if (seenKeys.has(key)) {
      items.push({
        status: 'duplicate',
        raw,
        entry,
        reason: '导入内容中已有相同条目',
      });
      continue;
    }
    seenKeys.add(key);

    const existing = existingByKey.get(key);
    if (existing) {
      items.push({
        status: entriesEqual(existing, entry) ? 'duplicate' : 'update',
        raw,
        entry,
        existing_id: existing.id,
        reason: entriesEqual(existing, entry) ? '词典中已有相同条目' : '将更新现有条目',
      });
      continue;
    }

    items.push({
      status: 'add',
      raw,
      entry,
    });
  }

  const summary = {
    added: items.filter((item) => item.status === 'add').length,
    updated: items.filter((item) => item.status === 'update').length,
    duplicate: items.filter((item) => item.status === 'duplicate').length,
    invalid: items.filter((item) => item.status === 'invalid').length,
    too_long: items.filter((item) => item.status === 'too_long').length,
    terms: items.filter((item) => item.entry?.kind === 'term' && (item.status === 'add' || item.status === 'update')).length,
    replacements: items.filter((item) => item.entry?.kind === 'replacement' && (item.status === 'add' || item.status === 'update')).length,
  };

  return {
    source_name: sourceName,
    items,
    warnings,
    summary,
  };
}

export function entryKey(entry: Pick<DictionaryEntry, 'kind' | 'term' | 'aliases' | 'replacement'>): string {
  const term = normalizeDictionaryText(entry.term).toLocaleLowerCase();
  if (entry.kind === 'term') {
    return `term:${term}`;
  }

  const aliases = uniqueStrings((entry.aliases ?? []).map(normalizeDictionaryText))
    .map((alias) => alias.toLocaleLowerCase())
    .sort()
    .join('|');
  const replacement = normalizeDictionaryText(entry.replacement || entry.term).toLocaleLowerCase();
  return `replacement:${replacement}:${aliases}`;
}

function entriesEqual(a: DictionaryEntry, b: DictionaryEntry): boolean {
  return entryKey(a) === entryKey(b) && a.enabled === b.enabled;
}

function createDictionaryEntryId(): string {
  return `dict_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
