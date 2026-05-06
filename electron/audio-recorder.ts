import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface AudioChunk {
  samples: Float32Array;
}

export function buildSoxInputArgs(microphoneId: string | null): string[] {
  return ['-t', 'coreaudio', microphoneId || 'default'];
}

export class AudioRecorder {
  private process: ChildProcess | null = null;
  private recordingsDir: string;
  private microphoneId: string | null;
  private currentFile: string | null = null;
  private onWaveform: ((waveform: number[]) => void) | null = null;
  private onSamples: ((samples: Float32Array) => void) | null = null;
  private sampleRate = 16000;
  private isRecording = false;
  private audioBuffer: Buffer[] = [];

  constructor(recordingsDir: string, microphoneId: string | null = null) {
    this.recordingsDir = recordingsDir;
    this.microphoneId = microphoneId;
    fs.mkdirSync(this.recordingsDir, { recursive: true });
  }

  setWaveformCallback(callback: (waveform: number[]) => void): void {
    this.onWaveform = callback;
  }

  setSamplesCallback(callback: (samples: Float32Array) => void): void {
    this.onSamples = callback;
  }

  start(): string {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.audioBuffer = [];
    const timestamp = Date.now();
    this.currentFile = path.join(this.recordingsDir, `recording_${timestamp}.raw`);

    if (process.platform === 'darwin') {
      this.startSoxRecording();
    } else if (process.platform === 'win32') {
      this.startWindowsRecording();
    } else {
      this.startSoxRecording();
    }

    this.isRecording = true;
    return this.currentFile;
  }

  private startSoxRecording(): void {
    // macOS: use sox to record from default audio device
    this.audioBuffer = [];
    this.process = spawn('sox', [
      '-q',
      '-t', 'coreaudio',
      this.microphoneId || 'default',
      '-r', '16000',
      '-b', '16',
      '-c', '1',
      '-t', 'raw',
      '-',
    ]);

    this.process.stdout?.on('data', (data: Buffer) => {
      this.audioBuffer.push(data);
      this.handleAudioData(data);
    });

    this.process.on('error', (err) => {
      console.error('sox process error:', err);
    });
  }

  private startWindowsRecording(): void {
    throw new Error('Windows recording is handled by the hidden recorder window');
  }

  private handleAudioData(data: Buffer): void {
    // Convert raw PCM 16-bit samples to Float32Array
    const sampleCount = data.length / 2;
    const samples = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      const int16 = data.readInt16LE(i * 2);
      samples[i] = int16 / 32768;
    }

    if (this.onWaveform) {
      const waveform = this.waveformFromSamples(samples, 9);
      this.onWaveform(waveform);
    }

    this.onSamples?.(samples);
  }

  stop(): AudioChunk {
    if (!this.isRecording) {
      throw new Error('No recording in progress');
    }

    // Kill the process first to stop data collection
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    // Concatenate all buffered audio data
    const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const samples = new Float32Array(totalLength / 2);

    let offset = 0;
    for (const buf of this.audioBuffer) {
      for (let i = 0; i < buf.length; i += 2) {
        const int16 = buf.readInt16LE(i);
        samples[offset++] = int16 / 32768;
      }
    }

    this.audioBuffer = [];
    this.currentFile = null;
    this.isRecording = false;

    return { samples };
  }

  private waveformFromSamples(samples: Float32Array, bars: number): number[] {
    if (samples.length === 0 || bars === 0) {
      return [];
    }

    const chunkSize = Math.max(1, Math.floor(samples.length / bars));
    const waveform: number[] = [];

    for (let i = 0; i < bars; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, samples.length);
      let energy = 0;

      for (let j = start; j < end; j++) {
        energy += Math.abs(samples[j]);
      }
      energy /= (end - start);

      waveform.push(Math.min(1, Math.max(0.12, energy * 3.4)));
    }

    return waveform;
  }

  isActive(): boolean {
    return this.isRecording;
  }
}
