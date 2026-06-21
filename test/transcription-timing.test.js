const test = require("node:test");
const assert = require("node:assert/strict");

const {
  THINKING_UI_LEAD_IN_MS,
  scheduleTranscriptionStart,
} = require("../dist-electron/transcription-timing.js");

test("scheduleTranscriptionStart schedules work immediately for fast non-streaming output", async () => {
  let called = false;

  scheduleTranscriptionStart(() => {
    called = true;
  });

  assert.equal(called, false);

  await new Promise((resolve) => setTimeout(resolve, THINKING_UI_LEAD_IN_MS + 30));

  assert.equal(called, true);
});

test("scheduleTranscriptionStart uses the configured thinking lead-in delay", () => {
  const scheduled = [];

  scheduleTranscriptionStart(() => {}, (callback, delayMs) => {
    scheduled.push({ callback, delayMs });
    return 1;
  });

  assert.equal(scheduled.length, 1);
  assert.equal(THINKING_UI_LEAD_IN_MS, 0);
  assert.equal(scheduled[0].delayMs, THINKING_UI_LEAD_IN_MS);
  assert.equal(typeof scheduled[0].callback, "function");
});
