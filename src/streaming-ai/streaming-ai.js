const electronAPI = window.electronAPI;

const statusCard = document.querySelector("#status-card");
const statusTitle = document.querySelector("#status-title");
const statusText = document.querySelector("#status-text");
const statusMeta = document.querySelector("#status-meta");
const rawText = document.querySelector("#raw-text");
const aiText = document.querySelector("#ai-text");
const rawCount = document.querySelector("#raw-count");
const aiCount = document.querySelector("#ai-count");
const scenarioSelect = document.querySelector("#streaming-scenario-select");
const copyRawButton = document.querySelector("#copy-raw-button");
const copyAiButton = document.querySelector("#copy-ai-button");
const clearButton = document.querySelector("#clear-button");
const applyRefinedRawButton = document.querySelector("#apply-refined-raw-button");
const applyAiButton = document.querySelector("#apply-ai-button");

function statusTitleFor(status) {
  switch (status) {
    case "recording":
      return "正在记录";
    case "thinking":
      return "AI 整理中";
    case "ready":
      return "整理稿已更新";
    case "error":
      return "AI 整理不可用";
    default:
      return "等待录音";
  }
}

function toneFor(status) {
  if (status === "error") {
    return "error";
  }
  if (status === "ready" || status === "recording") {
    return "success";
  }
  if (status === "thinking") {
    return "thinking";
  }
  return "";
}

function renderText(element, value, placeholder) {
  const text = value?.trim() ? value : placeholder;
  element.textContent = text;
  element.classList.toggle("empty", !value?.trim());
}

function render(state) {
  statusCard.dataset.tone = toneFor(state.status);
  statusTitle.textContent = statusTitleFor(state.status);
  const errorSuffix = state.last_error ? `\n${state.last_error}` : "";
  statusText.textContent = `${state.status_text || "等待录音。"}${errorSuffix}`;
  const reviewText = state.last_review_at
    ? `最近整理：${new Date(state.last_review_at).toLocaleTimeString()}`
    : "尚未整理";
  const applyText = state.apply_status_text ? ` · ${state.apply_status_text}` : "";
  statusMeta.textContent = `${state.mode_label || "流式模式"} · ${state.rewrite_scenario_label || "通用整理"} · ${state.ai_status_label || "等待"} · ${reviewText}${applyText}`;

  const refinedRaw = state.refined_raw_text?.trim() ? state.refined_raw_text : state.raw_text;
  renderText(rawText, refinedRaw, "等待 AI 修正原文…");
  renderText(aiText, state.ai_text, "检测到停顿后，会在这里生成纠错稿或会议纪要草稿。");
  if (scenarioSelect && state.rewrite_scenario && scenarioSelect.value !== state.rewrite_scenario) {
    scenarioSelect.value = state.rewrite_scenario;
  }
  rawCount.textContent = `${refinedRaw?.length ?? 0} 字`;
  aiCount.textContent = `${state.ai_text?.length ?? 0} 字`;
  copyRawButton.disabled = !(refinedRaw?.trim());
  copyAiButton.disabled = !(state.ai_text?.trim());
  clearButton.disabled = !(refinedRaw?.trim() || state.ai_text?.trim());
  applyRefinedRawButton.disabled = !(state.can_apply_refined_raw && refinedRaw?.trim());
  applyAiButton.disabled = !(state.ai_text?.trim());
}

async function callAndRender(action) {
  try {
    const state = await action();
    render(state);
  } catch (error) {
    statusCard.dataset.tone = "error";
    statusTitle.textContent = "操作失败";
    statusText.textContent = error instanceof Error ? error.message : String(error);
  }
}

copyRawButton.addEventListener("click", () => {
  void callAndRender(() => electronAPI.copyStreamingAiRaw());
});

copyAiButton.addEventListener("click", () => {
  void callAndRender(() => electronAPI.copyStreamingAiSummary());
});

applyRefinedRawButton.addEventListener("click", () => {
  void callAndRender(() => electronAPI.applyStreamingAiRefinedRaw());
});

applyAiButton.addEventListener("click", () => {
  void callAndRender(() => electronAPI.applyStreamingAiSummary());
});

scenarioSelect.addEventListener("change", () => {
  void callAndRender(() => electronAPI.setStreamingAiScenario(scenarioSelect.value));
});

clearButton.addEventListener("click", () => {
  void callAndRender(() => electronAPI.clearStreamingAiPanel());
});

electronAPI.subscribeStreamingAiPanelState(render);

window.setInterval(() => {
  void electronAPI.getStreamingAiPanelState()
    .then(render)
    .catch(() => {
      // 事件推送失败时下一轮继续尝试，录音流程不受影响。
    });
}, 1000);
