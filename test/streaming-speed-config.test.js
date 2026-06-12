const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("streaming cursor append is configured to flush every recognized delta", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../electron/main.ts"), "utf8");

  assert.match(mainSource, /const STREAMING_PASTE_INITIAL_CHARS = 1;/);
  assert.match(mainSource, /const STREAMING_PASTE_INITIAL_INTERVAL_MS = 0;/);
  assert.match(mainSource, /const STREAMING_PASTE_MIN_CHARS = 1;/);
  assert.match(mainSource, /const STREAMING_PASTE_MIN_INTERVAL_MS = 0;/);
  assert.match(mainSource, /pasteAppendWithOptions\(/);
  assert.match(mainSource, /\{ fast: useFastStreamingAppend \}/);
});
