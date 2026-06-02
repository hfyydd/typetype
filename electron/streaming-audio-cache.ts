export interface RollingAudioCacheStats {
  totalSamples: number;
  durationSeconds: number;
  maxSamples: number;
  truncated: boolean;
}

export class RollingAudioCache {
  private chunks: Float32Array[] = [];
  private totalSamplesValue = 0;
  private truncatedValue = false;
  private readonly maxSamplesValue: number;

  constructor(
    private readonly sampleRate = 16000,
    maxSeconds = 120
  ) {
    this.maxSamplesValue = Math.max(sampleRate, Math.round(sampleRate * maxSeconds));
  }

  append(samples: Float32Array): RollingAudioCacheStats {
    if (samples.length === 0) {
      return this.stats();
    }

    if (samples.length >= this.maxSamplesValue) {
      this.chunks = [samples.slice(samples.length - this.maxSamplesValue)];
      this.totalSamplesValue = this.maxSamplesValue;
      this.truncatedValue = true;
      return this.stats();
    }

    this.chunks.push(samples.slice());
    this.totalSamplesValue += samples.length;
    this.trimToLimit();
    return this.stats();
  }

  reset(): void {
    this.chunks = [];
    this.totalSamplesValue = 0;
    this.truncatedValue = false;
  }

  getSamples(): Float32Array {
    if (this.totalSamplesValue === 0 || this.chunks.length === 0) {
      return new Float32Array();
    }

    const samples = new Float32Array(this.totalSamplesValue);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return samples;
  }

  wasTruncated(): boolean {
    return this.truncatedValue;
  }

  stats(): RollingAudioCacheStats {
    return {
      totalSamples: this.totalSamplesValue,
      durationSeconds: this.totalSamplesValue / this.sampleRate,
      maxSamples: this.maxSamplesValue,
      truncated: this.truncatedValue,
    };
  }

  private trimToLimit(): void {
    while (this.totalSamplesValue > this.maxSamplesValue && this.chunks.length > 0) {
      const overflow = this.totalSamplesValue - this.maxSamplesValue;
      const first = this.chunks[0];
      this.truncatedValue = true;

      if (first.length <= overflow) {
        this.chunks.shift();
        this.totalSamplesValue -= first.length;
        continue;
      }

      this.chunks[0] = first.slice(overflow);
      this.totalSamplesValue -= overflow;
      break;
    }
  }
}
