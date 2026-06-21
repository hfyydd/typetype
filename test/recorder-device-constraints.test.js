const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, "../src/recorder/device-constraints.js")
  ).href;
  return import(moduleUrl);
}

test("buildAudioConstraints includes an ideal deviceId when a microphone is selected", async () => {
  const { buildAudioConstraints } = await loadModule();

  assert.deepEqual(buildAudioConstraints("device-123"), {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    deviceId: { ideal: "device-123" },
  });
  assert.deepEqual(buildAudioConstraints(null), {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  });
});
