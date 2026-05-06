const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RECORDING_STOP_GUARD_MS,
  canStopRecording,
} = require("../dist-electron/recording-toggle.js");

test("canStopRecording blocks immediate stop during the Windows repeat-key guard window", () => {
  const startedAt = 1000;
  const allowedAt = startedAt + RECORDING_STOP_GUARD_MS;

  assert.equal(canStopRecording(startedAt + 100, allowedAt), false);
  assert.equal(canStopRecording(allowedAt, allowedAt), true);
});
