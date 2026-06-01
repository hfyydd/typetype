import { BrowserWindow, screen, Display } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const OVERLAY_WIDTH = 146;
const OVERLAY_HEIGHT = 50;
const OVERLAY_BOTTOM_MARGIN = 28;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private htmlPath: string;
  private positionPath: string;
  private savePositionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(htmlPath: string, dataDir: string) {
    this.htmlPath = htmlPath;
    this.positionPath = path.join(dataDir, 'overlay-position.json');
  }

  create(): BrowserWindow {
    const preloadPath = path.join(__dirname, 'preload.js');
    this.window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'TypeYourMind Overlay',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.window.loadFile(path.resolve(this.htmlPath));
    this.window.webContents.on('did-fail-load', (_e, err) => {
      console.error('Overlay failed to load:', err);
    });
    this.positionWindow();
    this.window.on('move', () => this.scheduleSavePosition());

    return this.window;
  }

  positionWindow(): void {
    if (!this.window) return;

    const savedPosition = this.getSavedPosition();
    if (savedPosition) {
      this.window.setPosition(savedPosition.x, savedPosition.y);
      return;
    }

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;

    const x = Math.floor(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2);
    const y = Math.floor(workArea.y + workArea.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN);

    this.window.setPosition(x, y);
  }

  show(): void {
    if (this.window) {
      this.ensureAlwaysOnTop();
      if (!this.isWithinAnyDisplay()) {
        this.positionWindow();
      }
      this.window.showInactive();
    }
  }

  hide(): void {
    if (this.window) {
      this.window.hide();
    }
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  private ensureAlwaysOnTop(): void {
    if (!this.window) {
      return;
    }
    this.window.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
    this.window.moveTop();
  }

  private scheduleSavePosition(): void {
    if (!this.window) {
      return;
    }
    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
    }
    this.savePositionTimer = setTimeout(() => this.savePosition(), 250);
  }

  private savePosition(): void {
    if (!this.window) {
      return;
    }
    try {
      const [x, y] = this.window.getPosition();
      fs.mkdirSync(path.dirname(this.positionPath), { recursive: true });
      fs.writeFileSync(this.positionPath, JSON.stringify({ x, y }, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save overlay position:', error);
    }
  }

  private getSavedPosition(): { x: number; y: number } | null {
    try {
      if (!fs.existsSync(this.positionPath)) {
        return null;
      }
      const value = JSON.parse(fs.readFileSync(this.positionPath, 'utf-8'));
      if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
        return null;
      }
      return this.clampToDisplay({ x: Math.round(value.x), y: Math.round(value.y) });
    } catch {
      return null;
    }
  }

  private clampToDisplay(position: { x: number; y: number }): { x: number; y: number } {
    const display = screen.getDisplayNearestPoint(position);
    const area = display.workArea;
    return {
      x: Math.max(area.x, Math.min(position.x, area.x + area.width - OVERLAY_WIDTH)),
      y: Math.max(area.y, Math.min(position.y, area.y + area.height - OVERLAY_HEIGHT)),
    };
  }

  private isWithinAnyDisplay(): boolean {
    if (!this.window) {
      return false;
    }
    const [x, y] = this.window.getPosition();
    return screen.getAllDisplays().some((display: Display) => {
      const area = display.workArea;
      return (
        x >= area.x &&
        y >= area.y &&
        x + OVERLAY_WIDTH <= area.x + area.width &&
        y + OVERLAY_HEIGHT <= area.y + area.height
      );
    });
  }
}
