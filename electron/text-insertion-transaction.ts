import { clipboard } from 'electron';

import { PasteOperationResult } from './auto-paste';

export interface TextInsertionTransactionAutoPaste {
  writeClipboard(text: string): Promise<void>;
  pasteToApp(bundleId?: string | null): Promise<PasteOperationResult>;
  pasteToAppFast?(bundleId?: string | null): Promise<PasteOperationResult>;
  replaceRecentTextInApp(
    bundleId: string | null | undefined,
    replacementText: string,
    charsToReplace: number
  ): Promise<PasteOperationResult>;
}

export type TextInsertionPasteStatus = 'pasted' | 'failed';

export interface TextInsertionPasteResult {
  status: TextInsertionPasteStatus;
  insertedText: string;
  error?: string;
}

export type TextInsertionReplaceStatus =
  | 'replaced'
  | 'no_inserted_text'
  | 'target_changed'
  | 'clipboard_changed'
  | 'failed';

export interface TextInsertionReplaceResult {
  status: TextInsertionReplaceStatus;
  insertedText: string;
  charsReplaced: number;
  error?: string;
}

export class TextInsertionTransaction {
  private insertedText = '';
  private sourceText = '';
  private targetAppId: string | null = null;
  private lastClipboardText: string | null = null;

  constructor(private autoPaste: TextInsertionTransactionAutoPaste) {}

  reset(targetAppId: string | null = null): void {
    this.insertedText = '';
    this.sourceText = '';
    this.targetAppId = targetAppId;
    this.lastClipboardText = null;
  }

  setTargetApp(targetAppId: string | null): void {
    if (!this.targetAppId) {
      this.targetAppId = targetAppId;
    }
  }

  getInsertedText(): string {
    return this.insertedText;
  }

  getSourceText(): string {
    return this.sourceText;
  }

  getCharsInserted(): number {
    return Array.from(this.insertedText).length;
  }

  hasInsertedText(): boolean {
    return this.getCharsInserted() > 0;
  }

  rememberClipboardText(text: string): void {
    this.lastClipboardText = text;
  }

  async pasteAppend(text: string, sourceText: string, targetAppId: string | null): Promise<TextInsertionPasteResult> {
    return this.pasteAppendWithOptions(text, sourceText, targetAppId);
  }

  async pasteAppendWithOptions(
    text: string,
    sourceText: string,
    targetAppId: string | null,
    options: { fast?: boolean } = {}
  ): Promise<TextInsertionPasteResult> {
    if (!text) {
      return {
        status: 'pasted',
        insertedText: this.insertedText,
      };
    }

    this.setTargetApp(targetAppId);
    await this.autoPaste.writeClipboard(text);
    const canUseFastPaste = Boolean(options.fast && this.insertedText && this.autoPaste.pasteToAppFast);
    const pasteResult = canUseFastPaste
      ? await this.autoPaste.pasteToAppFast!(this.targetAppId ?? targetAppId)
      : await this.autoPaste.pasteToApp(this.targetAppId ?? targetAppId);
    if (!pasteResult.ok) {
      this.lastClipboardText = text;
      return {
        status: 'failed',
        insertedText: this.insertedText,
        error: pasteResult.error ?? '自动回填失败。',
      };
    }

    this.insertedText += text;
    this.sourceText = sourceText || this.sourceText;
    this.lastClipboardText = text;
    return {
      status: 'pasted',
      insertedText: this.insertedText,
    };
  }

  async replaceInsertedText(
    replacementText: string,
    currentTargetAppId: string | null,
    options: { respectExternalClipboardChange?: boolean } = {}
  ): Promise<TextInsertionReplaceResult> {
    const charsToReplace = this.getCharsInserted();
    if (!charsToReplace) {
      return {
        status: 'no_inserted_text',
        insertedText: this.insertedText,
        charsReplaced: 0,
      };
    }

    if (this.targetAppId && currentTargetAppId && this.targetAppId !== currentTargetAppId) {
      return {
        status: 'target_changed',
        insertedText: this.insertedText,
        charsReplaced: 0,
      };
    }

    if (options.respectExternalClipboardChange !== false && this.lastClipboardText !== null) {
      const currentClipboardText = clipboard.readText();
      if (currentClipboardText !== this.lastClipboardText && currentClipboardText !== replacementText) {
        return {
          status: 'clipboard_changed',
          insertedText: this.insertedText,
          charsReplaced: 0,
        };
      }
    }

    try {
      const replaceResult = await this.autoPaste.replaceRecentTextInApp(
        this.targetAppId ?? currentTargetAppId,
        replacementText,
        charsToReplace
      );
      if (!replaceResult.ok) {
        return {
          status: 'failed',
          insertedText: this.insertedText,
          charsReplaced: 0,
          error: replaceResult.error ?? '自动替换失败。',
        };
      }
      this.insertedText = replacementText;
      this.sourceText = replacementText;
      this.lastClipboardText = replacementText;
      return {
        status: 'replaced',
        insertedText: this.insertedText,
        charsReplaced: charsToReplace,
      };
    } catch (error) {
      return {
        status: 'failed',
        insertedText: this.insertedText,
        charsReplaced: charsToReplace,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async replaceInsertedTailText(
    replacementText: string,
    charsToReplace: number,
    currentTargetAppId: string | null,
    options: { respectExternalClipboardChange?: boolean } = {}
  ): Promise<TextInsertionReplaceResult> {
    const insertedChars = Array.from(this.insertedText);
    const safeCharsToReplace = Math.max(0, Math.min(Math.floor(charsToReplace), insertedChars.length));
    if (!safeCharsToReplace) {
      return {
        status: 'no_inserted_text',
        insertedText: this.insertedText,
        charsReplaced: 0,
      };
    }

    if (this.targetAppId && currentTargetAppId && this.targetAppId !== currentTargetAppId) {
      return {
        status: 'target_changed',
        insertedText: this.insertedText,
        charsReplaced: 0,
      };
    }

    if (options.respectExternalClipboardChange !== false && this.lastClipboardText !== null) {
      const currentClipboardText = clipboard.readText();
      if (currentClipboardText !== this.lastClipboardText && currentClipboardText !== replacementText) {
        return {
          status: 'clipboard_changed',
          insertedText: this.insertedText,
          charsReplaced: 0,
        };
      }
    }

    try {
      const replaceResult = await this.autoPaste.replaceRecentTextInApp(
        this.targetAppId ?? currentTargetAppId,
        replacementText,
        safeCharsToReplace
      );
      if (!replaceResult.ok) {
        return {
          status: 'failed',
          insertedText: this.insertedText,
          charsReplaced: 0,
          error: replaceResult.error ?? '自动替换失败。',
        };
      }

      this.insertedText = `${insertedChars.slice(0, -safeCharsToReplace).join('')}${replacementText}`;
      this.sourceText = this.insertedText;
      this.lastClipboardText = replacementText;
      return {
        status: 'replaced',
        insertedText: this.insertedText,
        charsReplaced: safeCharsToReplace,
      };
    } catch (error) {
      return {
        status: 'failed',
        insertedText: this.insertedText,
        charsReplaced: safeCharsToReplace,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
