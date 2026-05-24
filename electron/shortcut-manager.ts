import { globalShortcut } from 'electron';

export type ShortcutHandler = () => void;

export interface ShortcutOption {
  value: string;
  label: string;
  accelerator: string;
}

export interface ShortcutRegisterOptions {
  disabledFallbackHotkeys?: string[];
}

interface ShortcutRegistration {
  accelerators: string[];
  hotkey: string;
  activeHotkeys: string[];
}

export class ShortcutManager {
  private registrations = new Map<string, ShortcutRegistration>();

  getAvailableShortcuts(): ShortcutOption[] {
    if (process.platform === 'win32') {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /（备用 F8）', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .（备用 F9）', accelerator: 'Control+.' },
        { value: 'F8', label: 'F8（语音输入备用）', accelerator: 'F8' },
        { value: 'F9', label: 'F9（翻译备用）', accelerator: 'F9' },
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

  register(
    actionId: string,
    hotkey: string,
    onToggle: ShortcutHandler,
    options: ShortcutRegisterOptions = {}
  ): boolean {
    this.unregister(actionId);

    const hotkeys = this.getCandidateHotkeys(hotkey, options.disabledFallbackHotkeys ?? []);
    if (hotkeys.length === 0) {
      console.error('Invalid hotkey:', hotkey);
      return false;
    }

    const registeredAccelerators: string[] = [];
    const activeHotkeys: string[] = [];

    try {
      for (const candidateHotkey of hotkeys) {
        const accelerator = this.acceleratorForHotkey(candidateHotkey);
        if (!accelerator) {
          continue;
        }

        if (globalShortcut.isRegistered(accelerator)) {
          console.warn('Shortcut accelerator is already registered, skipping', {
            actionId,
            hotkey: candidateHotkey,
            accelerator,
          });
          continue;
        }

        const success = globalShortcut.register(accelerator, () => {
          onToggle();
        });

        if (success) {
          registeredAccelerators.push(accelerator);
          activeHotkeys.push(candidateHotkey);
        } else {
          console.warn('Failed to register shortcut accelerator', {
            actionId,
            hotkey: candidateHotkey,
            accelerator,
          });
        }
      }

      if (registeredAccelerators.length === 0) {
        return false;
      }

      this.registrations.set(actionId, {
        accelerators: registeredAccelerators,
        hotkey,
        activeHotkeys,
      });

      if (process.platform === 'win32' && activeHotkeys.length > 1) {
        console.log('Registered Windows shortcut fallback', {
          actionId,
          requested: hotkey,
          active: activeHotkeys,
        });
      }

      return true;
    } catch (e) {
      console.error('Failed to register shortcut:', e);
      for (const accelerator of registeredAccelerators) {
        try {
          globalShortcut.unregister(accelerator);
        } catch {
          // Ignore cleanup errors.
        }
      }
      return false;
    }
  }

  unregister(actionId: string): void {
    const registration = this.registrations.get(actionId);
    if (!registration) {
      return;
    }

    try {
      for (const accelerator of registration.accelerators) {
        globalShortcut.unregister(accelerator);
      }
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
    return this.getCandidateHotkeys(hotkey).some((candidateHotkey) => {
      const accelerator = this.acceleratorForHotkey(candidateHotkey);
      return accelerator ? globalShortcut.isRegistered(accelerator) : false;
    });
  }

  getCurrentHotkey(actionId: string): string | null {
    return this.registrations.get(actionId)?.activeHotkeys.join(',') ?? null;
  }

  private getCandidateHotkeys(hotkey: string, disabledFallbackHotkeys: string[] = []): string[] {
    const accelerator = this.acceleratorForHotkey(hotkey);
    if (!accelerator) {
      return [];
    }

    const disabled = new Set(disabledFallbackHotkeys);
    const candidates = [hotkey];

    for (const fallback of this.getFallbackHotkeys(hotkey)) {
      if (!disabled.has(fallback) && !candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    }

    return candidates;
  }

  private getFallbackHotkeys(hotkey: string): string[] {
    if (process.platform !== 'win32') {
      return [];
    }

    if (hotkey === 'CtrlSlash') {
      return ['F8'];
    }

    if (hotkey === 'CtrlDot') {
      return ['F9'];
    }

    return [];
  }
}
