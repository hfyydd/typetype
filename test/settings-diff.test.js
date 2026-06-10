const test = require("node:test");
const assert = require("node:assert/strict");

const { isAsrSettingsRelevantChange } = require("../dist-electron/settings-diff.js");

function createSettings(overrides = {}) {
  return {
    hotkey: "F8",
    translate_hotkey: "F9",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    streaming_model: "multilingual_realtime",
    compute_backend: "auto",
    voice_package: "fast_offline",
    streaming_enhancement_mode: "offline_private",
    rewrite_scenario: "general",
    translation_target_language: "en",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
    auto_learning_enabled: true,
    voice_formatting_enabled: true,
    streaming_ai_panel_enabled: false,
    llm_rewrite: {
      enabled: false,
      provider: "openai",
      api_key: "",
      base_url: "https://api.openai.com/v1",
      model: "gpt-5.1",
      temperature: 0.3,
      max_tokens: 4096,
    },
    ...overrides,
  };
}

test("non-ASR changes do not require an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ auto_paste: false, launch_at_login: true });
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});

test("translation target language changes do not require an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ translation_target_language: "ja" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});

test("hotkey and microphone changes do not require an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ hotkey: "CtrlSlash", microphone_id: "mic-1" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});

test("LLM rewrite config changes do not require an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({
    llm_rewrite: {
      ...previous.llm_rewrite,
      enabled: true,
      api_key: "sk-test",
    },
  });
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});

test("toggle-style feature flags do not require an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({
    voice_formatting_enabled: false,
    auto_learning_enabled: false,
    streaming_ai_panel_enabled: true,
    streaming_enhancement_mode: "online_enhanced",
  });
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});

test("recognition_mode change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ recognition_mode: "streaming_output" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("streaming_model change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ streaming_model: "multilingual_segmented" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("voice_package change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ voice_package: "pro_high_accuracy" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("compute_backend change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ compute_backend: "gpu" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("model_path change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ model_path: "/custom/model" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("pinned_model_version change requires an ASR engine reset", () => {
  const previous = createSettings();
  const next = createSettings({ pinned_model_version: "sherpa-onnx-streaming-zipformer-ctc-zh-xlarge" });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("first save with no previous settings always requires an ASR engine reset", () => {
  const next = createSettings();
  assert.equal(isAsrSettingsRelevantChange(null, next), true);
});

test("a non-ASR change combined with an ASR-relevant change still requires a reset", () => {
  const previous = createSettings();
  const next = createSettings({
    auto_paste: false,
    recognition_mode: "streaming_output",
  });
  assert.equal(isAsrSettingsRelevantChange(previous, next), true);
});

test("no-op save with identical ASR-relevant fields does not require a reset", () => {
  const previous = createSettings();
  const next = createSettings();
  assert.equal(isAsrSettingsRelevantChange(previous, next), false);
});
