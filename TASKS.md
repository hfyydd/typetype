# Desktop Translation & Packaging Tasks

## Source Requirements

- User reported that the packaged application does not output text after installation (though it works fine in development mode).
- User reported current desktop usability issues around translation, hotkeys, settings apply flow, and launch-at-login.

## Current Implementation Status

- Packaging configuration is missing `asarUnpack` for platform-specific macOS sherpa-onnx libraries, causing ASR crash on startup in the packaged app.
- Desktop currently supports translation through a `transformers.js`-based NLLB pipeline.

## Known Gaps

- ASR platform-specific native dependencies (sherpa-onnx-darwin-arm64, sherpa-onnx-darwin-x64) are not unpacked in the ASAR archive, causing `Napi::Error` crashes.
- Streaming dictation/translation usability is currently broken or incomplete.
- Non-streaming translation path is reported as not functioning in the app.
- `Alt + .` is reported as unreliable for triggering translation.
- Settings currently auto-save; user requested an explicit Apply/Save button.
- Launch-at-login behavior needs runtime verification.

## Acceptance Criteria

- Packaged macOS app runs and initializes ASR successfully without any native crash.
- Voice input/translation hotkey flows work in both supported modes, or unsupported combinations are clearly disabled in UI.
- Settings page exposes an explicit Apply action for shortcut/language changes.
- Launch-at-login behavior is re-verified.

## Prioritized Todo

- [x] Unpack `sherpa-onnx-darwin-arm64` and `sherpa-onnx-darwin-x64` in `package.json` `asarUnpack` config.
- [x] Update `test/package-config.test.js` to assert the new `asarUnpack` entries.
- [x] Run automated tests to verify configuration and code correctness.
- [x] Build the packaged macOS app and run it to verify ASR starts and functions correctly.
- [x] Add `NSMicrophoneUsageDescription` in `package.json` to request macOS microphone permissions.
- [x] Correct the PATH env variable in `main.ts` so packaged GUI apps can spawn Homebrew's `sox`.
- [x] Fix ASR model download decompression TypeError: bits is not a function in `electron/asr-bootstrap.ts`.
- [x] Automate force-install of `sherpa-onnx-darwin-arm64` and `sherpa-onnx-darwin-x64` in `package.json` build scripts to ensure multi-arch packaging works.
- [x] Explicitly check and request system permissions (Accessibility, Microphone) on startup on macOS.
- [x] Bump version to `0.3.4` in `package.json`.
- [x] Package the app for Intel macOS (x64 DMG).
- [x] Copy the packaged Intel DMG to Desktop.
- [ ] Investigate and fix broken non-streaming translation flow.
- [ ] Investigate and fix `Alt + .` hotkey reliability.
- [ ] Decide and implement supported behavior for streaming translation.
- [ ] Add explicit Apply/Save button in settings and stop relying only on auto-save.
- [ ] Verify launch-at-login behavior after recent settings changes.

## Execution Log

- 2026-06-09 Round 7: Added startup permission check and request logic for macOS Accessibility and Microphone using Electron's `systemPreferences` API. Bumped application version to `0.3.4` in `package.json` and `package-lock.json`. Packaged the application for Intel macOS (x64 architecture) using `npm run build -- --x64`, creating `release/typetype-0.3.4.dmg`. Copied the packaged DMG file to the user's Desktop.
- 2026-06-09 Round 6: Bumped application version to `0.3.3` in `package.json` and `package-lock.json`. Packaged the application for Intel macOS (x64 architecture) using `npm run build -- --x64`, creating `release/typetype-0.3.3.dmg`. Copied the packaged DMG file to the user's Desktop.
- 2026-06-09 Round 5: Fixed model download decompression failure (`TypeError: bits is not a function`) in `electron/asr-bootstrap.ts` by using `bzip2.simple(bzip2.array(fileContent))`. Updated `electron/bzip2.d.ts` types. Added high-fidelity integration test. Automated force-installation of platform-specific native dependencies (`sherpa-onnx-darwin-x64`/`sherpa-onnx-darwin-arm64`/`sherpa-onnx-win-x64`) in `package.json` build scripts to prevent missing native binaries when packaging cross-architecture or cross-platform applications. All 115 tests passed.
- 2026-06-07 Round 4: Solved macOS packaged GUI app PATH issue where `sox` could not be found due to Finder (`launchd`) launching GUI apps with a minimal PATH. Added PATH correction logic to `main.ts` to append `/opt/homebrew/bin` and `/usr/local/bin`, and rebuilt/copied the DMG.
- 2026-06-07 Round 3: Identified and fixed missing `NSMicrophoneUsageDescription` in `package.json`'s `mac.extendInfo` config to correctly prompt for macOS microphone permission in the packaged app. Added unit tests to assert the description is present.
- 2026-06-07 Round 2: Diagnosed ASR crash in packaged macOS app due to missing asarUnpack configuration for platform-specific sherpa-onnx binaries and C++ async worker crash bug in createAsync. Added native dependencies to asarUnpack config, updated test assertions, changed OfflineRecognizer instantiation to synchronous to prevent crash, and built/verified the DMG package. All tests passed.
- 2026-04-30 Round 1: User reported six current usability issues across streaming, translation, hotkeys, settings apply flow, and launch-at-login verification. Priorities captured for follow-up.

## Blockers

- None currently recorded for the remaining desktop usability fixes.


- [x] Fix settings window freeze when switching options on Intel Macs (and main-thread block on Apple Silicon).

## Round 8 Notes — 2026-06-10

Root cause: `saveSettings` in `electron/main.ts` always tore down the ASR engine
(`this.asrEngine = null`) and called `primeAsrEngine()` on every settings save,
even for keys that have zero impact on recognition (auto_paste, hotkeys, LLM
config, etc.). `primeAsrEngine()` runs `new sherpaOnnx.OfflineRecognizer(config)`
in `electron/asr-engine.ts`, which is **synchronous C++ native code** that
blocks the main process event loop while it reads model files and builds the
ONNX session. On Intel Macs (no ANE, slower I/O) the block is several seconds
and the settings window appears frozen; on M-series the same block is shorter
but the renderer still queues its follow-up IPCs (the redundant
`refreshSettingsView()` after every save) behind it.

Changes in this round:

- Added `electron/settings-diff.ts` exposing the pure function
  `isAsrSettingsRelevantChange(previous, next)`. The key list is
  `recognition_mode`, `streaming_model`, `voice_package`, `compute_backend`,
  `model_path`, `pinned_model_version` — every other field is treated as
  recognizer-independent. Covered by `test/settings-diff.test.js` (14 cases).
- `saveSettings` in `electron/main.ts` now captures the previous settings,
  runs the diff, and only enqueues an engine reset (via `setImmediate`) when
  an ASR-relevant key actually changed. The IPC response is returned before
  the heavy `OfflineRecognizer` constructor runs, so the renderer can update
  the UI and the user sees the warming preload status instead of a frozen
  window.
- `persistSettings` in `src/settings/settings.js` no longer calls
  `refreshSettingsView()` after `saveSettings` resolves. The main process
  already pushes the new view through `subscribeSettingsViewData`, so the
  two extra IPC roundtrips (`getSettingsViewData` + `getDictionaryViewData`)
  per option change are eliminated. Initial load and explicit "ASR
  diagnostics" refresh paths still call `refreshSettingsView()` as before.

Verification:

- `node --test 'test/*.test.js'` → 129 pass / 0 fail (including 14 new
  diff cases).
- `npm run build:electron` → clean TypeScript compile, no new warnings.
- Manual verification path: package the app and exercise the settings
  panel on both Intel and Apple Silicon hardware. The fix targets the
  known regression; real-hardware measurement was not performed in this
  session.

Risks / follow-ups:

- The `setImmediate` deferral is a best-effort handoff: if the renderer
  dispatches another IPC during the same event loop iteration, it can
  still race the recognizer construction. The expected impact is small
  (microsecond-level scheduling jitter vs. multi-second model load) and
  acceptable for the common case.
- We did not move the recognizer construction off the main thread.
  A worker-thread shim for sherpa-onnx would let us fully decouple the
  IPC response from the model load; that is a larger refactor and out of
  scope here.
- Settings that *do* require an engine reset (recognition mode, voice
  package, etc.) will still cause a brief freeze while the model reloads.
  The user now sees the warming preload status during that window, which
  is the right UX hint.
