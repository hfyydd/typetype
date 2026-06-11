const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AsrHotwordManager, buildHotwordTerms } = require("../dist-electron/asr-hotword-manager.js");

function createSettings(overrides = {}) {
  return {
    hotkey: "F8",
    translate_hotkey: "F9",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "streaming_output",
    streaming_model: "zh_high_accuracy_realtime",
    compute_backend: "auto",
    voice_package: "fast_offline",
    translation_target_language: "en",
    auto_learning_enabled: true,
    voice_formatting_enabled: true,
    streaming_ai_panel_enabled: false,
    streaming_enhancement_mode: "offline_private",
    rewrite_scenario: "general",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
    llm_rewrite: {
      enabled: false,
      provider: "openai",
      api_key: "",
      base_url: "",
      model: "",
      temperature: 0.2,
      max_tokens: 256,
    },
    ...overrides,
  };
}

test("AsrHotwordManager writes high-value runtime hotwords for Chinese CTC streaming", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-hotwords-"));
  try {
    const manager = new AsrHotwordManager({ dataDir });
    const result = manager.prepareHotwords({
      modelFiles: {
        modelPath: "C:/models/ctc/model.int8.onnx",
        tokensPath: "C:/models/ctc/tokens.txt",
        modelKind: "single",
        bpeVocabPath: "C:/models/ctc/bpe.model",
      },
      settings: createSettings(),
      codeSwitchTerms: ["DeepSeek R1", "Qwen3", "Microsoft Office", "狱政管理", "狱侦科"],
      dictionaryTerms: ["客户自定义术语"],
      systemTerms: ["驻监检察室"],
    });

    assert.equal(result.supported, true);
    assert.equal(result.enabled, true);
    assert.ok(result.path);
    assert.equal(fs.existsSync(result.path), true);
    const content = fs.readFileSync(result.path, "utf8");
    assert.match(content, /DeepSeek R1/);
    assert.match(content, /狱政管理/);
    assert.match(content, /驻监检察室/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("AsrHotwordManager disables bottom-layer hotwords for multilingual model paths", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-hotwords-"));
  try {
    const manager = new AsrHotwordManager({ dataDir });
    const result = manager.prepareHotwords({
      modelFiles: {
        modelPath: "C:/models/paraformer/encoder.int8.onnx",
        tokensPath: "C:/models/paraformer/tokens.txt",
        modelKind: "paraformer",
        encoderPath: "C:/models/paraformer/encoder.int8.onnx",
        decoderPath: "C:/models/paraformer/decoder.int8.onnx",
      },
      settings: createSettings({ streaming_model: "multilingual_realtime" }),
      codeSwitchTerms: ["DeepSeek R1"],
    });

    assert.equal(result.supported, false);
    assert.equal(result.enabled, false);
    assert.equal(result.path, null);
    assert.match(result.reason, /后处理词库保护|不支持/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("buildHotwordTerms deduplicates and prioritizes professional justice terms", () => {
  const terms = buildHotwordTerms([
    "DeepSeek R1",
    "deepseek r1",
    "狱侦科",
    "驻监检察室",
    "a",
    "",
    "普通",
  ], 10);

  assert.equal(terms.includes("DeepSeek R1"), true);
  assert.equal(terms.includes("狱侦科"), true);
  assert.equal(terms.includes("驻监检察室"), true);
  assert.equal(terms.includes("a"), false);
});
