const electronAPI = window.electronAPI;

const hudEl = document.querySelector(".hud");
const waveformEl = document.querySelector("#waveform");
const recordingShellEl = document.querySelector("#recording-shell");
const thinkingShellEl = document.querySelector("#thinking-shell");
const stopShellEl = document.querySelector("#stop-shell");
const thinkingLabelEl = document.querySelector("#thinking-label");
const stopLabelEl = document.querySelector("#stop-label");
const MORPH_STATES = new Set(["recording", "transcribing", "translating", "stopped"]);
const VISIBLE_STATES = new Set(["recording", "transcribing", "translating", "stopped"]);
const EXIT_HOLD_MS = 150;
let animationTick = 0;
let exitTimer = null;
let lastVisibleState = "recording";
let unsubscribeSnapshot = null;

function renderWaveform(levels) {
  waveformEl.replaceChildren();

  const values = Array.isArray(levels) && levels.length > 0
    ? levels
    : [0.22, 0.38, 0.58, 0.84, 1.0, 0.84, 0.58, 0.38, 0.22];

  for (const [index, level] of values.entries()) {
    const bar = document.createElement("span");
    bar.className = "waveform-bar";
    bar.style.setProperty("--level", String(level));
    bar.style.setProperty("--delay", `${index * 42}ms`);
    bar.style.setProperty("--duration", `${640 + ((index % 4) * 80)}ms`);
    waveformEl.append(bar);
  }
}

function applyState(snapshot) {
  const previousState = hudEl.dataset.state;
  const nextState = snapshot.status;
  const nextVisible = VISIBLE_STATES.has(nextState);
  const previousVisible = VISIBLE_STATES.has(previousState);

  if (nextVisible) {
    if (exitTimer) {
      window.clearTimeout(exitTimer);
      exitTimer = null;
    }
    delete hudEl.dataset.exiting;
    hudEl.dataset.state = nextState;
  } else if (previousVisible) {
    hudEl.dataset.exiting = "true";
    hudEl.dataset.state = previousState;
    if (exitTimer) {
      window.clearTimeout(exitTimer);
    }
    exitTimer = window.setTimeout(() => {
      delete hudEl.dataset.exiting;
      hudEl.dataset.state = nextState;
      exitTimer = null;
    }, EXIT_HOLD_MS);
  } else {
    delete hudEl.dataset.exiting;
    hudEl.dataset.state = nextState;
  }

  hudEl.dataset.morphing = String(
    MORPH_STATES.has(previousState) && MORPH_STATES.has(nextState) && previousState !== nextState
  );

  const enteringVisibleState =
    (previousState === "idle" || previousState === "done") &&
    VISIBLE_STATES.has(nextState);
  if (enteringVisibleState) {
    animationTick += 1;
    hudEl.dataset.pop = String(animationTick);
  }

  if (nextVisible) {
    lastVisibleState = nextState;
  }

  const activeState = nextVisible ? nextState : lastVisibleState;
  const recording = activeState === "recording";
  const thinking = activeState === "transcribing" || activeState === "translating";
  const stopped = activeState === "stopped";

  recordingShellEl.hidden = !recording;
  thinkingShellEl.hidden = !thinking;
  stopShellEl.hidden = !stopped;

  recordingShellEl.setAttribute("aria-hidden", String(!recording));
  thinkingShellEl.setAttribute("aria-hidden", String(!thinking));
  stopShellEl.setAttribute("aria-hidden", String(!stopped));
  if (thinkingLabelEl) {
    thinkingLabelEl.textContent = snapshot.detail || (activeState === "translating" ? "Translating" : "Transcribing");
  }
  if (stopLabelEl) {
    stopLabelEl.textContent = snapshot.detail || "Stop";
  }

  if (recording) {
    renderWaveform(snapshot.waveform);
  } else if (thinking) {
    renderWaveform([]);
  }
}

function resetToIdle() {
  if (exitTimer) {
    window.clearTimeout(exitTimer);
    exitTimer = null;
  }
  delete hudEl.dataset.exiting;
  hudEl.dataset.state = "idle";
  recordingShellEl.hidden = true;
  thinkingShellEl.hidden = true;
  stopShellEl.hidden = true;
}

renderWaveform([]);
unsubscribeSnapshot = electronAPI.subscribeSnapshot((snapshot) => {
  try {
    applyState(snapshot);
  } catch (_error) {
    resetToIdle();
  }
});

window.addEventListener("beforeunload", () => {
  unsubscribeSnapshot?.();
});
