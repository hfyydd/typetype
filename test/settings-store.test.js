const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore } = require("../dist-electron/settings-store.js");

function configDirForHome(homeDir) {
  return process.platform === "win32"
    ? path.join(homeDir, "AppData", "Roaming")
    : path.join(homeDir, ".config");
}

test("SettingsStore stores data under the typetype app directory", () => {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));

  os.homedir = () => tempHome;
  try {
    const store = new SettingsStore();
    assert.match(store.getDataDir(), /typetype$/);
    assert.equal(store.getSettingsPath(), path.join(configDirForHome(tempHome), "typetype", "settings.toml"));
    assert.equal("writing_profile" in store.getSettings(), false);
    assert.equal("llm_polish_enabled" in store.getSettings(), false);
    assert.equal("llm_base_url" in store.getSettings(), false);
    assert.equal("llm_model" in store.getSettings(), false);
    assert.equal(store.getSettings().hotkey, "CtrlSlash");
    assert.equal(store.getSettings().translate_hotkey, "CtrlDot");
    assert.equal(store.getSettings().launch_at_login, false);
    assert.equal(store.getSettings().translation_target_language, "en");
    assert.equal(store.getSettings().recognition_mode, "non_streaming");
    assert.equal(store.getSettings().compute_backend, "auto");
    assert.equal(store.getSettings().auto_learning_enabled, true);
    assert.equal(store.getSettings().voice_formatting_enabled, true);
    assert.equal(store.getSettings().rewrite_scenario, "general");
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("settings UI exposes current LLM rewrite controls without legacy polish fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/settings/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/settings/settings.js"), "utf8");

  assert.equal(html.includes('id="llm_polish_enabled"'), false);
  assert.equal(html.includes('id="llm_base_url"'), true);
  assert.equal(html.includes('id="llm_model"'), true);
  assert.equal(html.includes("大模型厂家"), true);
  assert.equal(html.includes("Kimi / 月之暗面国内版"), true);
  assert.equal(html.includes("Kimi 国际版"), true);
  assert.equal(html.includes("MiniMax 国内版"), true);
  assert.equal(html.includes("MiniMax 国际版"), true);
  assert.equal(html.includes("通义千问 / 阿里云百炼（北京）"), true);
  assert.equal(html.includes("通义千问 / 阿里云百炼（新加坡）"), true);
  assert.equal(html.includes("通义千问 / 阿里云百炼（美国）"), true);
  assert.equal(script.includes('base_url: "https://api.moonshot.cn/v1"'), true);
  assert.equal(script.includes('base_url: "https://api.moonshot.ai/v1"'), true);
  assert.equal(script.includes('base_url: "https://dashscope-us.aliyuncs.com/compatible-mode/v1"'), true);
  assert.equal(script.includes("collectLlmRewriteConfig"), true);
  assert.equal(script.includes("applyLlmPresetToControls(llmProviderSelect.value)"), true);
  assert.equal(html.includes("LLM 润色"), false);
  assert.equal(html.includes("LLM 润写"), true);
  assert.equal(script.includes("llmPolishToggle"), false);
  assert.equal(script.includes("llm_polish_enabled"), false);
  assert.equal(script.includes("llmBaseUrlInput"), true);
  assert.equal(script.includes("llmModelInput"), true);
  assert.equal(html.includes('id="launch_at_login"'), true);
  assert.equal(script.includes("launchAtLoginToggle"), true);
  assert.equal(html.includes('id="translate_hotkey"'), true);
  assert.equal(html.includes('id="translation_target_language"'), true);
  assert.equal(html.includes("粤语（实验性）"), true);
  assert.equal(html.includes('id="auto_learning_enabled"'), true);
  assert.equal(html.includes('id="voice_formatting_enabled"'), true);
  assert.equal(html.includes('id="rewrite_scenario"'), true);
  assert.equal(html.includes("添加常用词"), true);
  assert.equal(html.includes("添加纠错词"), true);
  assert.equal(script.includes("translateHotkeySelect"), true);
  assert.equal(script.includes("translationTargetLanguageSelect"), true);
  assert.equal(script.includes("autoLearningToggle"), true);
  assert.equal(script.includes("voiceFormattingToggle"), true);
  assert.equal(script.includes("rewriteScenarioSelect"), true);
  assert.equal(html.includes('id="asr-diagnostics-button"'), true);
  assert.equal(html.includes('id="asr-diagnostics-output"'), true);
  assert.equal(html.includes('id="copy-asr-diagnostics-button"'), true);
  assert.equal(script.includes("runAsrDiagnostics"), true);
  assert.equal(script.includes("formatAsrDiagnostics"), true);
});

test("settings UI no longer exposes writing profile controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/settings/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/settings/settings.js"), "utf8");

  assert.equal(html.includes('id="writing_profile"'), false);
  assert.equal(html.includes("写作风格"), false);
  assert.equal(script.includes("writingProfileSelect"), false);
  assert.equal(script.includes("writing_profile"), false);
});

test("SettingsStore migrates legacy typenew settings into the typetype directory", () => {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));
  const configDir = configDirForHome(tempHome);
  const legacyDir = path.join(configDir, "typenew");
  const currentDir = path.join(configDir, "typetype");

  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, "settings.toml"),
    'hotkey = "F8"\nauto_paste = false\n',
    "utf8"
  );

  os.homedir = () => tempHome;
  try {
    const store = new SettingsStore();
    const settings = store.getSettings();

    assert.equal(settings.hotkey, "F8");
    assert.equal(settings.auto_paste, false);
    assert.equal(settings.translate_hotkey, "CtrlDot");
    assert.equal(settings.launch_at_login, false);
    assert.equal(settings.translation_target_language, "en");
    assert.equal(settings.recognition_mode, "non_streaming");
    assert.equal(settings.compute_backend, "auto");
    assert.equal(settings.auto_learning_enabled, true);
    assert.equal(settings.voice_formatting_enabled, true);
    assert.equal(settings.rewrite_scenario, "general");
    assert.equal(fs.existsSync(path.join(currentDir, "settings.toml")), true);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
