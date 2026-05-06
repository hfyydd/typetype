const test = require("node:test");
const assert = require("node:assert/strict");

const { createTranscriptionLogMeta } = require("../dist-electron/transcription-log.js");

test("createTranscriptionLogMeta summarizes transcript details without exposing the text", () => {
  const text = "secret content";
  const meta = createTranscriptionLogMeta(text);

  assert.deepEqual(meta, {
    chars: text.length,
    hasText: true,
  });
  assert.equal("text" in meta, false);
});
