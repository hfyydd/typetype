const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("streaming AI panel updates are driven by committed cursor text", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../electron/main.ts"), "utf8");

  assert.match(mainSource, /interface StreamingCursorCommitState/);
  assert.match(mainSource, /commitStreamingCursorText\(/);
  assert.match(mainSource, /this\.updateStreamingAiRawText\(committedText, settings, \{ immediate: true \}\)/);
  assert.match(mainSource, /preferCommitted: !final/);
  assert.doesNotMatch(
    mainSource,
    /this\.enqueueStreamingPaste\(pasteText, processed\.rawText, sessionId\);\s*this\.scheduleStreamingTailCorrection[\s\S]{0,180}this\.updateStreamingAiRawText/
  );
});
