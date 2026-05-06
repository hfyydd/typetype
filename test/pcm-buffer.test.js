const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, "../src/recorder/pcm-buffer.js")
  ).href;
  return import(moduleUrl);
}

test("concatFloat32Chunks concatenates PCM chunks without decoding compressed audio", async () => {
  const { concatFloat32Chunks } = await loadModule();

  const result = concatFloat32Chunks([
    new Float32Array([0.1, 0.2]),
    new Float32Array([0.3]),
    new Float32Array([0.4, 0.5]),
  ]);

  assert.equal(result.length, 5);
  assert.ok(Math.abs(result[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(result[1] - 0.2) < 1e-6);
  assert.ok(Math.abs(result[2] - 0.3) < 1e-6);
  assert.ok(Math.abs(result[3] - 0.4) < 1e-6);
  assert.ok(Math.abs(result[4] - 0.5) < 1e-6);
});
