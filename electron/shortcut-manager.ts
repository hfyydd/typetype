import { globalShortcut } from 'electron';

export type ShortcutHandler = () => void;

export interface ShortcutOption {
  value: string;
  label: string;
  accelerator: string;
}

export class ShortcutManager {
  private registrations = new Map<string, { accelerator: string; hotkey: string }>();

  getAvailableShortcuts(): ShortcutOption[] {
    if (process.platform === 'win32') {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .', accelerator: 'Control+.' },
        { value: 'F8', label: 'F8', accelerator: 'F8' },
      ];
    } else {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .', accelerator: 'Control+.' },
        { value: 'OptSlash', label: 'Option + /', accelerator: 'Option+/' },
        { value: 'OptDot', label: 'Option + .', accelerator: 'Option+.' },
        { value: 'CtrlSpace', label: 'Ctrl + Space', accelerator: 'Control+Space' },
        { value: 'F8', label: 'F8', accelerator: 'F8' },
      ];
    }
  }

  acceleratorForHotkey(hotkey: string): string | null {
    const shortcuts = this.getAvailableShortcuts();
    const found = shortcuts.find(s => s.value === hotkey);
    return found?.accelerator ?? null;
  }

  register(actionId: string, hotkey: string, onToggle: ShortcutHandler): boolean {
    this.unregister(actionId);

    const accelerator = this.acceleratorForHotkey(hotkey);
    if (!accelerator) {
      console.error('Invalid hotkey:', hotkey);
      return false;
    }

    try {
      let success = globalShortcut.register(accelerator, () => {
        onToggle();
      });

      if (!success && process.platform === 'win32' && hotkey === 'CtrlSlash') {
        const fallback = this.acceleratorForHotkey('F8');
        if (fallback) {
          success = globalShortcut.register(fallback, () => {
            onToggle();
          });

          if (success) {
            console.warn('Falling back to F8 because Ctrl+/ could not be registered on Windows');
            this.registrations.set(actionId, {
              accelerator: fallback,
              hotkey: 'F8',
            });
            return true;
          }
        }
      }

      if (success) {
        this.registrations.set(actionId, {
          accelerator,
          hotkey,
        });
      }

      return success;
    } catch (e) {
      console.error('Failed to register shortcut:', e);
      return false;
    }
  }

  unregister(actionId: string): void {
    const registration = this.registrations.get(actionId);
    if (!registration) {
      return;
    }

    try {
      globalShortcut.unregister(registration.accelerator);
    } catch (e) {
      // Ignore errors during cleanup
    }

    this.registrations.delete(actionId);
  }

  unregisterAll(): void {
    for (const actionId of Array.from(this.registrations.keys())) {
      this.unregister(actionId);
    }
  }

  isRegistered(hotkey: string): boolean {
    const accelerator = this.acceleratorForHotkey(hotkey);
    if (!accelerator) return false;
    return globalShortcut.isRegistered(accelerator);
  }

  getCurrentHotkey(actionId: string): string | null {
    return this.registrations.get(actionId)?.hotkey ?? null;
  }
}
