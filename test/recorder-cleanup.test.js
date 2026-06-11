const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Static / structural tests: the recorder cleanup logic has to satisfy
// a few ordering invariants for the OS to actually release the
// microphone when the user stops recording. macOS keeps the orange
// mic indicator on until:
//   1. every MediaStream track has been stopped, AND
//   2. the AudioContext has reached the `closed` state.
// Chromium will not reach (2) until the audio graph has been torn
// down — disconnects must happen before track.stop, and track.stop
// must happen before audioContext.close. We also need the recorder
// to actually await audioContext.close() (not just fire-and-forget)
// so the main process doesn't move on before the device is released.
//
// These tests read the recorder source and assert the ordering. They
// are intentionally structural rather than behavioural because the
// recorder module uses window / AudioContext / MediaStream globals
// that are not available in plain Node — exercising the real code
// path requires a headless browser harness that we don't have here.

const recorderSource = fs.readFileSync(
  path.join(__dirname, "../src/recorder/recorder.js"),
  "utf8",
);

function sourceBetween(start, end) {
  const startIdx = recorderSource.indexOf(start);
  if (startIdx < 0) throw new Error(`anchor not found: ${start}`);
  const endIdx = recorderSource.indexOf(end, startIdx);
  if (endIdx < 0) throw new Error(`end anchor not found: ${end}`);
  return recorderSource.slice(startIdx, endIdx);
}

test("cleanupStream is async and awaits audioContext.close", () => {
  // The signature must be `async function cleanupStream` so the
  // stopRecording caller can `await` it.
  assert.match(
    recorderSource,
    /async\s+function\s+cleanupStream\s*\(/,
    "cleanupStream must be declared async so the OS releases the mic",
  );
  // We must call `await audioContext.close()` inside the function, not
  // just `.catch(() => {})` (fire-and-forget).
  const body = sourceBetween("async function cleanupStream", "function flushPendingChunkSamples");
  assert.match(
    body,
    /await\s+audioContext\.close\s*\(/,
    "cleanupStream must await audioContext.close() so the device is released before the IPC reply",
  );
  // The old fire-and-forget pattern is gone.
  assert.doesNotMatch(
    body,
    /audioContext\.close\s*\(\s*\)\s*\.catch/,
    "audioContext.close() must not be fire-and-forget; the .catch() pattern leaves the device held",
  );
});

test("cleanupStream disconnects source/capture/silent-gain before stopping MediaStream tracks", () => {
  const body = sourceBetween("async function cleanupStream", "function flushPendingChunkSamples");
  // All three disconnect calls must appear before the MediaStream
  // track-stop block. The exact order is:
  //   1. sourceNode.disconnect()
  //   2. captureNode.port.close() + captureNode.disconnect()
  //   3. silentGainNode.disconnect()
  //   4. mediaStream tracks stopped
  //   5. audioContext.close()
  const sourceDisconnect = body.indexOf("sourceNode.disconnect()");
  const captureDisconnect = body.indexOf("captureNode.disconnect()");
  const gainDisconnect = body.indexOf("silentGainNode.disconnect()");
  const trackStop = body.indexOf("track.stop()");
  const contextClose = body.indexOf("audioContext.close()");

  assert.ok(sourceDisconnect > 0, "sourceNode.disconnect() must exist");
  assert.ok(captureDisconnect > 0, "captureNode.disconnect() must exist");
  assert.ok(gainDisconnect > 0, "silentGainNode.disconnect() must exist");
  assert.ok(trackStop > 0, "track.stop() must exist");
  assert.ok(contextClose > 0, "audioContext.close() must exist");

  assert.ok(sourceDisconnect < trackStop, "sourceNode.disconnect() must run before track.stop()");
  assert.ok(captureDisconnect < trackStop, "captureNode.disconnect() must run before track.stop()");
  assert.ok(gainDisconnect < trackStop, "silentGainNode.disconnect() must run before track.stop()");
  assert.ok(trackStop < contextClose, "track.stop() must run before audioContext.close()");
});

test("stopRecording awaits cleanupStream and only sends the result after the device is released", () => {
  const body = sourceBetween("async function stopRecording", "recorderAPI.onStart(startRecording);");
  // The cleanup must be awaited (not fire-and-forget) so the OS
  // actually releases the input device before the main process
  // moves on to transcription.
  assert.match(
    body,
    /await\s+cleanupStream\s*\(\s*\)/,
    "stopRecording must await cleanupStream() so the device is released before the IPC reply",
  );
  // The result must be sent *after* the cleanup so the main process
  // doesn't start transcription while the audio graph is still
  // being torn down. The early-return branch (no mediaStream) calls
  // sendResult before any cleanup and is allowed to bypass the
  // ordering — there is nothing to release, so no async cleanup
  // needs to run. The main branch is the one that must satisfy
  // the order: cleanup → sendResult.
  const awaitCleanup = body.indexOf("await cleanupStream()");
  assert.ok(awaitCleanup > 0, "stopRecording must await cleanupStream()");
  const sendResultAfterCleanup = body.indexOf("recorderAPI.sendResult(", awaitCleanup);
  assert.ok(
    sendResultAfterCleanup > 0,
    "stopRecording's main branch must call sendResult after the await cleanupStream() so the mic is released before transcription starts",
  );
  assert.ok(
    awaitCleanup < sendResultAfterCleanup,
    "cleanupStream must complete before sendResult in the main branch",
  );
});
