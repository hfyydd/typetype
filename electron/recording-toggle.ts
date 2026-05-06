export const RECORDING_STOP_GUARD_MS = 600;

export function canStopRecording(
  now: number,
  recordingStopAllowedAt: number
): boolean {
  return now >= recordingStopAllowedAt;
}
