import { Settings, UiSnapshot, RuntimeStatus } from './types';
import { cleanupTranscript } from './transcript-cleanup';

export class StateMachine {
  private settings: Settings;
  private status: RuntimeStatus;
  private detail: string;
  private finalText: string;
  private recordingStartedAt: number | null;
  private waveform: number[];

  constructor(settings: Settings) {
    this.settings = settings;
    this.status = 'idle';
    this.detail = 'Ready in tray';
    this.finalText = '';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  snapshot(): UiSnapshot {
    return {
      status: this.status,
      detail: this.detail,
      final_text: this.finalText,
      elapsed_label: this.elapsedLabel(),
      waveform: this.waveform.slice(),
      settings: { ...this.settings },
    };
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  startRecording(): void {
    this.status = 'recording';
    this.detail = 'Listening...';
    this.finalText = '';
    this.recordingStartedAt = Date.now();
    this.waveform = [0.18, 0.34, 0.52, 0.8, 0.52, 0.34, 0.18];
  }

  updateWaveform(waveform: number[]): void {
    this.waveform = waveform.slice();
  }

  finishTranscription(rawText: string): string {
    const cleaned = this.cleanupTranscript(rawText);
    return this.finishOutput(cleaned);
  }

  finishOutput(text: string): string {
    const cleaned = text.trim();
    this.status = 'done';
    this.detail = 'Transcript copied to clipboard.';
    this.finalText = cleaned;
    this.recordingStartedAt = null;
    this.waveform = [];
    return cleaned;
  }

  markAutoPasteSuccess(): void {
    this.status = 'done';
    this.detail = 'Transcript pasted into the previous app.';
    this.waveform = [];
  }

  beginTranscribing(): void {
    this.status = 'transcribing';
    this.detail = 'Thinking';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  beginTranslating(): void {
    this.status = 'translating';
    this.detail = 'Translating';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  beginPolishing(): void {
    this.status = 'polishing';
    this.detail = 'Polishing';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  stopTranscribing(): void {
    this.status = 'stopped';
    this.detail = 'Stopped';
    this.finalText = '';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  applySettings(settings: Settings): void {
    this.settings = { ...settings };
  }

  dismissOverlay(): void {
    this.status = 'idle';
    this.detail = 'Ready in tray';
    this.finalText = '';
    this.recordingStartedAt = null;
    this.waveform = [];
  }

  shouldStartRecording(): boolean {
    return this.status === 'idle' || this.status === 'done';
  }

  private elapsedLabel(): string {
    if (this.recordingStartedAt === null) {
      return '';
    }
    const elapsed = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private cleanupTranscript(text: string): string {
    return cleanupTranscript(text, this.settings);
  }
}
