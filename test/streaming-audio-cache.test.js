const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RollingAudioCache,
} = require("../dist-electron/streaming-audio-cache.js");

function samplesFrom(start, length) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = start + i;
  }
  return samples;
}

test("RollingAudioCache keeps only the most recent audio window", () => {
  const cache = new RollingAudioCache(10, 3);

  cache.append(samplesFrom(0, 10));
  const stats = cache.append(samplesFrom(10, 25));
  const samples = cache.getSamples();

  assert.equal(stats.totalSamples, 30);
  assert.equal(stats.truncated, true);
  assert.equal(samples.length, 30);
  assert.equal(samples[0], 5);
  assert.equal(samples[29], 34);
});

test("RollingAudioCache trims oversized chunks to the tail", () => {
  const cache = new RollingAudioCache(10, 3);

  cache.append(samplesFrom(0, 45));
  const samples = cache.getSamples();

  assert.equal(cache.wasTruncated(), true);
  assert.equal(samples.length, 30);
  assert.equal(samples[0], 15);
  assert.equal(samples[29], 44);
});

test("RollingAudioCache reset releases cached audio and clears truncation", () => {
  const cache = new RollingAudioCache(10, 3);

  cache.append(samplesFrom(0, 45));
  cache.reset();

  assert.equal(cache.wasTruncated(), false);
  assert.equal(cache.getSamples().length, 0);
  assert.equal(cache.stats().totalSamples, 0);
});
