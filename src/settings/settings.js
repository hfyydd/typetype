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
const voiceFormattingToggle = document.querySelector("#voice_formatting_enabled");
const autoLearningToggle = document.querySelector("#auto_learning_enabled");
const computeBackendSelect = document.querySelector("#compute_backend");
const translationTargetLanguageSelect = document.querySelector("#translation_target_language");
const rewriteScenarioSelect = document.querySelector("#rewrite_scenario");
const modelPathTextarea = document.querySelector("#model_path");
const dictionaryStats = document.querySelector("#dictionary-stats");
const dictionarySearchInput = document.querySelector("#dictionary-search");
const dictionaryList = document.querySelector("#dictionary-list");
const dictionaryEditor = document.querySelector("#dictionary-editor");
const dictionaryTermInput = document.querySelector("#dictionary-term-input");
const dictionaryAliasInput = document.querySelector("#dictionary-alias-input");
const dictionaryAddTermButton = document.querySelector("#dictionary-add-term-button");
const dictionaryAddReplacementButton = document.querySelector("#dictionary-add-replacement-button");
const dictionaryShowImportButton = document.querySelector("#dictionary-show-import-button");
const dictionaryEditorTitle = document.querySelector("#dictionary-editor-title");
const dictionaryEditorHelp = document.querySelector("#dictionary-editor-help");
const dictionarySaveEntryButton = document.querySelector("#dictionary-save-entry-button");
const dictionaryCancelEntryButton = document.querySelector("#dictionary-cancel-entry-button");
const dictionaryPasteInput = document.querySelector("#dictionary-paste-input");
const dictionaryPreviewPasteButton = document.querySelector("#dictionary-preview-paste-button");
const dictionaryImportFileButton = document.querySelector("#dictionary-import-file-button");
const dictionaryConfirmImportButton = document.querySelector("#dictionary-confirm-import-button");
const dictionaryExportButton = document.querySelector("#dictionary-export-button");
const dictionaryPreview = document.querySelector("#dictionary-preview");
const systemLexiconToggle = document.querySelector("#system-lexicon-toggle");
const systemLexiconCategories = document.querySelector("#system-lexicon-categories");
const systemLexiconDescription = document.querySelector("#system-lexicon-description");
const dictionaryHelpButton = document.querySelector("#dictionary-help-button");
const dictionaryHelpDialog = document.querySelector("#dictionary-help-dialog");
const dictionaryHelpCloseButton = document.querySelector("#dictionary-help-close-button");
const dictionaryCopyExampleButton = document.querySelector("#dictionary-copy-example-button");
const dictionaryHelpExample = document.querySelector("#dictionary-help-example");

// LLM rewrite settings
const llmEnabledToggle = document.querySelector("#llm_enabled");
const llmConfigPanel = document.querySelector("#llm-config-panel");
const llmProviderSelect = document.querySelector("#llm_provider");
const llmBaseUrlInput = document.querySelector("#llm_base_url");
const llmApiKeyInput = document.querySelector("#llm_api_key");
const llmModelInput = document.querySelector("#llm_model");
const llmTestButton = document.querySelector("#llm-test-button");
const llmTestStatus = document.querySelector("#llm-test-status");
const llmActiveRouteLabel = document.querySelector("#llm-active-route-label");

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
let dictionaryView = null;
let activeDictionaryEntryId = null;
let dictionaryEditorMode = "term";
let pendingDictionaryImportPreview = null;

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
  voiceFormattingToggle.checked = view.settings.voice_formatting_enabled ?? true;
  autoLearningToggle.checked = view.settings.auto_learning_enabled ?? true;
  computeBackendSelect.value = view.settings.compute_backend ?? "auto";
  translationTargetLanguageSelect.value = view.settings.translation_target_language ?? "en";
  rewriteScenarioSelect.value = view.settings.rewrite_scenario ?? "general";
  modelPathTextarea.value = view.settings.model_path ?? "";
  populateMicrophoneSelect(view.microphones, view.settings.microphone_id);

  // LLM rewrite settings
  const savedLlmRewrite = view.settings.llm_rewrite ?? {};
  const llmRewrite = {
    ...savedLlmRewrite,
    provider: savedLlmRewrite.provider ?? "openai",
    base_url: savedLlmRewrite.base_url ?? "https://api.openai.com/v1",
    api_key: savedLlmRewrite.api_key ?? "",
    model: savedLlmRewrite.model ?? "gpt-5.5",
  };
  const llmProviderValue = getProviderSelectValue(llmRewrite);
  llmEnabledToggle.checked = llmRewrite.enabled ?? false;
  llmProviderSelect.value = llmProviderValue;
  llmBaseUrlInput.value = llmRewrite.base_url;
  llmApiKeyInput.value = llmRewrite.api_key;
  llmModelInput.value = llmRewrite.model;
  currentSettings.llm_rewrite = {
    ...llmRewrite,
    provider: llmProviderValue,
  };
  setVisible(llmConfigPanel, llmRewrite.enabled);
  llmTestStatus.textContent = "";
  llmTestStatus.dataset.tone = "";

  updateLlmActiveRoute(currentSettings);

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
  const llmRewrite = {
    enabled: llmEnabledToggle.checked,
    provider: llmProviderSelect.value,
    api_key: llmApiKeyInput.value,
    base_url: llmBaseUrlInput.value,
    model: llmModelInput.value,
    temperature: currentSettings?.llm_rewrite?.temperature ?? 0.3,
    max_tokens: currentSettings?.llm_rewrite?.max_tokens ?? 4096,
  };
  llmRewrite.provider = getProviderSelectValue(llmRewrite);

  return {
    ...currentSettings,
    hotkey: hotkeySelect.value,
    translate_hotkey: translateHotkeySelect.value,
    microphone_id: microphoneSelect.value || null,
    auto_paste: autoPasteToggle.checked,
    launch_at_login: launchAtLoginToggle.checked,
    recognition_mode: recognitionModeSelect.value,
    voice_formatting_enabled: voiceFormattingToggle.checked,
    auto_learning_enabled: autoLearningToggle.checked,
    compute_backend: computeBackendSelect.value,
    translation_target_language: translationTargetLanguageSelect.value,
    rewrite_scenario: rewriteScenarioSelect.value,
    model_path: modelPathTextarea.value || null,
    pinned_model_version: currentSettings?.pinned_model_version ?? "sherpa-onnx-sense-voice",
    custom_dictionary: currentSettings?.custom_dictionary ?? [],
    llm_rewrite: llmRewrite,
  };
}

function setStatus(message, tone = "default") {
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
}

function hasApiKeyConfig(settings) {
  return Boolean(settings?.llm_rewrite?.enabled && settings.llm_rewrite.api_key?.trim());
}

function inferLlmRoute(rewrite = {}) {
  const provider = (rewrite.provider || "").toLowerCase();
  const baseUrl = (rewrite.base_url || "").toLowerCase();
  const model = (rewrite.model || "").toLowerCase();
  const modelLabel = rewrite.model || "未填写模型";

  const knownProviders = [
    { key: "openai", label: "OpenAI GPT", match: () => baseUrl.includes("api.openai.com") || /^gpt[-\w.]*|^o\d/.test(model) },
    { key: "anthropic", label: "Claude API", match: () => baseUrl.includes("anthropic.com") || model.includes("claude") },
    { key: "minimax", label: "MiniMax", match: () => baseUrl.includes("minimax") || model.includes("minimax") },
    { key: "deepseek", label: "DeepSeek", match: () => baseUrl.includes("deepseek") || model.includes("deepseek") },
    { key: "qwen", label: "通义千问", match: () => baseUrl.includes("dashscope.aliyuncs.com") || model.includes("qwen") },
    { key: "zhipu", label: "智谱 GLM", match: () => baseUrl.includes("bigmodel.cn") || model.includes("glm") },
    { key: "kimi", label: "Kimi/月之暗面", match: () => baseUrl.includes("moonshot.ai") || model.includes("kimi") },
    { key: "baichuan", label: "百川", match: () => baseUrl.includes("baichuan-ai.com") || model.includes("baichuan") },
    { key: "doubao", label: "豆包", match: () => baseUrl.includes("volces.com") || model.includes("doubao") },
  ];

  const matched = knownProviders.find((entry) => entry.match());
  if (matched) {
    return {
      key: matched.key,
      label: `${matched.label} · ${modelLabel}`,
      isOpenAi: matched.key === "openai",
    };
  }

  if (provider === "anthropic") {
    return { key: "anthropic", label: `Claude API · ${modelLabel}`, isOpenAi: false };
  }

  if (provider === "openai") {
    return { key: "openai", label: `OpenAI GPT · ${modelLabel}`, isOpenAi: true };
  }

  return { key: "custom", label: `国产/第三方模型 · ${modelLabel}`, isOpenAi: false };
}

function getProviderSelectValue(rewrite = {}) {
  const route = inferLlmRoute(rewrite);
  if (route.key === "openai") {
    return "openai";
  }
  if (route.key === "anthropic") {
    return "anthropic";
  }
  return "compatible";
}

function getApiModelLabel(settings) {
  const rewrite = settings?.llm_rewrite ?? {};
  if (!rewrite.api_key?.trim()) {
    return "未配置 API Key 模型";
  }
  return inferLlmRoute(rewrite).label;
}

function updateLlmActiveRoute(settings) {
  if (!llmActiveRouteLabel) {
    return;
  }

  if (!settings?.llm_rewrite?.enabled) {
    llmActiveRouteLabel.textContent = "未启用。";
    llmActiveRouteLabel.dataset.tone = "";
    return;
  }

  const apiReady = hasApiKeyConfig(settings);

  if (apiReady) {
    const rewrite = settings.llm_rewrite ?? {};
    const route = inferLlmRoute(rewrite);
    const keyTip = route.isOpenAi
      ? "正在使用 OpenAI Platform API Key 调用 GPT；ChatGPT Plus/Pro 订阅不等于 API 免费额度。"
      : "正在使用上方 API Key 模型做结构化润写。";
    llmActiveRouteLabel.textContent = `当前通道：${route.label}。${keyTip}`;
    llmActiveRouteLabel.dataset.tone = "success";
    return;
  }

  llmActiveRouteLabel.textContent = "已启用，但还没有 API Key。GPT 和国产模型都在上方填写 API Key、Base URL 和模型名。";
  llmActiveRouteLabel.dataset.tone = "error";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadDictionaryView() {
  dictionaryView = await electronAPI.getDictionaryViewData();
  renderDictionaryView();
}

function renderDictionaryView() {
  if (!dictionaryView) {
    return;
  }

  const stats = dictionaryView.stats;
  const learnedLabel = stats.last_auto_learned_at
    ? `，最近自动学习 ${new Date(stats.last_auto_learned_at).toLocaleString()}`
    : "";
  dictionaryStats.textContent = `个人词典 ${stats.total} 条，已启用 ${stats.enabled} 条；自动学习 ${stats.auto_learned} 条${learnedLabel}；纠错词 ${stats.replacements} 条，常用词 ${stats.terms} 条；系统基础词库启用 ${stats.system_enabled_terms}/${stats.system_terms} 条。`;
  renderSystemLexiconControls();

  const query = dictionarySearchInput.value.trim().toLocaleLowerCase();
  const visibleEntries = dictionaryView.entries.filter((entry) => {
    if (!query) {
      return true;
    }
    return [entry.term, entry.replacement, ...(entry.aliases ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });

  if (visibleEntries.length === 0) {
    dictionaryList.innerHTML = `<div class="dictionary-empty">还没有匹配的词条。可以先点上方“添加常用词”，例如客户姓名、产品名、项目名。</div>`;
    return;
  }

  const sourceRank = { auto_learned: 0, manual: 1, import: 2, legacy: 3 };
  dictionaryList.innerHTML = visibleEntries
    .sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9) || a.term.localeCompare(b.term, "zh-CN"))
    .map((entry) => {
      const aliasText = (entry.aliases ?? []).join("、") || "常用词保护";
      const kindLabel = entry.kind === "replacement" ? "纠错词" : "常用词";
      const sourceLabel = entry.source === "auto_learned" ? "自动学习"
        : entry.source === "import" ? "批量导入"
          : entry.source === "legacy" ? "旧版迁移"
            : "手动添加";
      const learnedText = entry.source === "auto_learned"
        ? ` · 命中 ${entry.learned_count ?? 1} 次`
        : "";
      return `
        <article class="dictionary-item" data-id="${escapeHtml(entry.id)}">
          <div class="dictionary-item-main">
            <div class="dictionary-item-title">
              <strong>${escapeHtml(entry.term)}</strong>
              <span class="dictionary-kind">${kindLabel}</span>
              <span class="dictionary-kind" data-source="${entry.source}">${sourceLabel}</span>
              <span class="dictionary-kind" data-enabled="${entry.enabled ? "true" : "false"}">${entry.enabled ? "已启用" : "已停用"}</span>
            </div>
            <div class="dictionary-item-meta">${escapeHtml(aliasText)}${learnedText}</div>
          </div>
          <div class="dictionary-item-actions">
            <button type="button" class="settings-secondary-button" data-action="toggle">${entry.enabled ? "停用" : "启用"}</button>
            ${entry.source === "auto_learned" ? `<button type="button" class="settings-secondary-button" data-action="promote">转为手动词</button>` : ""}
            <button type="button" class="settings-secondary-button" data-action="edit">编辑</button>
            <button type="button" class="settings-secondary-button" data-action="delete">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSystemLexiconControls() {
  if (!dictionaryView) {
    return;
  }

  systemLexiconToggle.checked = Boolean(dictionaryView.system_lexicon_enabled);
  systemLexiconDescription.textContent = dictionaryView.system_lexicon_enabled
    ? "系统基础词库为只读词库，仅用于术语保护和润写保留，不会上传，不会强制替换原文。"
    : "系统基础词库已关闭；个人词典仍会继续生效。";

  systemLexiconCategories.innerHTML = (dictionaryView.system_categories ?? [])
    .map((item) => `
      <label class="system-lexicon-category" title="${escapeHtml(item.category)}">
        <input type="checkbox" data-category="${escapeHtml(item.category)}" ${item.enabled ? "checked" : ""} ${dictionaryView.system_lexicon_enabled ? "" : "disabled"} />
        <span>${escapeHtml(item.category)}</span>
        <em>${item.count}</em>
      </label>
    `)
    .join("");
}

function openDictionaryEditor(entry = null, mode = "term") {
  activeDictionaryEntryId = entry?.id ?? null;
  dictionaryEditorMode = entry?.kind ?? mode;
  dictionaryTermInput.value = entry?.term ?? "";
  dictionaryAliasInput.value = (entry?.aliases ?? []).join("，");
  const isReplacement = dictionaryEditorMode === "replacement";
  dictionaryEditorTitle.textContent = activeDictionaryEntryId
    ? "编辑词条"
    : (isReplacement ? "添加纠错词" : "添加常用词");
  dictionaryEditorHelp.textContent = isReplacement
    ? "把经常听错的说法填到下面，例如“迷你麦克斯”，正确词填 MiniMax。"
    : "保存人名、品牌、项目名、专业词，润写和翻译时会尽量保留。";
  dictionaryAliasInput.placeholder = isReplacement
    ? "可能识别错的词，例如：迷你麦克斯；多个用逗号隔开"
    : "可不填。也可以填别名，例如简称、旧称";
  dictionaryEditor.hidden = false;
  dictionaryTermInput.focus();
}

function closeDictionaryEditor() {
  activeDictionaryEntryId = null;
  dictionaryEditorMode = "term";
  dictionaryTermInput.value = "";
  dictionaryAliasInput.value = "";
  dictionaryEditor.hidden = true;
}

function collectDictionaryEntryFromEditor() {
  const aliases = dictionaryAliasInput.value
    .split(/[\n,，;；、]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
  const existing = dictionaryView?.entries?.find((entry) => entry.id === activeDictionaryEntryId);
  const term = dictionaryTermInput.value.trim();
  return {
    ...(existing ?? {}),
    id: activeDictionaryEntryId ?? undefined,
    kind: dictionaryEditorMode === "replacement" || aliases.length > 0 ? "replacement" : "term",
    term,
    replacement: term,
    aliases,
    enabled: existing?.enabled ?? true,
    source: existing?.source ?? "manual",
  };
}

function renderDictionaryPreview(preview) {
  pendingDictionaryImportPreview = preview;
  dictionaryConfirmImportButton.disabled = preview.summary.added + preview.summary.updated === 0;
  const summary = preview.summary;
  const warnings = preview.warnings.length
    ? `<div class="dictionary-preview-warning">${preview.warnings.map(escapeHtml).join("<br />")}</div>`
    : "";
  const sampleRows = preview.items
    .slice(0, 8)
    .map((item) => {
      const label = item.status === "add" ? "新增"
        : item.status === "update" ? "更新"
          : item.status === "duplicate" ? "重复"
            : item.status === "too_long" ? "超长"
              : "无效";
      const text = item.entry
        ? `${item.entry.kind === "replacement" ? (item.entry.aliases ?? []).join("、") + " -> " : ""}${item.entry.term}`
        : item.raw;
      return `<div class="dictionary-preview-row" data-status="${item.status}"><span>${label}</span><strong>${escapeHtml(text)}</strong></div>`;
    })
    .join("");

  dictionaryPreview.innerHTML = `
    ${warnings}
    <div class="dictionary-preview-summary">
      ${escapeHtml(preview.source_name)}：新增 ${summary.added}，更新 ${summary.updated}，重复 ${summary.duplicate}，无效 ${summary.invalid}，超长 ${summary.too_long}。
    </div>
    <div class="dictionary-preview-rows">${sampleRows}</div>
  `;
}

async function saveDictionaryEntryFromEditor() {
  const entry = collectDictionaryEntryFromEditor();
  if (!entry.term) {
    setStatus("请先填写正确词。", "error");
    return;
  }

  try {
    dictionaryView = await electronAPI.saveDictionaryEntry(entry);
    renderDictionaryView();
    closeDictionaryEditor();
    setStatus("个人词典已保存。");
  } catch (error) {
    setStatus(error?.message || "词条保存失败。", "error");
  }
}

async function handleDictionaryListAction(event) {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".dictionary-item");
  if (!button || !item || !dictionaryView) {
    return;
  }

  const entry = dictionaryView.entries.find((value) => value.id === item.dataset.id);
  if (!entry) {
    return;
  }

  const action = button.dataset.action;
  try {
    if (action === "edit") {
      openDictionaryEditor(entry);
      return;
    }
    if (action === "toggle") {
      dictionaryView = await electronAPI.setDictionaryEntryEnabled(entry.id, !entry.enabled);
      renderDictionaryView();
      setStatus(entry.enabled ? "词条已停用。" : "词条已启用。");
      return;
    }
    if (action === "promote") {
      dictionaryView = await electronAPI.promoteAutoLearnedDictionaryEntry(entry.id);
      renderDictionaryView();
      setStatus("已转为手动词，后续不会被自动学习策略覆盖。");
      return;
    }
    if (action === "delete") {
      dictionaryView = await electronAPI.deleteDictionaryEntry(entry.id);
      renderDictionaryView();
      setStatus("词条已删除。");
    }
  } catch (error) {
    setStatus(error?.message || "词典操作失败。", "error");
  }
}

async function previewPastedDictionary() {
  const content = dictionaryPasteInput.value.trim();
  if (!content) {
    setStatus("请先粘贴要导入的词。", "error");
    return;
  }

  try {
    const preview = await electronAPI.previewDictionaryImport({ content });
    renderDictionaryPreview(preview);
    setStatus("导入预览已生成，确认后才会写入。");
  } catch (error) {
    setStatus(error?.message || "导入预览失败。", "error");
  }
}

async function previewDictionaryFile() {
  try {
    const preview = await electronAPI.selectDictionaryImportFile();
    if (!preview) {
      return;
    }
    renderDictionaryPreview(preview);
    setStatus("文件导入预览已生成，确认后才会写入。");
  } catch (error) {
    setStatus(error?.message || "文件导入失败。", "error");
  }
}

async function confirmDictionaryImport() {
  if (!pendingDictionaryImportPreview) {
    return;
  }

  try {
    dictionaryView = await electronAPI.commitDictionaryImport(pendingDictionaryImportPreview);
    pendingDictionaryImportPreview = null;
    dictionaryConfirmImportButton.disabled = true;
    dictionaryPreview.innerHTML = "";
    dictionaryPasteInput.value = "";
    renderDictionaryView();
    setStatus("词典导入已完成。");
  } catch (error) {
    setStatus(error?.message || "确认导入失败。", "error");
  }
}

async function exportDictionary() {
  try {
    const result = await electronAPI.exportDictionary();
    if (result.ok) {
      setStatus(`个人词典已导出：${result.path}`);
    }
  } catch (error) {
    setStatus(error?.message || "导出失败。", "error");
  }
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
  await loadDictionaryView();
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
  voiceFormattingToggle,
  autoLearningToggle,
  computeBackendSelect,
  translationTargetLanguageSelect,
  rewriteScenarioSelect,
  llmEnabledToggle,
  llmProviderSelect,
]) {
  element.addEventListener("change", () => {
    if (element === llmEnabledToggle) {
      setVisible(llmConfigPanel, llmEnabledToggle.checked);
    }
    updateLlmActiveRoute(collectSettings());
    cancelScheduledSave();
    void persistSettings();
  });
}

for (const element of [modelPathTextarea]) {
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
    updateLlmActiveRoute(collectSettings());
    schedulePersistSettings();
  });
}

dictionarySearchInput.addEventListener("input", renderDictionaryView);
dictionaryList.addEventListener("click", (event) => {
  void handleDictionaryListAction(event);
});
dictionaryAddTermButton.addEventListener("click", () => openDictionaryEditor(null, "term"));
dictionaryAddReplacementButton.addEventListener("click", () => openDictionaryEditor(null, "replacement"));
dictionaryShowImportButton.addEventListener("click", () => {
  dictionaryPasteInput.focus();
});
dictionaryCancelEntryButton.addEventListener("click", closeDictionaryEditor);
dictionarySaveEntryButton.addEventListener("click", () => {
  void saveDictionaryEntryFromEditor();
});
dictionaryPreviewPasteButton.addEventListener("click", () => {
  void previewPastedDictionary();
});
dictionaryImportFileButton.addEventListener("click", () => {
  void previewDictionaryFile();
});
dictionaryConfirmImportButton.addEventListener("click", () => {
  void confirmDictionaryImport();
});
dictionaryExportButton.addEventListener("click", () => {
  void exportDictionary();
});
systemLexiconToggle.addEventListener("change", async () => {
  try {
    dictionaryView = await electronAPI.setSystemLexiconEnabled(systemLexiconToggle.checked);
    renderDictionaryView();
    setStatus(systemLexiconToggle.checked ? "系统基础词库已启用。" : "系统基础词库已关闭，个人词典仍然生效。");
  } catch (error) {
    setStatus(error?.message || "系统基础词库设置失败。", "error");
    await loadDictionaryView();
  }
});
systemLexiconCategories.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[data-category]");
  if (!checkbox) {
    return;
  }

  try {
    dictionaryView = await electronAPI.setSystemLexiconCategoryEnabled(checkbox.dataset.category, checkbox.checked);
    renderDictionaryView();
    setStatus(`${checkbox.dataset.category} 词库已${checkbox.checked ? "启用" : "关闭"}。`);
  } catch (error) {
    setStatus(error?.message || "系统词库分类设置失败。", "error");
    await loadDictionaryView();
  }
});
dictionaryHelpButton.addEventListener("click", () => {
  dictionaryHelpDialog.showModal();
});
dictionaryHelpCloseButton.addEventListener("click", () => {
  dictionaryHelpDialog.close();
});
dictionaryCopyExampleButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dictionaryHelpExample.value);
    setStatus("导入示例已复制。");
  } catch (_) {
    setStatus("复制失败，可以手动选择示例内容。", "error");
  }
});

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
