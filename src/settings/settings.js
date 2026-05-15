const electronAPI = window.electronAPI;

const saveStatus = document.querySelector("#save-status");
const navItems = Array.from(document.querySelectorAll(".settings-nav-item"));
const panels = Array.from(document.querySelectorAll(".settings-panel"));

const microphoneSelect = document.querySelector("#microphone_id");
const hotkeySelect = document.querySelector("#hotkey");
const translateHotkeySelect = document.querySelector("#translate_hotkey");
const autoPasteToggle = document.querySelector("#auto_paste");
const launchAtLoginToggle = document.querySelector("#launch_at_login");
const recognitionModeSelect = document.querySelector("#recognition_mode");
const computeBackendSelect = document.querySelector("#compute_backend");
const translationTargetLanguageSelect = document.querySelector("#translation_target_language");
const customDictionaryTextarea = document.querySelector("#custom_dictionary");
const modelPathTextarea = document.querySelector("#model_path");

// LLM rewrite settings
const llmEnabledToggle = document.querySelector("#llm_enabled");
const llmConfigPanel = document.querySelector("#llm-config-panel");
const llmProviderSelect = document.querySelector("#llm_provider");
const llmBaseUrlInput = document.querySelector("#llm_base_url");
const llmApiKeyInput = document.querySelector("#llm_api_key");
const llmModelInput = document.querySelector("#llm_model");
const llmTestButton = document.querySelector("#llm-test-button");
const llmTestStatus = document.querySelector("#llm-test-status");

const panelTitle = document.querySelector("#panel-title");
const panelKicker = document.querySelector("#panel-kicker");
const headerMeta = document.querySelector("#header-meta");
const permissionsNavItem = document.querySelector("#permissions-nav-item");
const permissionsSummary = document.querySelector("#permissions-summary");
const microphoneSettingsRow = document.querySelector("#microphone-settings-row");
const accessibilitySettingsRow = document.querySelector("#accessibility-settings-row");
const inputMonitoringSettingsRow = document.querySelector("#input-monitoring-settings-row");

const appVersion = document.querySelector("#app-version");
const runtimeModeLabel = document.querySelector("#runtime-mode-label");
const modelLabel = document.querySelector("#model-label");
const modelStatus = document.querySelector("#model-status");
const modelPathLabel = document.querySelector("#model-path-label");
const computeBackendLabel = document.querySelector("#compute-backend-label");
const logPath = document.querySelector("#log-path");
const asrDiagnosticsOutput = document.querySelector("#asr-diagnostics-output");

let currentSettings = null;
let isHydrating = false;
let saveGeneration = 0;
let saveTimer = null;
let unsubscribeSettingsViewData = null;

const TEXT_INPUT_SAVE_DELAY_MS = 450;

function setVisible(element, visible) {
  if (!element) {
    return;
  }
  element.hidden = !visible;
}

function activatePanel(panelId) {
  for (const item of navItems) {
    item.classList.toggle("is-active", item.dataset.panelTarget === panelId);
  }

  for (const panel of panels) {
    panel.classList.toggle("is-active", panel.id === panelId);
  }

  const activeItem = navItems.find((item) => item.dataset.panelTarget === panelId);
  const label = activeItem?.textContent?.trim() || "设置";
  panelTitle.textContent = label;
  panelKicker.textContent = label;
}

function populateMicrophoneSelect(microphones, selectedId) {
  microphoneSelect.innerHTML = "";

  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "自动检测";
  microphoneSelect.append(autoOption);

  for (const microphone of microphones) {
    const option = document.createElement("option");
    option.value = microphone.id;
    option.textContent = microphone.label;
    microphoneSelect.append(option);
  }

  microphoneSelect.value = selectedId ?? "";
}

function populateHotkeySelect(selectElement, hotkeys, selectedValue) {
  selectElement.innerHTML = "";
  for (const hotkey of hotkeys) {
    const option = document.createElement("option");
    option.value = hotkey.value;
    option.textContent = hotkey.label;
    selectElement.append(option);
  }

  selectElement.value = selectedValue;
  if (selectElement.value !== selectedValue && hotkeys.length > 0) {
    selectElement.value = hotkeys[0].value;
  }
}

function fillSettingsView(view) {
  isHydrating = true;
  currentSettings = structuredClone(view.settings);

  populateHotkeySelect(hotkeySelect, view.hotkeys, view.settings.hotkey);
  populateHotkeySelect(translateHotkeySelect, view.hotkeys, view.settings.translate_hotkey);
  currentSettings.hotkey = hotkeySelect.value;
  currentSettings.translate_hotkey = translateHotkeySelect.value;
  autoPasteToggle.checked = view.settings.auto_paste;
  launchAtLoginToggle.checked = view.settings.launch_at_login ?? false;
  recognitionModeSelect.value = view.settings.recognition_mode ?? "non_streaming";
  computeBackendSelect.value = view.settings.compute_backend ?? "auto";
  translationTargetLanguageSelect.value = view.settings.translation_target_language ?? "en";
  customDictionaryTextarea.value = formatDictionary(view.settings.custom_dictionary ?? []);
  modelPathTextarea.value = view.settings.model_path ?? "";
  populateMicrophoneSelect(view.microphones, view.settings.microphone_id);

  // LLM rewrite settings
  const llmRewrite = view.settings.llm_rewrite ?? {};
  llmEnabledToggle.checked = llmRewrite.enabled ?? false;
  llmProviderSelect.value = llmRewrite.provider ?? "openai";
  llmBaseUrlInput.value = llmRewrite.base_url ?? "https://api.openai.com/v1";
  llmApiKeyInput.value = llmRewrite.api_key ?? "";
  llmModelInput.value = llmRewrite.model ?? "gpt-4o-mini";
  setVisible(llmConfigPanel, llmRewrite.enabled);
  llmTestStatus.textContent = "";
  llmTestStatus.dataset.tone = "";

  // OAuth status
  if (view.settings.llm_oauth?.enabled) {
    updateOauthStatus(view.settings.llm_oauth);
  } else {
    llmOauthStatus.style.display = "none";
    llmOauthButton.disabled = false;
  }

  setVisible(permissionsNavItem, view.show_permissions_panel);
  setVisible(microphoneSettingsRow, view.show_microphone_settings);
  setVisible(accessibilitySettingsRow, view.show_accessibility_settings);
  setVisible(inputMonitoringSettingsRow, view.show_input_monitoring_settings);
  permissionsSummary.textContent = view.permissions_summary;

  appVersion.textContent = `typetype ${view.app_version}`;
  runtimeModeLabel.textContent = view.runtime_mode_label;
  modelLabel.textContent = view.model_label;
  modelStatus.textContent = view.model_status;
  modelStatus.dataset.status = view.model_status;
  modelPathLabel.textContent = view.model_path_label;
  modelPathLabel.title = view.model_path_label;
  computeBackendLabel.textContent = view.compute_backend_label;
  logPath.textContent = view.log_path;
  logPath.title = view.log_path;
  headerMeta.textContent = `${view.platform_label} · ${view.runtime_mode_label} · ${view.model_status}`;

  if (!view.show_permissions_panel && document.querySelector(".settings-panel.is-active")?.id === "panel-permissions") {
    activatePanel("panel-general");
  }

  isHydrating = false;
}

function collectSettings() {
  return {
    ...currentSettings,
    hotkey: hotkeySelect.value,
    translate_hotkey: translateHotkeySelect.value,
    microphone_id: microphoneSelect.value || null,
    auto_paste: autoPasteToggle.checked,
    launch_at_login: launchAtLoginToggle.checked,
    recognition_mode: recognitionModeSelect.value,
    compute_backend: computeBackendSelect.value,
    translation_target_language: translationTargetLanguageSelect.value,
    model_path: modelPathTextarea.value || null,
    pinned_model_version: currentSettings?.pinned_model_version ?? "sherpa-onnx-sense-voice",
    custom_dictionary: parseDictionary(customDictionaryTextarea.value),
    llm_rewrite: {
      enabled: llmEnabledToggle.checked,
      provider: llmProviderSelect.value,
      api_key: llmApiKeyInput.value,
      base_url: llmBaseUrlInput.value,
      model: llmModelInput.value,
      temperature: currentSettings?.llm_rewrite?.temperature ?? 0.3,
      max_tokens: currentSettings?.llm_rewrite?.max_tokens ?? 4096,
    },
    llm_oauth: currentSettings?.llm_oauth,
  };
}

function parseDictionary(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [from, ...rest] = line.split("=>");
      return {
        from: (from ?? "").trim(),
        to: rest.join("=>").trim()
      };
    })
    .filter((entry) => entry.from && entry.to);
}

function formatDictionary(entries) {
  return entries.map((entry) => `${entry.from} => ${entry.to}`).join("\n");
}

function setStatus(message, tone = "default") {
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
}

function formatAsrDiagnostics(report) {
  return [
    `结果: ${report.ok ? "通过" : "失败"}`,
    `模式: ${report.mode}`,
    `模型: ${report.model_label}`,
    `模型目录: ${report.model_path}`,
    `后端: ${report.backend}`,
    `运行时: ${report.runtime}`,
    `说明: ${report.message}`,
  ].join("\n");
}

async function refreshSettingsView(statusMessage = null) {
  const view = await electronAPI.getSettingsViewData();
  fillSettingsView(view);
  if (statusMessage) {
    setStatus(statusMessage);
  } else {
    setStatus(`已加载设置。内置模型 ${view.model_status}。`);
  }
}

async function persistSettings() {
  if (isHydrating || !currentSettings) {
    return;
  }

  const generation = ++saveGeneration;
  setStatus("正在保存设置…");
  try {
    const snapshot = await electronAPI.saveSettings(collectSettings());
    currentSettings = structuredClone(snapshot.settings);
    await refreshSettingsView("设置已自动保存。");
  } catch (error) {
    if (generation === saveGeneration) {
      const message = error instanceof Error && error.message
        ? error.message
        : "设置没有保存成功。已写入本地日志。";
      setStatus(message, "error");
    }
  }
}

function cancelScheduledSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function schedulePersistSettings() {
  cancelScheduledSave();
  setStatus("将在停止输入后自动保存…");
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistSettings();
  }, TEXT_INPUT_SAVE_DELAY_MS);
}

async function runAction(command, successMessage, failureMessage = "请求没有成功。已写入本地日志。") {
  try {
    await electronAPI[command]();
    setStatus(successMessage);
  } catch (_) {
    setStatus(failureMessage, "error");
  }
}

for (const item of navItems) {
  item.addEventListener("click", () => activatePanel(item.dataset.panelTarget));
}

for (const element of [
  hotkeySelect,
  translateHotkeySelect,
  microphoneSelect,
  autoPasteToggle,
  launchAtLoginToggle,
  recognitionModeSelect,
  computeBackendSelect,
  translationTargetLanguageSelect,
  llmEnabledToggle,
  llmProviderSelect,
]) {
  element.addEventListener("change", () => {
    if (element === llmEnabledToggle) {
      setVisible(llmConfigPanel, llmEnabledToggle.checked);
    }
    cancelScheduledSave();
    void persistSettings();
  });
}

for (const element of [customDictionaryTextarea, modelPathTextarea]) {
  element.addEventListener("input", () => {
    if (isHydrating) {
      return;
    }
    schedulePersistSettings();
  });

  element.addEventListener("change", () => {
    cancelScheduledSave();
    void persistSettings();
  });
}

customDictionaryTextarea.addEventListener("blur", () => {
  cancelScheduledSave();
  void persistSettings();
});

modelPathTextarea.addEventListener("blur", () => {
  cancelScheduledSave();
  void persistSettings();
});

llmTestButton.addEventListener("click", async () => {
  llmTestStatus.textContent = "测试中...";
  llmTestStatus.dataset.tone = "";
  try {
    const config = {
      enabled: llmEnabledToggle.checked,
      provider: llmProviderSelect.value,
      api_key: llmApiKeyInput.value,
      base_url: llmBaseUrlInput.value,
      model: llmModelInput.value,
      temperature: 0.3,
      max_tokens: 4096,
    };
    const result = await electronAPI.testLlmConnection(config);
    if (result.ok) {
      llmTestStatus.textContent = `连接成功 (${result.latency_ms}ms)`;
      llmTestStatus.dataset.tone = "default";
    } else {
      llmTestStatus.textContent = `失败: ${result.error}`;
      llmTestStatus.dataset.tone = "error";
    }
  } catch (e) {
    llmTestStatus.textContent = `失败: ${e.message}`;
    llmTestStatus.dataset.tone = "error";
  }
});

for (const input of [llmBaseUrlInput, llmApiKeyInput, llmModelInput]) {
  input.addEventListener("input", () => {
    if (isHydrating) {
      return;
    }
    llmTestStatus.textContent = "";
    llmTestStatus.dataset.tone = "";
    schedulePersistSettings();
  });
}

// OAuth button
const llmOauthButton = document.querySelector("#llm-oauth-button");
const llmOauthStatus = document.querySelector("#llm-oauth-status");
const llmOauthLabel = document.querySelector("#llm-oauth-label");
const llmOauthRevoke = document.querySelector("#llm-oauth-revoke");

llmOauthButton.addEventListener("click", async () => {
  llmOauthButton.disabled = true;
  llmOauthLabel.textContent = "登录中...";
  llmOauthStatus.style.display = "flex";

  try {
    const oauthConfig = await electronAPI.startOauthFlow();
    // Save OAuth config
    const settings = collectSettings();
    settings.llm_oauth = oauthConfig;
    await electronAPI.saveSettings(settings);
    await refreshSettingsView("GPT 登录成功。");
    updateOauthStatus(oauthConfig);
  } catch (e) {
    llmOauthLabel.textContent = `登录失败: ${e.message}`;
    llmOauthLabel.style.color = "var(--color-error)";
    llmOauthButton.disabled = false;
  }
});

llmOauthRevoke.addEventListener("click", async () => {
  const settings = collectSettings();
  settings.llm_oauth = undefined;
  await electronAPI.saveSettings(settings);
  await refreshSettingsView("已取消 GPT 登录。");
  llmOauthStatus.style.display = "none";
  llmOauthButton.disabled = false;
});

function updateOauthStatus(oauthConfig) {
  if (oauthConfig?.enabled) {
    const expiresAt = new Date(oauthConfig.expires_at);
    const timeLeft = Math.max(0, expiresAt - Date.now());
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    llmOauthLabel.textContent = `已登录 (有效期约 ${hours} 小时)`;
    llmOauthLabel.style.color = "";
    llmOauthStatus.style.display = "flex";
    llmOauthButton.disabled = true;
  }
}

document.querySelector("#microphone-settings-button").addEventListener("click", () => {
  runAction("openMicrophoneSettings", "已打开麦克风权限设置。");
});

document.querySelector("#accessibility-button").addEventListener("click", () => {
  runAction("openAccessibilitySettings", "已打开辅助功能设置。");
});

document.querySelector("#input-monitoring-button").addEventListener("click", () => {
  runAction("openInputMonitoringSettings", "已打开输入监听设置。");
});

document.querySelector("#open-logs-button").addEventListener("click", () => {
  runAction("openLogDirectory", "已打开日志目录。");
});

document.querySelector("#asr-diagnostics-button").addEventListener("click", async () => {
  setStatus("正在运行 ASR 自检…");
  try {
    const report = await electronAPI.runAsrDiagnostics();
    const tone = report.ok ? "default" : "error";
    asrDiagnosticsOutput.value = formatAsrDiagnostics(report);
    setStatus(
      `ASR 自检${report.ok ? "通过" : "失败"}：${report.mode} / ${report.backend} / ${report.message}`,
      tone
    );
    await refreshSettingsView();
  } catch (_) {
    setStatus("ASR 自检没有成功完成。已写入本地日志。", "error");
  }
});

document.querySelector("#copy-asr-diagnostics-button").addEventListener("click", async () => {
  const value = asrDiagnosticsOutput.value.trim();
  if (!value) {
    setStatus("还没有可复制的诊断结果。先运行一次 ASR 自检。", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setStatus("已复制 ASR 诊断结果。");
  } catch (_) {
    setStatus("复制失败。可以手动选择诊断内容。", "error");
  }
});

document.querySelector("#feedback-button").addEventListener("click", () => {
  runAction("openFeedbackEmail", "已打开反馈邮件。");
});

refreshSettingsView().catch(() => {
  setStatus("设置加载失败。已写入本地日志。", "error");
});

unsubscribeSettingsViewData = electronAPI.subscribeSettingsViewData((view) => {
  fillSettingsView(view);
});

window.addEventListener("beforeunload", () => {
  unsubscribeSettingsViewData?.();
});
