export class StreamingSegmenter {
  private readonly minSpeechSamples: number;
  private readonly minSilenceSamples: number;
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
      maxSegmentMs?: number;
      speechThreshold?: number;
      maxLeadingChunks?: number;
    } = {}
  ) {
    this.minSpeechSamples = Math.round(this.sampleRate * ((options.minSpeechMs ?? 320) / 1000));
    this.minSilenceSamples = Math.round(this.sampleRate * ((options.minSilenceMs ?? 420) / 1000));
    this.maxSegmentSamples = Math.round(this.sampleRate * ((options.maxSegmentMs ?? 6000) / 1000));
    this.maxLeadingChunks = options.maxLeadingChunks ?? 2;
    this.speechThreshold = options.speechThreshold ?? 0.015;
  }

  push(samples: Float32Array): Float32Array[] {
    if (samples.length === 0) {
      return [];
    }

    const voiced = this.isVoiced(samples);
    const finalized: Float32Array[] = [];

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
        finalized.push(this.finishSegment());
      }
    } else {
      this.leadingChunks.push(samples);
      if (this.leadingChunks.length > this.maxLeadingChunks) {
        this.leadingChunks.shift();
      }
    }

    if (this.active && this.totalCurrentSamples() >= this.maxSegmentSamples) {
      finalized.push(this.finishSegment());
    }

    return finalized.filter((segment) => segment.length > 0);
  }

  flush(): Float32Array[] {
    if (!this.active || this.voicedSamples < this.minSpeechSamples) {
      this.reset();
      return [];
    }

    return [this.finishSegment()];
  }

  reset(): void {
    this.leadingChunks = [];
    this.currentChunks = [];
    this.active = false;
    this.voicedSamples = 0;
    this.trailingSilenceSamples = 0;
  }

  private finishSegment(): Float32Array {
    const total = this.totalCurrentSamples();
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.currentChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.reset();
    return merged;
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
