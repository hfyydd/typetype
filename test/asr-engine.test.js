const test = require("node:test");
const assert = require("node:assert/strict");

const { createRecognizerConfig } = require("../dist-electron/asr-engine.js");

test("createRecognizerConfig disables sherpa debug logging", () => {
  const config = createRecognizerConfig("/tmp/model.onnx", "/tmp/tokens.txt");

  assert.equal(config.modelConfig.debug, false);
  assert.equal(config.modelConfig.tokens, "/tmp/tokens.txt");
  assert.equal(config.modelConfig.senseVoice.model, "/tmp/model.onnx");
  assert.equal(config.modelConfig.senseVoice.useItn, true);
});
