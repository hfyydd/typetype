export type RecorderPlatform = NodeJS.Platform;

/**
 * Returns true when the platform records audio through the hidden
 * BrowserWindow + WebAudio pipeline (used by both Windows and macOS).
 * Linux and any other unsupported platform fall through to a clear
 * "recording not supported" error.
 */
export function usesRecorderWindow(
  platform: RecorderPlatform = process.platform
): boolean {
  return platform === 'win32' || platform === 'darwin';
}
