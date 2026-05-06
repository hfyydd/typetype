const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSoxInputArgs } = require("../dist-electron/audio-recorder.js");

test("buildSoxInputArgs targets the selected macOS microphone when present", () => {
  assert.deepEqual(buildSoxInputArgs("USB Mic"), ["-t", "coreaudio", "USB Mic"]);
  assert.deepEqual(buildSoxInputArgs(null), ["-t", "coreaudio", "default"]);
});
