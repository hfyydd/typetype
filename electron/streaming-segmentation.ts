export type StreamingPauseReason = 'soft_pause' | 'hard_pause' | 'max_segment' | 'final';

export interface StreamingSegmentEvent {
  audio: Float32Array;
  pauseMs: number;
  reason: StreamingPauseReason;
}

export class StreamingSegmenter {
  private readonly minSpeechSamples: number;
  private readonly minSilenceSamples: number;
  private readonly hardSilenceSamples: number;
  private readonly maxSegmentSamples: number;
  private readonly maxLeadingChunks: number;
  private readonly speechThreshold: number;
  private leadingChunks: Float32Array[] = [];
  private currentChunks: Float32Array[] = [];
  private active = false;
  private voicedSamples = 0;
  private trailingSilenceSamples = 0;

  constructor(
    private readonly sampleRate: number = 16000,
    options: {
      minSpeechMs?: number;
      minSilenceMs?: number;
      hardSilenceMs?: number;
      maxSegmentMs?: number;
      speechThreshold?: number;
      maxLeadingChunks?: number;
    } = {}
  ) {
    this.minSpeechSamples = Math.round(this.sampleRate * ((options.minSpeechMs ?? 320) / 1000));
    this.minSilenceSamples = Math.round(this.sampleRate * ((options.minSilenceMs ?? 420) / 1000));
    this.hardSilenceSamples = Math.round(this.sampleRate * ((options.hardSilenceMs ?? 700) / 1000));
    this.maxSegmentSamples = Math.round(this.sampleRate * ((options.maxSegmentMs ?? 6000) / 1000));
    this.maxLeadingChunks = options.maxLeadingChunks ?? 2;
    this.speechThreshold = options.speechThreshold ?? 0.015;
  }

  push(samples: Float32Array): StreamingSegmentEvent[] {
    if (samples.length === 0) {
      return [];
    }

    const voiced = this.isVoiced(samples);
    const finalized: StreamingSegmentEvent[] = [];

    if (voiced) {
      if (!this.active) {
        this.active = true;
        this.currentChunks = this.leadingChunks.slice();
        this.leadingChunks = [];
        this.voicedSamples = 0;
        this.trailingSilenceSamples = 0;
      }

      this.currentChunks.push(samples);
      this.voicedSamples += samples.length;
      this.trailingSilenceSamples = 0;
    } else if (this.active) {
      this.currentChunks.push(samples);
      this.trailingSilenceSamples += samples.length;

      if (
        this.voicedSamples >= this.minSpeechSamples &&
        this.trailingSilenceSamples >= this.minSilenceSamples
      ) {
        finalized.push(this.finishSegment(
          this.trailingSilenceSamples >= this.hardSilenceSamples ? 'hard_pause' : 'soft_pause',
          this.trailingSilenceSamples
        ));
      }
    } else {
      this.leadingChunks.push(samples);
      if (this.leadingChunks.length > this.maxLeadingChunks) {
        this.leadingChunks.shift();
      }
    }

    if (this.active && this.totalCurrentSamples() >= this.maxSegmentSamples) {
      finalized.push(this.finishSegment('max_segment', this.trailingSilenceSamples));
    }

    return finalized.filter((segment) => segment.audio.length > 0);
  }

  flush(): StreamingSegmentEvent[] {
    if (!this.active || this.voicedSamples < this.minSpeechSamples) {
      this.reset();
      return [];
    }

    return [this.finishSegment('final', this.trailingSilenceSamples)];
  }

  reset(): void {
    this.leadingChunks = [];
    this.currentChunks = [];
    this.active = false;
    this.voicedSamples = 0;
    this.trailingSilenceSamples = 0;
  }

  private finishSegment(reason: StreamingPauseReason, pauseSamples: number): StreamingSegmentEvent {
    const total = this.totalCurrentSamples();
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.currentChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.reset();
    return {
      audio: merged,
      pauseMs: Math.round((pauseSamples / this.sampleRate) * 1000),
      reason,
    };
  }

  private totalCurrentSamples(): number {
    return this.currentChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  private isVoiced(samples: Float32Array): boolean {
    let energy = 0;
    for (const sample of samples) {
      energy += sample * sample;
    }

    const rms = Math.sqrt(energy / samples.length);
    return rms >= this.speechThreshold;
  }
}
