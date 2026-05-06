# Offline Translation Hotkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second global hotkey that records speech, transcribes Mandarin locally, translates it offline into the selected target language, and pastes the translated text back into the previous input field.

**Architecture:** Keep the existing local ASR flow unchanged for normal dictation and add a parallel translation mode that only runs in non-streaming mode. Run translation in a dedicated worker-backed engine so model loading and inference do not block the Electron main process, and map each supported target language to a specific offline model.

**Tech Stack:** Electron, TypeScript, worker_threads, existing local ASR pipeline, local Hugging Face translation models via a Node-compatible runtime

---

### Task 1: Persist translation settings

**Files:**
- Modify: `electron/types.ts`
- Modify: `electron/settings-store.ts`
- Test: `test/settings-store.test.js`

- [ ] Add translation settings fields to the `Settings` type: translation hotkey, target language, and optional per-language model override slots if needed for internal routing.
- [ ] Extend default settings with a disabled-safe translation hotkey and a default target language of English.
- [ ] Update settings-store tests to verify defaults persist and legacy settings files still load without translation fields.

### Task 2: Expose translation controls in settings UI

**Files:**
- Modify: `src/settings/index.html`
- Modify: `src/settings/settings.js`

- [ ] Add a second hotkey selector for translation input next to the existing dictation hotkey.
- [ ] Add a target-language selector with English, Japanese, German, and Cantonese marked experimental.
- [ ] Add UI copy that translation only supports Chinese-to-target and only runs in non-streaming mode.
- [ ] Wire the new fields into hydrate/save logic without breaking the existing auto-save behavior.

### Task 3: Support multiple global shortcuts

**Files:**
- Modify: `electron/shortcut-manager.ts`
- Modify: `electron/main.ts`

- [ ] Refactor shortcut registration so the app can register separate handlers for dictation and translation without one unregistering the other.
- [ ] Reject duplicate hotkey assignments cleanly and surface a stable fallback behavior in settings if registration fails.
- [ ] Track the active capture intent for each recording session so stop actions resume the correct downstream path.

### Task 4: Add translation session state and status rendering

**Files:**
- Modify: `electron/types.ts`
- Modify: `electron/state-machine.ts`
- Modify: `src/overlay/overlay.js`
- Modify: `src/shared/base.css`

- [ ] Add a `translating` runtime status distinct from `transcribing`.
- [ ] Update overlay state handling and motion so the user can distinguish ASR from translation.
- [ ] Ensure session state resets correctly on cancel, empty transcript, and translation failure.

### Task 5: Add offline translation model registry

**Files:**
- Create: `electron/translation-model-registry.ts`
- Modify: `electron/types.ts` if a shared language enum/type is needed

- [ ] Define supported target languages and the exact model ID for each:
- [ ] English: `Helsinki-NLP/opus-mt-zh-en`
- [ ] Japanese: `Helsinki-NLP/opus-mt-tc-big-zh-ja`
- [ ] German: `Helsinki-NLP/opus-mt-zh-de`
- [ ] Cantonese (experimental): `hou000123/zh2yue-translation`
- [ ] Define cache directory layout under the app data directory and status helpers for missing, downloading, ready, and failed models.

### Task 6: Add worker-backed translation engine

**Files:**
- Create: `electron/translation-engine.ts`
- Create: `electron/translation-worker.ts`
- Modify: `package.json`

- [ ] Add the local runtime dependency needed to execute offline translation models from Node/Electron.
- [ ] Implement a translation engine that lazily starts a worker, sends translation requests, and returns translated text.
- [ ] Keep model loading inside the worker and reuse loaded pipelines across requests to avoid repeated cold starts.
- [ ] Log inference errors with enough model/language context to debug model failures.

### Task 7: Integrate translation into the existing transcription completion path

**Files:**
- Modify: `electron/main.ts`

- [ ] Branch the non-streaming completion flow by session intent: dictation stays unchanged, translation performs `ASR -> offline MT -> clipboard -> optional auto-paste`.
- [ ] Block translation mode when recognition mode is `streaming_output` and fail early with a clear status instead of partial behavior.
- [ ] Preserve the current clipboard-first behavior so translated text is still available even if auto-paste fails.
- [ ] Do not auto-paste the original Chinese transcript when translation fails.

### Task 8: Add targeted tests and verification

**Files:**
- Modify: `test/settings-store.test.js`
- Create or modify: translation-related tests under `test/`

- [ ] Add coverage for translation setting persistence and supported-language UI presence.
- [ ] Add unit coverage for model registry routing and unsupported-mode guards.
- [ ] Add focused main-flow tests around translation success and translation failure behavior if the existing test harness permits mocking the translation engine.
- [ ] Run the Electron TypeScript build and the test suite.

### Task 9: Document residual risks

**Files:**
- Modify: `BUILD.md` only if local translation runtime setup needs explicit build notes

- [ ] Document the first-run model download/cache behavior if the chosen runtime does not allow fully bundled models in v1.
- [ ] Record that Cantonese quality is experimental and may need later model replacement.
- [ ] Record any packaging implications if the new runtime requires extra unpack rules.
