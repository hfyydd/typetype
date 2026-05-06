import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export type TrayStatus = 'idle' | 'recording' | 'processing';

interface TrayAnimationFrames {
  idle: string[];
  recording: string[];
  processing: string[];
}

export class TrayManager {
  private trayIconPath: string | null = null;
  private animationTimeouts: NodeJS.Timeout[] = [];
  private currentStatus: TrayStatus = 'idle';
  private resourcesPath: string;

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  getIdleIconPath(): string {
    const candidates = [
      path.join(this.resourcesPath, 'tray-icons-16', 'idle', 'frame_0.png'),
      path.join(this.resourcesPath, 'tray-icons', 'idle', 'frame_0.png'),
      path.join(this.resourcesPath, 'icons', 'tray-icons', 'idle', 'frame_0.png'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  getFrames(status: TrayStatus): string[] {
    const baseDir16 = path.join(this.resourcesPath, 'tray-icons-16', status);
    const baseDir = fs.existsSync(baseDir16)
      ? baseDir16
      : path.join(this.resourcesPath, 'tray-icons', status);
    if (!fs.existsSync(baseDir)) {
      return [this.getIdleIconPath()];
    }

    const files = fs.readdirSync(baseDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
      .sort();

    return files.map(f => path.join(baseDir, f));
  }

  setStatus(status: TrayStatus, setIconFn: (iconPath: string) => void): void {
    // Clear any existing animation timeouts
    this.clearAnimations();

    this.currentStatus = status;

    if (status === 'idle') {
      setIconFn(this.getIdleIconPath());
      return;
    }

    const frames = this.getFrames(status);
    if (frames.length === 0) {
      return;
    }

    // Set initial frame
    setIconFn(frames[0]);

    // Animate through frames
    let frameIndex = 1;
    const frameDelay = status === 'recording' ? 120 : 150;

    const animate = () => {
      if (frameIndex >= frames.length) {
        frameIndex = 0;
      }
      setIconFn(frames[frameIndex]);
      frameIndex++;

      const timeout = setTimeout(animate, frameDelay);
      this.animationTimeouts.push(timeout);
    };

    const timeout = setTimeout(animate, frameDelay);
    this.animationTimeouts.push(timeout);
  }

  clearAnimations(): void {
    for (const timeout of this.animationTimeouts) {
      clearTimeout(timeout);
    }
    this.animationTimeouts = [];
  }

  getStatus(): TrayStatus {
    return this.currentStatus;
  }
}

export function trayStatusForRuntimeStatus(status: string): TrayStatus {
  switch (status) {
    case 'idle':
    case 'done':
      return 'idle';
    case 'recording':
      return 'recording';
    case 'transcribing':
    case 'translating':
      return 'processing';
    case 'stopped':
      return 'idle';
    default:
      return 'idle';
  }
}
