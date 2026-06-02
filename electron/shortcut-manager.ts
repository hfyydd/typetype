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

const ALT_DICTATION_HOTKEY = 'AltDictation';
const ALT_SPACE_MODE_HOTKEY = 'AltSpaceMode';
const ALT_TRANSLATION_HOTKEY = 'AltTranslation';
const LEGACY_RIGHT_ALT_PREFIX = ['Type', 'less'].join('');
const LEGACY_HOTKEY_ALIASES: Record<string, string> = {
  [`${LEGACY_RIGHT_ALT_PREFIX}Dictation`]: ALT_DICTATION_HOTKEY,
  [`${LEGACY_RIGHT_ALT_PREFIX}FreeMode`]: ALT_SPACE_MODE_HOTKEY,
  [`${LEGACY_RIGHT_ALT_PREFIX}Translation`]: ALT_TRANSLATION_HOTKEY,
};

export interface ShortcutHealth {
  ok: boolean;
  missing: Array<{
    actionId: string;
    hotkey: string;
    accelerator: string;
  }>;
}

export class ShortcutManager {
  private registrations = new Map<string, ShortcutRegistration>();

  getAvailableShortcuts(): ShortcutOption[] {
    if (process.platform === 'win32') {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /（备用 F8）', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .（备用 F9）', accelerator: 'Control+.' },
        { value: ALT_DICTATION_HOTKEY, label: '右 Alt（语音）', accelerator: 'AltGr' },
        { value: ALT_SPACE_MODE_HOTKEY, label: '右 Alt + Space（备用语音）', accelerator: 'AltGr+Space' },
        { value: ALT_TRANSLATION_HOTKEY, label: '右 Alt + Shift（翻译）', accelerator: 'AltGr+Shift' },
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
    const found = shortcuts.find(s => s.value === this.normalizeHotkey(hotkey));
    return found?.accelerator ?? null;
  }

  register(
    actionId: string,
    hotkey: string,
    onToggle: ShortcutHandler,
    options: ShortcutRegisterOptions = {}
  ): boolean {
    this.unregister(actionId);

    const normalizedHotkey = this.normalizeHotkey(hotkey);
    const disabledFallbacks = (options.disabledFallbackHotkeys ?? []).map((fallback) => this.normalizeHotkey(fallback));
    const hotkeys = this.getCandidateHotkeys(normalizedHotkey, disabledFallbacks);
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
        hotkey: normalizedHotkey,
        activeHotkeys,
      });

      if (process.platform === 'win32' && activeHotkeys.length > 1) {
        console.log('Registered Windows shortcut fallback', {
          actionId,
          requested: normalizedHotkey,
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
    return this.getCandidateHotkeys(this.normalizeHotkey(hotkey)).some((candidateHotkey) => {
      const accelerator = this.acceleratorForHotkey(candidateHotkey);
      return accelerator ? globalShortcut.isRegistered(accelerator) : false;
    });
  }

  getCurrentHotkey(actionId: string): string | null {
    return this.registrations.get(actionId)?.activeHotkeys.join(',') ?? null;
  }

  getRegistrationHealth(): ShortcutHealth {
    const missing: ShortcutHealth['missing'] = [];

    for (const [actionId, registration] of this.registrations.entries()) {
      for (let index = 0; index < registration.accelerators.length; index += 1) {
        const accelerator = registration.accelerators[index];
        if (!globalShortcut.isRegistered(accelerator)) {
          missing.push({
            actionId,
            hotkey: registration.activeHotkeys[index] ?? registration.hotkey,
            accelerator,
          });
        }
      }
    }

    return {
      ok: missing.length === 0,
      missing,
    };
  }

  private getCandidateHotkeys(hotkey: string, disabledFallbackHotkeys: string[] = []): string[] {
    const normalizedHotkey = this.normalizeHotkey(hotkey);
    const accelerator = this.acceleratorForHotkey(normalizedHotkey);
    if (!accelerator) {
      return [];
    }

    const disabled = new Set(disabledFallbackHotkeys.map((fallback) => this.normalizeHotkey(fallback)));
    const candidates = [normalizedHotkey];

    for (const fallback of this.getFallbackHotkeys(normalizedHotkey)) {
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

    if (hotkey === ALT_DICTATION_HOTKEY || hotkey === ALT_SPACE_MODE_HOTKEY) {
      return ['F8'];
    }

    if (hotkey === ALT_TRANSLATION_HOTKEY) {
      return ['F9'];
    }

    return [];
  }

  private normalizeHotkey(hotkey: string): string {
    return LEGACY_HOTKEY_ALIASES[hotkey] ?? hotkey;
  }
}
