import { BrowserWindow, screen, Display } from 'electron';
import * as path from 'path';

const OVERLAY_WIDTH = 146;
const OVERLAY_HEIGHT = 50;
const OVERLAY_BOTTOM_MARGIN = 28;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private htmlPath: string;

  constructor(htmlPath: string) {
    this.htmlPath = htmlPath;
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
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'typetype Overlay',
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

    return this.window;
  }

  positionWindow(): void {
    if (!this.window) return;

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;

    const x = Math.floor(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2);
    const y = Math.floor(workArea.y + workArea.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN);

    this.window.setPosition(x, y);
  }

  show(): void {
    if (this.window) {
      this.positionWindow();
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
}
