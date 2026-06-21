const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("non-streaming first output uses local quality pipeline and does not wait for LLM", () => {
  const source = readProjectFile("electron/main.ts");
  const transcribeStart = source.indexOf("private async transcribeAudio");
  const outputStart = source.indexOf("private async outputTranscript");
  const body = source.slice(transcribeStart, outputStart);

  assert.equal(transcribeStart > -1, true);
  assert.equal(outputStart > transcribeStart, true);
  assert.equal(body.includes("buildFastNonStreamingQualityText(cleanedTranscript, settings)"), true);
  assert.equal(body.includes("runNonStreamingBackgroundRefineIfNeeded("), true);
  assert.equal(body.includes("default_output_waits_for_llm: false"), true);
  assert.equal(body.includes("await this.rewriteWithLlm(cleanedTranscript)"), false);
  assert.match(source, /const NON_STREAMING_PUNCTUATION_TIMEOUT_MS = \d+;/);
});

test("non-streaming transcription no longer has a fixed thinking lead-in", () => {
  const timingSource = readProjectFile("electron/transcription-timing.ts");
  assert.equal(timingSource.includes("export const THINKING_UI_LEAD_IN_MS = 0;"), true);
});

test("shortcut watchdog repairs stuck recorder state and exposes manual repair IPC", () => {
  const mainSource = readProjectFile("electron/main.ts");
  const ipcSource = readProjectFile("electron/ipc-handlers.ts");
  const preloadSource = readProjectFile("electron/preload.ts");
  const html = readProjectFile("src/settings/index.html");
  const settingsJs = readProjectFile("src/settings/settings.js");

  assert.equal(mainSource.includes("RECORDER_OPERATION_TIMEOUT_MS"), true);
  assert.equal(mainSource.includes("recoverShortcutAndRecorderIfNeeded('shortcut-toggle')"), true);
  assert.equal(mainSource.includes("requestWindowsRecorderStart(settings)"), true);
  assert.equal(mainSource.includes("requestWindowsRecorderStop()"), true);
  assert.equal(mainSource.includes("recordingStartInFlight"), true);
  assert.equal(mainSource.includes("Ignoring shortcut while recorder start is still pending"), true);
  assert.equal(mainSource.includes("recorder_start_timeout"), true);
  assert.equal(mainSource.includes("recorder_stop_timeout"), true);
  assert.equal(mainSource.includes("recorder_reset"), true);
  assert.equal(ipcSource.includes("repair_shortcuts_and_recorder"), true);
  assert.equal(preloadSource.includes("repairShortcutsAndRecorder"), true);
  assert.equal(html.includes('id="repair-shortcuts-button"'), true);
  assert.equal(settingsJs.includes("repairShortcutsAndRecorder"), true);
});

test("ASR diagnostics include shortcut and non-streaming timing fields", () => {
  const source = readProjectFile("electron/main.ts");
  const types = readProjectFile("electron/types.ts");

  for (const field of [
    "shortcut_health",
    "registered_shortcuts",
    "last_shortcut_event_at",
    "recorder_pending_start",
    "recorder_pending_stop",
    "recorder_start_in_flight",
    "recorder_stop_in_flight",
    "last_non_streaming_timing",
  ]) {
    assert.equal(source.includes(field), true);
    assert.equal(types.includes(field), true);
  }
});
