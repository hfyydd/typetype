const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamingSegmenter } = require("../dist-electron/streaming-segmentation.js");

function samples(value, length) {
  return Float32Array.from({ length }, () => value);
}

test("StreamingSegmenter emits soft pause events with pause duration", () => {
  const segmenter = new StreamingSegmenter(10, {
    minSpeechMs: 100,
    minSilenceMs: 300,
    hardSilenceMs: 700,
    speechThreshold: 0.1,
  });

  assert.equal(segmenter.push(samples(0.5, 2)).length, 0);
  const events = segmenter.push(samples(0, 3));

  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "soft_pause");
  assert.equal(events[0].pauseMs, 300);
  assert.equal(events[0].audio.length, 5);
});

test("StreamingSegmenter emits hard pause events and final flush events", () => {
  const segmenter = new StreamingSegmenter(10, {
    minSpeechMs: 100,
    minSilenceMs: 300,
    hardSilenceMs: 700,
    speechThreshold: 0.1,
  });

  segmenter.push(samples(0.5, 2));
  const hardEvents = segmenter.push(samples(0, 8));
  assert.equal(hardEvents[0].reason, "hard_pause");
  assert.equal(hardEvents[0].pauseMs, 800);

  segmenter.push(samples(0.5, 2));
  const finalEvents = segmenter.flush();
  assert.equal(finalEvents.length, 1);
  assert.equal(finalEvents[0].reason, "final");
});
