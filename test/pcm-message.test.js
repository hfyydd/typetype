const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, "../src/recorder/pcm-message.js")
  ).href;
  return import(moduleUrl);
}

test("isPcmChunkMessage accepts only worklet PCM chunk payloads", async () => {
  const { isPcmChunkMessage } = await loadModule();

  assert.equal(
    isPcmChunkMessage({ type: "pcm-chunk", samples: new Float32Array([0.1]) }),
    true
  );
  assert.equal(isPcmChunkMessage({ type: "pcm-chunk", samples: [0.1] }), false);
  assert.equal(isPcmChunkMessage({ type: "other", samples: new Float32Array([0.1]) }), false);
});
