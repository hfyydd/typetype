const test = require("node:test");
const assert = require("node:assert/strict");

const { AiRewriteGate } = require("../dist-electron/ai-rewrite-gate.js");

function createSettings(overrides = {}) {
  return {
    hotkey: "CtrlSlash",
    translate_hotkey: "CtrlDot",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
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
      enabled: true,
      provider: "openai",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
      model: "gpt-5.1",
      temperature: 0.3,
      max_tokens: 4096,
    },
    ...overrides,
  };
}

test("AiRewriteGate skips short stable general dictation", () => {
  const decision = new AiRewriteGate().decide({
    text: "今天开 meeting。",
    settings: createSettings(),
    codeSwitch: {
      matchedTerms: ["meeting"],
      mixedTermCount: 1,
      suspectedAliasCount: 0,
      highRiskCount: 0,
    },
    final: true,
  });

  assert.equal(decision.shouldRun, false);
});

test("AiRewriteGate runs for unresolved mixed aliases and formal scenarios", () => {
  const decision = new AiRewriteGate().decide({
    text: "今天这个代码皮阿需要合并然后发一个正式会议纪要给客户",
    settings: createSettings({ rewrite_scenario: "meeting_notes" }),
    codeSwitch: {
      matchedTerms: ["PR"],
      mixedTermCount: 1,
      suspectedAliasCount: 1,
      highRiskCount: 1,
    },
    final: true,
  });

  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reasons.includes("formal_scenario"), true);
  assert.equal(decision.reasons.includes("suspected_code_switch_alias"), true);
});

test("AiRewriteGate never runs when LLM is not configured", () => {
  const decision = new AiRewriteGate().decide({
    text: "这是一段很长的内容".repeat(20),
    settings: createSettings({ llm_rewrite: { ...createSettings().llm_rewrite, enabled: false } }),
    final: true,
  });

  assert.equal(decision.shouldRun, false);
  assert.deepEqual(decision.reasons, ["llm_disabled"]);
});
