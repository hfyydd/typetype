const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, "../src/recorder/audio-processing.js")
  ).href;
  return import(moduleUrl);
}

test("downsampleTo16k converts higher-rate mono audio to 16kHz", async () => {
  const { downsampleTo16k } = await loadModule();
  const input = new Float32Array(480).fill(0.5);
  const output = downsampleTo16k(input, 48000);

  assert.equal(output.length, 160);
  assert.equal(output[0], 0.5);
});

test("normalizePcmChunkTo16k prepares streaming recorder chunks for ASR", async () => {
  const { normalizePcmChunkTo16k } = await loadModule();
  const input = new Float32Array(960).fill(0.25);
  const output = normalizePcmChunkTo16k(input, 48000);

  assert.equal(output.length, 320);
  assert.equal(output[0], 0.25);
});

test("buildWaveform returns the requested number of bars", async () => {
  const { buildWaveform } = await loadModule();
  const data = new Uint8Array(128).fill(255);
  const waveform = buildWaveform(data, 9);

  assert.equal(waveform.length, 9);
  assert.ok(waveform.every((value) => value >= 0.12 && value <= 1));
});
