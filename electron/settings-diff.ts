import { Settings } from './types';

// Settings fields that influence the ASR engine and require it to be torn down
// and re-initialized. Anything outside this list (hotkeys, LLM rewrite, toggle
// flags, language preferences, etc.) is safe to apply without reloading the
// recognizer, so the settings window stays responsive on slow disks and CPUs.
const ASR_RELEVANT_KEYS: ReadonlyArray<keyof Settings> = [
  'recognition_mode',
  'streaming_model',
  'voice_package',
  'compute_backend',
  'model_path',
  'pinned_model_version',
];

export function isAsrSettingsRelevantChange(
  previous: Settings | null,
  next: Settings,
): boolean {
  if (!previous) {
    return true;
  }

  for (const key of ASR_RELEVANT_KEYS) {
    if (previous[key] !== next[key]) {
      return true;
    }
  }

  return false;
}
