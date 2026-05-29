import * as fs from 'fs';
import * as path from 'path';
import {
  DictionaryEntry,
  DictionaryImportPreview,
  DictionaryStats,
  DictionaryViewData,
  SystemLexiconEntry,
} from './types';
import { extractAutoLearnedTerms } from './auto-learning';
import {
  applyDictionaryReplacements,
  entryKey,
  findMatchedDictionaryTerms,
  sanitizeDictionaryEntry,
  validateDictionaryEntry,
} from './dictionary-engine';

interface DictionaryStoreOptions {
  dataDir: string;
  resourcesPath: string;
  legacyCustomDictionary?: Array<{ from: string; to: string }>;
}

interface PersistedDictionaryFile {
  version: 1;
  entries: DictionaryEntry[];
  system_lexicon_enabled?: boolean;
  disabled_system_categories?: string[];
}

export class DictionaryStore {
  private dataDir: string;
  private resourcesPath: string;
  private dictionaryPath: string;
  private systemLexiconPath: string;
  private entries: DictionaryEntry[] = [];
  private systemLexicon: SystemLexiconEntry[] = [];
  private systemLexiconEnabled = true;
  private disabledSystemCategories = new Set<string>();

  constructor(options: DictionaryStoreOptions) {
    this.dataDir = options.dataDir;
    this.resourcesPath = options.resourcesPath;
    this.dictionaryPath = path.join(this.dataDir, 'dictionary.json');
    this.systemLexiconPath = path.join(this.resourcesPath, 'lexicons', 'system-lexicon.json');
    this.systemLexicon = this.loadSystemLexicon();
    this.loadPersistedDictionary();
    this.migrateLegacyCustomDictionary(options.legacyCustomDictionary ?? []);
  }

  getDictionaryPath(): string {
    return this.dictionaryPath;
  }

  getEntries(): DictionaryEntry[] {
    return this.entries.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
  }

  getSystemLexicon(): SystemLexiconEntry[] {
    return this.systemLexicon.map((entry) => ({ ...entry }));
  }

  getViewData(): DictionaryViewData {
    return {
      entries: this.getEntries(),
      dictionary_path: this.dictionaryPath,
      system_lexicon_count: this.systemLexicon.length,
      system_lexicon_enabled: this.systemLexiconEnabled,
      system_categories: this.getSystemCategories(),
      stats: this.getStats(),
    };
  }

  setSystemLexiconEnabled(enabled: boolean): DictionaryViewData {
    this.systemLexiconEnabled = enabled;
    this.saveUserEntries();
    return this.getViewData();
  }

  setSystemCategoryEnabled(category: string, enabled: boolean): DictionaryViewData {
    if (enabled) {
      this.disabledSystemCategories.delete(category);
    } else {
      this.disabledSystemCategories.add(category);
    }

    this.saveUserEntries();
    return this.getViewData();
  }

  saveEntry(input: Partial<DictionaryEntry>): DictionaryEntry {
    const entry = sanitizeDictionaryEntry(input);
    const validation = validateDictionaryEntry(entry);
    if (!validation.ok) {
      throw new Error(validation.reason || '词条无效');
    }

    const index = this.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      this.entries[index] = {
        ...entry,
        created_at: this.entries[index].created_at,
        updated_at: new Date().toISOString(),
      };
    } else {
      this.entries.push(entry);
    }

    this.saveUserEntries();
    return entry;
  }

  deleteEntry(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.saveUserEntries();
  }

  setEntryEnabled(id: string, enabled: boolean): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error('没有找到该词条');
    }
    entry.enabled = enabled;
    entry.updated_at = new Date().toISOString();
    this.saveUserEntries();
  }

  promoteAutoLearnedEntry(id: string): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error('没有找到该词条');
    }
    entry.source = 'manual';
    entry.updated_at = new Date().toISOString();
    this.saveUserEntries();
  }

  autoLearnFromText(text: string, enabled: boolean): { learned: number; terms: string[] } {
    if (!enabled) {
      return { learned: 0, terms: [] };
    }

    const now = new Date().toISOString();
    const learnedTerms: string[] = [];
    const existingByTerm = new Map(
      this.entries.map((entry) => [entry.term.toLocaleLowerCase(), entry])
    );

    const protectedEntries = this.entries.filter((entry) => entry.source !== 'auto_learned');
    for (const candidate of extractAutoLearnedTerms(text, protectedEntries)) {
      const key = candidate.term.toLocaleLowerCase();
      const existing = existingByTerm.get(key);
      if (existing) {
        if (existing.source === 'auto_learned') {
          existing.learned_count = (existing.learned_count ?? 0) + 1;
          existing.last_learned_at = now;
          existing.updated_at = now;
          learnedTerms.push(existing.term);
        }
        continue;
      }

      const entry = sanitizeDictionaryEntry({
        kind: 'term',
        term: candidate.term,
        replacement: candidate.term,
        aliases: [],
        enabled: true,
        source: 'auto_learned',
        learned_count: 1,
        last_learned_at: now,
      });
      if (!validateDictionaryEntry(entry).ok) {
        continue;
      }
      this.entries.push(entry);
      existingByTerm.set(key, entry);
      learnedTerms.push(entry.term);
    }

    if (learnedTerms.length > 0) {
      this.saveUserEntries();
    }

    return { learned: learnedTerms.length, terms: learnedTerms };
  }

  commitImportPreview(preview: DictionaryImportPreview): DictionaryViewData {
    const existingById = new Map(this.entries.map((entry) => [entry.id, entry]));
    const existingByKey = new Map(this.entries.map((entry) => [entryKey(entry), entry]));
    const now = new Date().toISOString();

    for (const item of preview.items) {
      if (!item.entry || (item.status !== 'add' && item.status !== 'update')) {
        continue;
      }

      const entry = sanitizeDictionaryEntry({
        ...item.entry,
        source: 'import',
        enabled: true,
      });

      if (item.existing_id && existingById.has(item.existing_id)) {
        const target = existingById.get(item.existing_id)!;
        Object.assign(target, {
          ...entry,
          id: target.id,
          created_at: target.created_at,
          updated_at: now,
        });
        existingByKey.set(entryKey(target), target);
        continue;
      }

      const sameKey = existingByKey.get(entryKey(entry));
      if (sameKey) {
        continue;
      }

      this.entries.push(entry);
      existingByKey.set(entryKey(entry), entry);
    }

    this.saveUserEntries();
    return this.getViewData();
  }

  exportTo(filePath: string): void {
    const data: PersistedDictionaryFile = {
      version: 1,
      entries: this.entries,
      system_lexicon_enabled: this.systemLexiconEnabled,
      disabled_system_categories: Array.from(this.disabledSystemCategories).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  applyToText(text: string, options: { partial?: boolean } = {}): string {
    return applyDictionaryReplacements(text, this.entries, options);
  }

  getMatchedTerms(text: string, limit = 50): string[] {
    return findMatchedDictionaryTerms(text, this.entries, this.getEnabledSystemLexicon(), limit);
  }

  private loadPersistedDictionary(): void {
    try {
      if (!fs.existsSync(this.dictionaryPath)) {
        this.entries = [];
        this.systemLexiconEnabled = true;
        this.disabledSystemCategories = new Set();
        return;
      }

      const parsed = JSON.parse(fs.readFileSync(this.dictionaryPath, 'utf-8')) as Partial<PersistedDictionaryFile>;
      this.entries = (parsed.entries ?? [])
        .map((entry) => sanitizeDictionaryEntry(entry))
        .filter((entry) => validateDictionaryEntry(entry).ok);
      this.systemLexiconEnabled = parsed.system_lexicon_enabled ?? true;
      this.disabledSystemCategories = new Set(parsed.disabled_system_categories ?? []);
    } catch (error) {
      console.error('Failed to load dictionary:', error);
      this.entries = [];
      this.systemLexiconEnabled = true;
      this.disabledSystemCategories = new Set();
    }
  }

  private saveUserEntries(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const data: PersistedDictionaryFile = {
      version: 1,
      entries: this.entries,
      system_lexicon_enabled: this.systemLexiconEnabled,
      disabled_system_categories: Array.from(this.disabledSystemCategories).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    };
    fs.writeFileSync(this.dictionaryPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private loadSystemLexicon(): SystemLexiconEntry[] {
    try {
      if (!fs.existsSync(this.systemLexiconPath)) {
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(this.systemLexiconPath, 'utf-8')) as SystemLexiconEntry[];
      return parsed
        .filter((entry) => entry.term && entry.category)
        .map((entry) => ({
          term: entry.term,
          category: entry.category,
          source: entry.source || 'manual',
          weight: entry.weight ?? 1,
        }));
    } catch (error) {
      console.error('Failed to load system lexicon:', error);
      return [];
    }
  }

  private migrateLegacyCustomDictionary(legacyEntries: Array<{ from: string; to: string }>): void {
    if (!legacyEntries.length) {
      return;
    }

    const existingKeys = new Set(this.entries.map((entry) => entryKey(entry)));
    let changed = false;
    for (const legacy of legacyEntries) {
      const entry = sanitizeDictionaryEntry({
        kind: 'replacement',
        term: legacy.to,
        replacement: legacy.to,
        aliases: [legacy.from],
        enabled: true,
        source: 'legacy',
      });
      if (!validateDictionaryEntry(entry).ok || existingKeys.has(entryKey(entry))) {
        continue;
      }
      existingKeys.add(entryKey(entry));
      this.entries.push(entry);
      changed = true;
    }

    if (changed) {
      this.saveUserEntries();
    }
  }

  private getStats(): DictionaryStats {
    return {
      total: this.entries.length,
      enabled: this.entries.filter((entry) => entry.enabled).length,
      terms: this.entries.filter((entry) => entry.kind === 'term').length,
      replacements: this.entries.filter((entry) => entry.kind === 'replacement').length,
      auto_learned: this.entries.filter((entry) => entry.source === 'auto_learned').length,
      last_auto_learned_at: this.entries
        .filter((entry) => entry.source === 'auto_learned' && entry.last_learned_at)
        .map((entry) => entry.last_learned_at!)
        .sort()
        .at(-1) ?? null,
      system_terms: this.systemLexicon.length,
      system_enabled_terms: this.getEnabledSystemLexicon().length,
    };
  }

  private getSystemCategories(): Array<{ category: string; count: number; enabled: boolean }> {
    const counts = new Map<string, number>();
    for (const entry of this.systemLexicon) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([category, count]) => ({
        category,
        count,
        enabled: !this.disabledSystemCategories.has(category),
      }))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-CN'));
  }

  private getEnabledSystemLexicon(): SystemLexiconEntry[] {
    if (!this.systemLexiconEnabled) {
      return [];
    }

    return this.systemLexicon.filter((entry) => !this.disabledSystemCategories.has(entry.category));
  }
}
