export const THINKING_UI_LEAD_IN_MS = 0;

export type TranscriptionTimer = ReturnType<typeof setTimeout>;

export function scheduleTranscriptionStart(
  start: () => void,
  schedule: (callback: () => void, delayMs: number) => TranscriptionTimer = setTimeout
): TranscriptionTimer {
  return schedule(start, THINKING_UI_LEAD_IN_MS);
}
