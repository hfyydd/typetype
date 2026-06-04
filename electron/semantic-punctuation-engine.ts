import { CodeSwitchLexicon } from './code-switch-lexicon';
import {
  LocalPunctuationEngine,
  LocalPunctuationRestoreResult,
} from './local-punctuation-engine';

export interface SemanticPunctuationRestoreOptions {
  final?: boolean;
  preserveTerms?: string[];
}

export class SemanticPunctuationEngine {
  constructor(
    private localPunctuationEngine: LocalPunctuationEngine,
    private codeSwitchLexicon: CodeSwitchLexicon
  ) {}

  async restorePunctuation(
    rawText: string,
    options: SemanticPunctuationRestoreOptions = {}
  ): Promise<LocalPunctuationRestoreResult> {
    const preserveTerms = [
      ...(options.preserveTerms ?? []),
      ...this.codeSwitchLexicon.getMatchedTerms(rawText, 80),
    ];

    return this.localPunctuationEngine.restorePunctuation(rawText, {
      final: options.final,
      preserveTerms,
    });
  }
}
