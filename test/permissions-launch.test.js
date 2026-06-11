const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Round 9k (0.3.13 -> 0.3.15) tried three different strategies for the
// macOS Accessibility prompt: a synchronous isTrustedAccessibilityClient(true)
// in startRecording (blocked the main process on slow Intel macOS, 0.3.14
// rollback), a silent read in initialize (worked, no prompt), and a
// System Settings auto-open on the first paste failure (worked, but
// stole focus from the user mid-recording and made the user think
// stop had broken again). All three were user-visible regressions.
//
// 0.3.16 collapses back to 0.3.12's behaviour: silent read in
// initialize (no prompt), no auto-open anywhere, no overlay patch on
// paste failure. The user is expected to use the existing
// "打开辅助功能设置" button in the settings panel if they want to
// flip the Accessibility toggle. This matches the version the user
// was running successfully before the 0.3.13 round and is the
// minimum-change rollback. The microphone path is unchanged across
// the round.
//
// These tests lock the rollback so the 0.3.13 prompt does not creep
// back in. They are structural because TypenewApp is not exported —
// running it requires the full Electron bootstrap.

const mainSource = fs.readFileSync(
  path.join(__dirname, "../electron/main.ts"),
  "utf8",
);

function sourceBetween(start, end) {
  const startIdx = mainSource.indexOf(start);
  if (startIdx < 0) throw new Error(`start anchor not found: ${start}`);
  const endIdx = mainSource.indexOf(end, startIdx);
  if (endIdx < 0) throw new Error(`end anchor not found: ${end}`);
  return mainSource.slice(startIdx, endIdx);
}

test("initialize() does not prompt for Accessibility at startup", () => {
  // 0.3.13 called ensureMacPermission('accessibility') in initialize()
  // after the silent status read. The 0.3.14 rollback removed it; the
  // 0.3.15 round tried a System Settings auto-open on first paste
  // failure, which was also reverted. This test pins the silent-read
  // shape that matches 0.3.12.
  const block = sourceBetween(
    "if (process.platform === 'darwin') {",
    "try {\n      this.registerShortcut();",
  );
  assert.doesNotMatch(
    block,
    /ensureMacPermission\(\s*['"]accessibility['"]\s*\)/,
    "initialize() must not call ensureMacPermission('accessibility')",
  );
  assert.doesNotMatch(
    block,
    /isTrustedAccessibilityClient\(\s*true\s*\)/,
    "initialize() must not call isTrustedAccessibilityClient(true) — that opens the native prompt synchronously",
  );
  assert.doesNotMatch(
    block,
    /maybeOpenAccessibilitySettings/,
    "initialize() must not auto-open System Settings — that stole focus in 0.3.15 and made the user think stop had broken",
  );
  // The status read is still required so the log line stays accurate.
  assert.match(
    block,
    /getMacPermissionsStatus\(\)/,
    "initialize() must still call getMacPermissionsStatus() to log the silent status",
  );
});

test("startRecording() does not await any accessibility prompt", () => {
  // 0.3.13 added `await this.ensureMacPermission('accessibility')` in
  // startRecording. On slow Intel macOS that call blocks the main
  // process for the duration of the native accessibility dialog, which
  // (a) freezes the shortcut handler so the stop hotkey is silently
  // lost and (b) interacts with the 600ms RECORDING_STOP_GUARD_MS in
  // handleShortcutToggle so the second hotkey press sometimes goes to
  // startRecording() again instead of stopRecording(). 0.3.14 rolled
  // it back; 0.3.15 should not re-introduce anything similar.
  const block = sourceBetween(
    "private async startRecording(intent: CaptureIntent = 'dictation'): Promise<void> {",
    "this.recorderWindow?.webContents.send('recorder_start',",
  );
  assert.doesNotMatch(
    block,
    /ensureMacPermission\(\s*['"]accessibility['"]\s*\)/,
    "startRecording() must not call ensureMacPermission('accessibility')",
  );
  assert.doesNotMatch(
    block,
    /maybeOpenAccessibilitySettings/,
    "startRecording() must not auto-open System Settings",
  );
  assert.doesNotMatch(
    block,
    /streamingAutoPasteSuspended\s*=\s*true/,
    "startRecording() must not pre-emptively set streamingAutoPasteSuspended — let streaming paste fail naturally",
  );
  // Microphone must still be the first permission check.
  assert.match(
    block,
    /ensureMacPermission\(\s*['"]microphone['"]\s*\)/,
    "startRecording() must still call ensureMacPermission('microphone') first",
  );
});

test("outputTranscript() and flushStreamingPasteQueue() do not auto-open System Settings on paste failure", () => {
  // 0.3.15 added a System Settings auto-open on the first paste
  // failure of a session. It worked as designed but stole focus from
  // the user, who read the focus jump as "录音又不能 stop 了". 0.3.16
  // matches 0.3.12 exactly: paste failure is console.warn-only. The
  // user is expected to click the "打开辅助功能设置" button in the
  // settings panel themselves.
  const outBlock = sourceBetween(
    "private async outputTranscript(",
    "private isStreamingOutputMode(): boolean {",
  );
  assert.doesNotMatch(
    outBlock,
    /maybeOpenAccessibilitySettings/,
    "outputTranscript() must not auto-open System Settings on paste failure (0.3.15 regression)",
  );
  assert.doesNotMatch(
    outBlock,
    /patchStreamingAiPanelState/,
    "outputTranscript() must not patch the streaming panel on paste failure (0.3.13 patch reverted)",
  );

  const streamBlock = sourceBetween(
    "private async flushStreamingPasteQueue(sessionId: number): Promise<void> {",
    "private async processSegmentedStreamingSegments(",
  );
  assert.doesNotMatch(
    streamBlock,
    /maybeOpenAccessibilitySettings/,
    "flushStreamingPasteQueue() must not auto-open System Settings",
  );
});


test("non-streaming transcribeAudio backfills the ASR text with the rewrite result", () => {
  // 0.3.17 (this round) re-introduces the non-streaming auto-paste
  // "backfill" flow: paste the ASR transcript first, then once the
  // AI rewrite / translation "thinking" step completes, replace the
  // just-pasted chunk with the rewrite result via the same Windows
  // + macOS replaceRecentTextInApp mechanism that the streaming panel
  // uses. This locks the shape so a future refactor cannot silently
  // drop the backfill again.
  const block = sourceBetween(
    "console.log('[translation-debug] transcript-ready', {",
    "// Dismiss overlay after delay",
  );
  assert.match(
    block,
    /streamingInsertionTransaction\.pasteAppend\(\s*cleanedTranscript[\s\S]*this\.previousAppBundleId/,
    "transcribeAudio must paste the ASR transcript before the rewrite step",
  );
  assert.match(
    block,
    /streamingInsertionTransaction\.replaceInsertedText\([\s\S]*finalText[\s\S]*this\.previousAppBundleId/,
    "transcribeAudio must replace the ASR transcript with the rewrite result",
  );
  assert.match(
    block,
    /accessibility_required/,
    "transcribeAudio must surface accessibility_required errors so the user can fix macOS permissions",
  );
  assert.match(
    block,
    /outputTranscript\([\s\S]*skipPaste:\s*initialPasteOk/,
    "transcribeAudio must skip the second paste when the initial paste already landed",
  );
});
