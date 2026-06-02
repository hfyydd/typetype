const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AsrEngine, createRecognizerConfig } = require("../dist-electron/asr-engine.js");

test("createRecognizerConfig disables sherpa debug logging", () => {
  const config = createRecognizerConfig("/tmp/model.onnx", "/tmp/tokens.txt");

  assert.equal(config.modelConfig.debug, false);
  assert.equal(config.modelConfig.tokens, "/tmp/tokens.txt");
  assert.equal(config.modelConfig.senseVoice.model, "/tmp/model.onnx");
  assert.equal(config.modelConfig.senseVoice.useItn, true);
});

test("findModelPath keeps streaming and offline model directories separate", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-asr-models-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const streamingDir = path.join(
    root,
    "sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8"
  );
  const offlineDir = path.join(
    root,
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8"
  );

  fs.mkdirSync(streamingDir, { recursive: true });
  fs.writeFileSync(path.join(streamingDir, "model.int8.onnx"), "");
  fs.writeFileSync(path.join(streamingDir, "tokens.txt"), "");
  fs.writeFileSync(path.join(streamingDir, "bpe.model"), "");

  fs.mkdirSync(offlineDir, { recursive: true });
  fs.writeFileSync(path.join(offlineDir, "model.int8.onnx"), "");
  fs.writeFileSync(path.join(offlineDir, "tokens.txt"), "");

  const offlineModel = AsrEngine.findModelPath([root], "non_streaming");
  assert.ok(offlineModel);
  assert.match(offlineModel.modelPath, /sense-voice/);
  assert.equal(offlineModel.bpeVocabPath, null);

  const streamingModel = AsrEngine.findModelPath([root], "streaming_output");
  assert.ok(streamingModel);
  assert.match(streamingModel.modelPath, /streaming-zipformer/);
  assert.equal(path.basename(streamingModel.bpeVocabPath), "bpe.model");
});
