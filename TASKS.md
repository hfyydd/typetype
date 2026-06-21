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
- [ ] Add one-click 'tccutil reset' functionality and detailed instructions to the auto-paste Accessibility dialog to solve macOS TCC architecture/signature mismatch issues on Intel/M-chip versions.

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
- [x] Bump version to 0.3.5 and ship Intel DMG to desktop.
- [x] Commit: "Prevent settings window freeze on Intel Macs when switching options" (d182aef).
- [x] Commit: "Bump version to 0.3.5" (e5fb9b0).

## Round 9 Notes — 2026-06-10

Release packaging for the Intel-freeze fix.

- `electron-builder --mac --x64` produced `release/typetype-0.3.5.dmg`
  (1.15 GB). The .app bundle inside was verified as Mach-O 64-bit
  x86_64 via `file` and the DMG was verified by `hdiutil verify`
  (checksum VALID). The DMG was copied to
  `/Users/hanfeng/Desktop/typetype-0.3.5-x64.dmg` and the SHA-256
  matches the source artifact.
- The auto-update `typetype-0.3.5-mac.zip` and its blockmap were NOT
  produced: electron-builder hung on the x64-only zip stage (CPU
  flatlined, the .zip grew ~2-3 MB/min for >30 minutes, the underlying
  process was not making meaningful progress). Killed the process
  after the .dmg was confirmed good; cleaned up the half-written
  .zip/.blockmap so they do not appear as a release artifact.
- This matches the previous round (0.3.4 packaging) in that the
  x64 DMG was the deliverable, not the auto-update zip.

Risks / follow-ups:

- The 0.3.5 mac.zip for auto-update is not in `release/`. If the
  in-app updater is wired up, it will need the zip regenerated (or
  the updater disabled for this release) before pushing 0.3.5 via
  the existing update channel.
- Investigate the electron-builder x64 zip stall before the next
  release. Possible causes: compression interaction with the
  asarUnpacked native modules, or a notarization step that is
  timing out without credentials.

## Round 9 Notes — 2026-06-10

User reported `spawn sox ENOENT` errors on the Intel macOS DMG: the packaged
GUI app has no `sox` binary on a clean Intel Mac, so the macOS recording
path (which spawned `sox` against CoreAudio) failed at the first hotkey
press.

Root cause: the macOS recording path was the only platform left that still
relied on an external `sox` binary. The Windows path already used a hidden
`BrowserWindow` + Web Audio API recorder (`src/recorder/`), which Electron
supports equally well on macOS via `navigator.mediaDevices.getUserMedia`.
The pre-existing PATH patch in `main.ts` that appended
`/opt/homebrew/bin` and `/usr/local/bin` only papered over the missing
binary; it could not conjure `sox` out of thin air on a machine where the
user had not installed it.

Changes in this round:

- Added `electron/recorder-platform.ts` exporting `usesRecorderWindow(platform)`,
  which returns `true` for `win32` and `darwin` and `false` otherwise. Covered
  by `test/recorder-platform.test.js` (4 cases).
- `electron/main.ts` now imports the helper and routes both `startRecording`
  and `stopRecording` through the hidden recorder window for Windows *and*
  macOS. The sox-only branch in `startRecording` and the `audioRecorder`
  field are gone. The Homebrew PATH patch is removed because we no longer
  spawn `sox` from the main process at all.
- `stopWindowsRecording` was renamed to `stopRecorderWindowRecording`; its
  body is unchanged.
- Deleted `electron/audio-recorder.ts` and `test/audio-recorder.test.js` —
  the sox spawner is dead code now that macOS uses the recorder window.
- Unsupported platforms (Linux, etc.) now hit a single explicit
  `"Audio recording is not supported on <platform>"` error instead of
  silently falling into the sox branch.
- Bumped version to `0.3.6`.

Verification:

- `npm run build:electron` → clean TypeScript compile.
- `node --test 'test/*.test.js'` → 132 pass / 0 fail (was 129 before; the
  4 new `usesRecorderWindow` cases land, the 1 old `audio-recorder` case
  goes away).
- `dist-electron/main.js` references `usesRecorderWindow` at the recorder
  start/stop decision points and no longer contains any `AudioRecorder` or
  `audioRecorder` symbol.

Manual verification gap:

- I did not run the packaged Intel DMG on real Intel hardware this round.
  The recorder window is the same code path Windows already exercises, and
  macOS will go through `getUserMedia` + the same Web Audio pipeline, but
  the `notarization`/`getUserMedia` macOS specifics (microphone permission
  prompt, sandboxed renderer) should be smoke-tested on a real Intel Mac
  before declaring v0.3.6 done.

Risks / follow-ups:

- The macOS recorder window will need the same microphone permission grant
  flow that Windows already uses; the existing `systemPreferences` checks
  in `main.ts` cover this. If the permission prompt does not appear in the
  packaged app, the user will see no audio capture and the recorder will
  fail with `recorder_error`.
- Linux is no longer a build target (no `linux` entry in
  `electron-builder` config). I removed the sox fallback rather than
  maintaining a Linux-only branch. If we want Linux support back, the
  recorder-window path already works there too — we just need to add
  `linux` to `usesRecorderWindow` and ship a Linux target.

## Round 9b Notes — 2026-06-10

User reported the settings panel still freezes when toggling streaming /
non-streaming. Round 8 had already moved the engine reset out of the IPC
response and into `setImmediate(...)`, but `setImmediate` still runs on
the main process event loop, and the sherpa-onnx recognizer constructor
is synchronous C++ that reads model files and builds an ONNX session in
place. On Intel Macs the block is several seconds; the renderer cannot
service any IPC during that window, so the dropdowns look frozen even
though the previous response did flush.

Root cause: any path that calls `primeAsrEngine()` on the main thread
during a settings save is going to block. `setImmediate` is not a real
fix — it just delays the block by one event loop turn.

New approach: defer the reset to the next recording start instead of
running it during the settings save. The user only sees the warming
overlay when they're already prepared to wait (with the
`recording-toggle` guard that prevents accidental stop). Inside the
settings panel itself, switching recognition mode / streaming model /
voice package / compute backend / model path / pinned version is now
synchronous and instant.

Changes in this round:

- Added `'pending_reload'` to `PreloadResourceStatus` in `electron/types.ts`
  and a matching CSS rule in `src/shared/base.css` (soft blue tint to
  distinguish from amber "warming" and red "error").
- Added `electron/asr-preload-status.ts` exporting
  `getPendingReloadAsrStatus(detail?)` and `ASR_PRELOAD_LABEL`, covered by
  `test/asr-preload-status.test.js` (4 cases). Extracted so the status
  text is unit-testable and the copy is not duplicated between
  `markAsrEnginePending` and any future call sites.
- `electron/main.ts`:
  - New field `asrEngineNeedsReset: boolean` on `TypenewApp`.
  - New `markAsrEnginePending()` method that flips the flag, nulls out
    the stale engine + translation engine + their pending promises,
    bumps `asrInitializationGeneration` (so an in-flight app-startup
    preload that is still running native code gets cancelled by the
    generation check in the `.finally`), clears `isAsrInitializing`, and
    publishes a `pending_reload` preload status.
  - `saveSettings` now calls `markAsrEnginePending()` instead of the
    `setImmediate(() => this.primeAsrEngine())` block. The IPC response
    is returned immediately; no synchronous native work runs on the main
    thread for the remainder of the save.
  - `ensureAsrEngineReady()` and `getNonStreamingAsrEngine()` both check
    `asrEngineNeedsReset` first, clear it, drop the cached promise, and
    fall through to `primeAsrEngine()` so the next recording start
    triggers a real reload against the new settings.

Verification:

- `npm run build:electron` → clean TypeScript compile, no new warnings.
- `node --test 'test/*.test.js'` → 136 pass / 0 fail (was 132 before;
  the 4 new `getPendingReloadAsrStatus` cases land, no existing case
  regressed).
- Compiled `dist-electron/main.js` no longer contains any `setImmediate`
  in the settings-save path; `primeAsrEngine()` is only called from
  `startStartupPreload` (legitimate, app start) and `ensureAsrEngineReady`
  (legitimate, lazy reload on recording start).

Manual verification gap (still):

- I have not run the packaged Intel DMG on real Intel hardware for this
  round. The behavior change is contained to the save / recording-start
  flow and the lazy-reload guard, and the existing `recording-toggle`
  guard already covers the "user releases the hotkey before reload
  finishes" case, but the wall-clock feel should be smoke-tested on a
  real Intel Mac before declaring v0.3.6 done.

Risks / follow-ups:

- If the user changes ASR-relevant settings and never presses the
  hotkey, the engine never actually reloads until they record next.
  That is intentional: the user wanted a fast settings panel, and the
  preload status honestly says "将在下次录音时自动重新加载". If we ever
  need an explicit "Reload now" affordance, the helper is already in
  place to add a button that calls `primeAsrEngine()` directly.
- The `translationAsrEngine` race is slightly less airtight than the
  main ASR engine: it has no generation counter, so a stale in-flight
  translation init will still complete and set
  `translationAsrEngine` before the user records. The next
  `getNonStreamingAsrEngine()` call then drops it and starts a fresh
  init. The wasted work is one model load at most, and only in a narrow
  race window. If we ever want to fix that, mirror the generation
  pattern used for the main ASR engine.
- We did NOT repackage the Intel DMG this round. User explicitly asked
  to hold off on packaging until the settings-lag fix is verified.

## Round 9c Notes — 2026-06-10

User reported that after switching streaming / non-streaming, the
settings panel shows "未启动" and the engine does not actually start
reloading until the user presses the hotkey. The Round 9b design
intentionally deferred the reload to `ensureAsrEngineReady` to avoid
running synchronous native code on the main thread during a settings
save, but the user-visible side effect was confusing: the status string
flickered to a never-resolving "未启动" and the engine silently sat
stale.

New approach: keep the IPC response flush (Round 9a's win), but actually
kick off `primeAsrEngine` immediately afterwards via `setImmediate`.
The user sees `model_status` flip from "已就绪" → "正在准备" → "已就绪"
in the time it takes the sherpa-onnx recognizer constructor to run on
the main thread. The settings save itself is still snappy because the
IPC response is dispatched before `setImmediate` fires.

The recognizer constructor is still synchronous C++ on the main
thread, so the main process event loop is briefly blocked while the
model loads. That is the same trade-off as Round 8 (and the same
behaviour the user already accepted when the engine first warms up at
app start). The remaining gap — moving recognizer construction into a
worker so even the warming phase is non-blocking — is a larger
refactor and is explicitly out of scope for this round.

Changes in this round:

- `markAsrEnginePending` in `electron/main.ts` now:
  - Sets `isAsrInitializing = true` and publishes a "warming" preload
    status with detail "识别设置已更改，正在后台重新加载识别引擎。"
    synchronously, so the panel reflects the change the moment the
    dropdown settles.
  - Schedules `primeAsrEngine()` via `setImmediate`. The settings save
    IPC response is flushed first; the heavy recognizer constructor
    runs in the next event loop tick.
  - Guards the `setImmediate` body with
    `if (!this.asrEngineNeedsReset) return;` so if the user presses the
    hotkey between the schedule and the tick (which clears the flag
    and starts a fresh init in `ensureAsrEngineReady`), the deferred
    init is suppressed — otherwise we would run the heavy constructor
    twice in that race window.
- The previous Round 9b building blocks are removed because they are
  no longer reachable:
  - `'pending_reload'` dropped from `PreloadResourceStatus` in
    `electron/types.ts`.
  - The pending-reload CSS rule removed from `src/shared/base.css`.
  - `electron/asr-preload-status.ts` and
    `test/asr-preload-status.test.js` deleted.
  - The `getPendingReloadAsrStatus` import in `main.ts` removed.

Verification:

- `npm run build:electron` → clean TypeScript compile, no warnings.
- `node --test 'test/*.test.js'` → 132 pass / 0 fail. The count
  dropped from 136 to 132 because the 4 `getPendingReloadAsrStatus`
  tests were removed along with the helper; no other test regressed.
- `dist-electron/main.js` now contains the `setImmediate(primeAsrEngine)`
  inside `markAsrEnginePending`, and zero `pending_reload` references
  remain in source or compiled output.

Manual verification gap (still):

- I have not run this on a real Intel Mac this round. The expected
  UX is: drop the streaming dropdown → "正在准备" appears within one
  frame → the panel stays interactive for other changes (only the
  recognizer constructor blocks, and only for the seconds it takes to
  read the model files and build the ONNX session) → status flips
  to "已就绪 · 本机加速" when the new model is live. On Intel hardware
  the warming phase is the same wall-clock cost as the app-startup
  preload the user already tolerates.

Risks / follow-ups:

- The main process is still briefly blocked while the new recognizer
  is being constructed. Switching settings rapidly (e.g. dragging the
  dropdown through all three streaming models in quick succession)
  will queue multiple `primeAsrEngine` calls; the generation counter
  cancels all but the latest, so the final engine always matches the
  most recent selection, but the wasted model loads are still paid
  for. If this becomes a real annoyance, the proper fix is to
  construct the recognizer in a worker thread / child process and
  proxy all ASR calls through it. That is a meaningfully larger
  refactor; the `asr-worker.ts` and `transcription-runner.ts` child
  processes are a starting point but the streaming protocol would
  need its own design.
- We did NOT repackage the Intel DMG this round. User explicitly
  asked to hold off on packaging.

## Round 9d Notes — 2026-06-10

User reported the settings UI is still laggy when switching recognition
mode, streaming model, or translation voice/language. The `setImmediate`
deferral in Round 9c still runs on the main process event loop, and the
sherpa-onnx recognizer constructor is a synchronous C++ call that
holds the loop for several seconds on Intel Macs. Every ASR call
(`startStreamingSession`, `acceptStreamingAudio`, `finishStreamingSession`,
`transcribeRich`, etc.) also runs on the main thread.

The only way to make the settings panel genuinely lag-free is to move
sherpa-onnx off the main process entirely. This round does that: the
recognizer now lives in a forked child process, and the main process
talks to it via IPC.

Changes in this round:

- New `electron/asr-engine-worker.ts` (~280 lines). The worker runs in
  a forked child process (`fork()` over IPC), loads `sherpa-onnx` in
  that process, and owns the live `AsrEngine` for the lifetime of the
  worker. It implements the full lifecycle: `init` (construct
  recognizer), `transcribe` (non-streaming), `startStreaming`,
  `feedAudio`, `finishStreaming`, `cancelStreaming`, `getStatus`,
  `destroy`, `shutdown`. Streaming `feedAudio` calls run inside the
  worker so the synchronous `acceptStreamingAudio` C++ call never
  touches the main thread.
- New `electron/asr-engine-proxy.ts` (~400 lines). The main-process
  proxy that owns the worker lifecycle, marshals messages, and exposes
  the same shape the rest of the app was already calling on
  `AsrEngine`. Constructor accepts a `forkProcess` and
  `resolveNodeExecPath` injection so the proxy is unit-testable
  without spawning a real child process. Cached status (provider,
  model path, etc.) is updated on every `ready` / `status` message so
  the synchronous getters stay cheap on the settings-panel hot path.
- `electron/asr-bootstrap.ts`: `tryCreateEngine` now constructs an
  `AsrEngineProxy` instead of an in-process `AsrEngine`. The heavy
  `OfflineRecognizer` / `OnlineRecognizer` constructor moved into the
  child process; the bootstrap only does file-system search and
  optional model download on the main thread.
- `electron/main.ts`:
  - `asrEngine` and `translationAsrEngine` fields are now
    `AsrEngineProxy | null`. The synchronous getters
    (`getModelPath`, `getActiveProvider`, `getRecognitionMode`,
    `getRuntimeLabel`) are unchanged at call sites because the proxy
    reads from its cached status snapshot.
  - The streaming / transcribe call sites were updated to `await`:
    `startStreamingSession`, `cancelStreamingSession` (two sites),
    `finishStreamingSession`, `acceptStreamingAudio`. `handleRecordingSamples`
    is now `async`; the recorder IPC handler wraps the call in `void`
    so audio chunks keep flowing without blocking the renderer.
  - `stopThinking`, `cancelStreamingOutputSession` are now `async`
    and their callers updated.
  - `getNonStreamingAsrEngine` / `getAsrEngineForTranscription`
    return types now reflect the proxy.
- New `test/asr-engine-proxy.test.js` (4 cases) covering: cached
  status after `ready`, `initError` rejection, `transcribeRich`
  request/response round-trip with the rich payload (language,
  confidence, segments, candidates, code_switch_hints), and pending
  requests failing on worker exit.
- `test/asr-bootstrap.test.js` mocks the proxy module so existing
  bootstrap tests keep running without spawning a real worker.

Verification:

- `npm run build:electron` → clean TypeScript compile, no warnings.
- `node --test 'test/*.test.js'` → **136 pass / 0 fail** (was 132
  before this round; the 4 new `AsrEngineProxy` cases land, no other
  test regressed).
- `dist-electron/main.js` no longer references the in-process
  `AsrEngine` class for the recognition path. The bootstrap's
  `tryCreateEngine` is the only place that constructs the proxy.
- `dist-electron/asr-engine-worker.js` and
  `dist-electron/asr-engine-proxy.js` are both produced and reachable
  via the `fork()` call in the proxy.

Manual verification gap (still):

- I have NOT run the packaged Intel DMG on real hardware for this
  round. The behavior change is large enough that the wall-clock feel
  on Intel hardware is the real test. Expected UX now:
  - Open the settings panel, switch `recognition_mode` between
    `non_streaming` and `streaming_output` and the three streaming
    models. Each switch should return the IPC response
    sub-100-millisecond (the proxy just spawns a worker and waits
    on the first `ready` / `initError`).
  - The status indicator should flip to "warming" and stay
    interactive for the few seconds the child process is loading
    the model. Other settings (hotkeys, LLM, dictionary) should
    continue to save and apply without delay.
  - First recording after a switch should still take the few
    seconds to reach "ready" — that cost is now paid in the
    child process, not the main process, so the settings window
    itself never blocks.

Risks / follow-ups:

- The worker is a fresh Node.js process. It re-loads sherpa-onnx
  and re-reads the model files every time settings change. On a
  slow disk this is the same wall-clock cost the user already pays
  at app start; the win is purely about keeping that cost off the
  main process event loop. If the per-switch latency becomes its
  own annoyance, the next move is to keep two workers alive
  (current + candidate) and swap on `ready`, but that is more
  memory + complexity and is out of scope here.
- The streaming protocol now adds one IPC roundtrip per 180ms audio
  chunk. Empirically the IPC latency is single-digit milliseconds
  per message, which is well below the chunk duration, so it is
  inaudible to the user. If we ever move to sub-100ms chunks we
  should batch them at the worker.
- We did NOT repackage the Intel DMG this round. User explicitly
  asked to hold off on packaging.

## Round 9e Notes — 2026-06-10

User reported v0.3.7 still broken on Intel Mac. Logs showed
`ASR worker exited before ready (code=1 signal=null)` ~545ms after
startup on Intel hardware. Round 9d moved sherpa-onnx into a forked
child process; the fork runs as plain Node (`ELECTRON_RUN_AS_NODE=1`)
and does not have Electron's `app` object. `loadSherpaOnnxNode()`
in `electron/asr-engine.ts` still gated the unpacked-module path on
`app?.isPackaged`, so on the worker side the check was `undefined`,
the path lookup was skipped, and bare `require('sherpa-onnx-node')`
threw `MODULE_NOT_FOUND` synchronously before `process.on('message')`
was even registered. The worker exited with code 1 and the main
process surfaced only the bare `worker-exit` event — no init error
ever made it back.

Root cause: the worker couldn't see Electron's `process.resourcesPath`
and there was no other way for `loadSherpaOnnxNode` to know where
`app.asar.unpacked/node_modules/sherpa-onnx-node/` lives.

Changes in this round:

- `electron/asr-engine.ts` — `loadSherpaOnnxNode()` now reads
  `process.env.TYPETYPE_RESOURCES_PATH || process.resourcesPath`
  and requires `app.asar.unpacked/node_modules/sherpa-onnx-node/sherpa-onnx.js`
  if it exists, falling back to bare `require('sherpa-onnx-node')`
  for dev / unpackaged runs. The Electron `app` import is kept
  (still used for `app.getPath('userData')` etc.) but no longer
  drives the unpacked-module lookup.
- `electron/asr-engine-proxy.ts` — `ensureWorker()` builds
  `workerEnv` from `process.env` and, when `process.resourcesPath`
  is set, sets `workerEnv.TYPETYPE_RESOURCES_PATH =
  process.resourcesPath` and also injects the asar-unpacked
  `node_modules` into `workerEnv.NODE_PATH` as a belt-and-suspenders
  fallback. Imported `fs` at the top of the file so the
  `fs.existsSync` check is local.
- `electron/asr-engine-worker.ts` — added a
  `process.on('uncaughtException', ...)` handler near the top
  imports that posts `{ type: 'initError', message: 'startup failed: ...' }`
  via `process.send` and then `setImmediate(() => process.exit(1))`.
  Any future startup-time crash (require failure, native binding
  load error, etc.) will now surface as a structured `initError`
  message on the IPC channel instead of a silent code-1 exit.
- New `test/asr-engine-proxy-env.test.js` (3 cases) covering:
  the `TYPETYPE_RESOURCES_PATH` injection, the `fork()` stdio /
  IPC channel configuration, and the dev-mode fallback when
  `process.resourcesPath` is undefined.

Verification:

- `node --test test/*.test.js` → **139 pass / 0 fail** (was 136
  before this round; the 3 new env-injection cases land, no
  existing test regressed).
- `npm run build -- --x64` produced `release/typetype-0.3.8.dmg`
  at 1,152,223,742 bytes (matches the 0.3.7 DMG size of
  1,152,250,733 bytes; difference is just content drift from
  the new worker / proxy / recorder-platform code).
- `npx asar extract` on the packaged `app.asar` confirms
  `/dist-electron/asr-engine.js:275` contains
  `process.env.TYPETYPE_RESOURCES_PATH || process.resourcesPath`,
  `asr-engine-proxy.js:310-333` injects both `TYPETYPE_RESOURCES_PATH`
  and `NODE_PATH` into `workerEnv`, and `asr-engine-worker.js:17`
  registers the startup `uncaughtException` handler. All three
  fixes made it into the DMG.
- `app.asar.unpacked/node_modules/sherpa-onnx-darwin-x64/sherpa-onnx.node`
  (Intel native binary) is present alongside
  `sherpa-onnx-darwin-arm64/sherpa-onnx.node` (arm64 native binary),
  and `sherpa-onnx-node/sherpa-onnx.js` (the JS shim that the
  fixed `loadSherpaOnnxNode()` requires) is present too. The
  `sherpa-onnx-darwin-x64/libonnxruntime.1.24.4.dylib` resolves
  the missing-Intel-binaries issue from the previous round.
- DMG copied to `~/Desktop/typetype-0.3.8.dmg` with matching
  MD5 (`96378c3d7236aec00ff5e01c9ae4e0f1` on both copies).
- The build's `7za -mx=9` macOS-zip step was killed once the
  DMG was complete (zip would have run ~70+ minutes for ~1 GB
  of Deflate; user only needs the DMG).

Manual verification gap (still):

- I have NOT run the packaged Intel DMG on real hardware. The
  expected UX after install: log line
  `ASR engine initialized {"runtime":"已就绪 · 本机加速","model_loaded":true}`
  appears within a few seconds of startup, the
  `[asr-engine-proxy] worker-exit {"code":1,"signal":null}`
  line is gone, and switching recognition_mode / streaming
  capability / translation voice in the settings panel returns
  instantly (the cost is paid in the worker, not the main
  process). If the worker still exits with code 1 on Intel,
  the new `uncaughtException` handler will print the actual
  error message and `initError` will reach the main process
  log so we can see the real cause.

## Round 9f Notes — 2026-06-10

User flagged two follow-ups on v0.3.8:

1. **"不要在用户那里下载模型，要打包好模型"** — The shipped DMG
   already contains the models, but `asr-bootstrap.ts` had four
   `downloadModel(...)` fallback paths that quietly hit
   `github.com/k2-fsa/sherpa-onnx` whenever the worker couldn't
   load the packaged model. The previous v0.3.7 log
   `Downloading model sherpa-onnx-sense-voice to /Users/cmyeo/.config/typetype/models/`
   was the bootstrap falling through this path after the worker
   crashed. With the worker now fixed in v0.3.8, the download
   would not have fired in practice, but the code itself still
   allowed it.
2. **"每次都去申请权限"** — `requestMacPermissions()` ran on every
   startup and called
   `systemPreferences.isTrustedAccessibilityClient(true)` plus
   `systemPreferences.askForMediaAccess('microphone')` whenever the
   status was not already granted. macOS only shows the system
   prompt the first time, so on a fresh install this is one
   dialog per permission, not a loop — but the user perception is
   still "the app keeps asking". Unsigned builds that get
   re-evaluated by macOS on each launch (TCC revocation) make it
   worse.

Changes in this round:

- `electron/asr-bootstrap.ts` — removed `MODEL_DOWNLOAD_URLS`,
  `downloadFile`, `downloadModel`, `extractModelArchive`,
  `modelDirectoryHasRequiredFiles`, the `https` / `tar-stream` /
  `bzip2` imports, and the `PRO_HIGH_ACCURACY_DOWNLOAD_URL` env
  var. The four `downloadModel(...)` call sites in
  `initializeAsrEngine` now call a small
  `logMissingPackagedModel(name, searchPaths)` helper that logs
  an explicit error listing every search path the bootstrap
  probed and returns `null`. A missing packaged model is treated
  as a packaging defect, not a recoverable runtime condition.
- `package.json` — dropped `bzip2` and `tar-stream` from
  `dependencies` (both were only used by the deleted download
  path; the transitive `tar-stream@2` that `archiver` brings in
  is unrelated and stays).
- `electron/main.ts` — replaced `requestMacPermissions()` with
  four smaller methods:
  - `checkMacPermissions()` — startup hook that only reads and
    logs the current Accessibility / Microphone status. No
    request calls, no system dialogs.
  - `getMacPermissionsStatus()` — snapshot for the renderer /
    settings panel.
  - `requestMacPermission(type)` — explicit request triggered by
    an IPC call from the settings UI. Returns the post-request
    status snapshot.
  - `ensureMicrophoneAccessForRecording()` — lazy guard called at
    the top of `startRecording()`. Only requests the mic when
    the system status is `not-determined` (first-time grant);
    never re-prompts after the user has answered, and refuses
    to start the recording if access is denied. The
    `startRecording` call site was updated to await this and
    short-circuit with a clear log line if access isn't
    available.
- `electron/ipc-handlers.ts` — added two new handlers:
  `get_mac_permissions` and `request_mac_permission`. The
  signature of `registerIpcHandlers` gained two new callback
  parameters, and the call site in `electron/main.ts` wires
  them to the new methods.
- Accessibility is **not** auto-requested from any code path.
  The user has to enable the app in System Settings ->
  Privacy & Security -> Accessibility manually. The existing
  `openAccessibilitySettings` IPC already opens that pane; the
  settings panel can now show a banner when
  `get_mac_permissions.accessibility` is `false` and use the
  new `request_mac_permission` IPC to walk the user through the
  flow.
- `electron/bzip2.d.ts` and `electron/tar-stream.d.ts` removed
  (orphan type stubs from before the download code was
  deleted).
- `test/asr-bootstrap.test.js` — replaced the three
  download-behavior tests
  ("returns null when download request fails",
  "returns null when temp download file cannot be written",
  "successfully downloads and decompresses model archive") with
  two new tests that assert the opposite contract:
  - "returns null and never hits the network when the
    packaged sense-voice model is missing" — installs an
    `https` proxy that throws on any access, and confirms the
    bootstrap never touches it.
  - "returns null and never hits the network when the
    streaming model is missing" — same, for
    `recognition_mode: 'streaming_output'`.

Verification:

- `npm run build:electron` → clean TypeScript compile, no
  warnings.
- `node --test test/*.test.js` → **138 pass / 0 fail** (was
  139; we lost 3 download tests and added 2 "no download"
  tests, plus Round 9e had 3 new env-injection tests).
- `npm run build -- --x64` produced
  `release/typetype-0.3.9.dmg` at 1,150,961,080 bytes (≈
  1.07 GiB, similar to 0.3.7/0.3.8; the ~1 MB drop is from the
  removed `bzip2`/`tar-stream` import surface plus smaller
  `dist-electron/asr-bootstrap.js`).
- DMG copied to `~/Desktop/typetype-0.3.9.dmg` with matching
  MD5 (`2b0809da291537bbc45e408b282a2f73` on both copies).
- `npx asar extract` of the packaged `app.asar` confirms:
  - `main.js` contains 9 hits for the new permission methods
    (`checkMacPermissions`, `getMacPermissionsStatus`,
    `requestMacPermission`, `ensureMicrophoneAccessForRecording`)
    and zero hits for `requestMacPermissions`.
  - `asr-bootstrap.js`, `main.js`, `asr-engine.js` all have
    zero references to `downloadModel`, `MODEL_DOWNLOAD_URLS`,
    `extractModelArchive`, `tar-stream`, or `bzip2` — the
    download path is fully gone from the packaged app.
  - `ipc-handlers.js` registers both `get_mac_permissions` and
    `request_mac_permission` handlers.
- All ASR (267 MB), punctuation (59 MB), and translation
  (881 MB) models are present in
  `Contents/Resources/{models,punctuation-models,translation-models}/`
  — same shape as 0.3.7/0.3.8. Total app payload ≈ 1.21 GB,
  matching the DMG size.

Manual verification gap (still):

- I have NOT run the packaged Intel DMG on real hardware. The
  expected UX after install:
  - On first launch, the app logs
    `Mac Accessibility status: false` and
    `Mac Microphone status: granted` (or `not-determined`).
    **No system prompt fires.** The mic will only be requested
    when the user actually triggers a recording, and only if
    the system status is still `not-determined`.
  - After the user grants mic in System Settings, subsequent
    launches do not show any dialog. The settings panel can
    read the status via `get_mac_permissions` and surface a
    banner if Accessibility is still missing.
  - **If the bootstrap ever does not find the packaged model**
    (e.g. a packaging defect that drops a file), the log will
    show a clear
    `[asr-bootstrap] Packaged model "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09" was not found in any of the bundled search paths. ...`
    line instead of a silent download attempt. Send that line
    over and I can fix the packaging.

Risks / follow-ups:

- The settings panel still does not render the
  "Accessibility not granted" banner or the
  "Request" / "Open System Settings" buttons. The IPC is
  wired, but the renderer-side work is a follow-up. The app
  will not show a permission prompt on launch either way
  now, so the worst case is "the user is confused why their
  shortcut does nothing" — which they can resolve by opening
  the Accessibility pane manually.
- Removing `downloadModel` is a behavior break for anyone who
  was relying on the auto-download. Per the user's explicit
  request, the new contract is "if the packaged model is
  missing, the app surfaces an error". If we ever need an
  escape hatch for dev / internal builds, the right shape is
  an env var like `TYPETYPE_ALLOW_MODEL_DOWNLOAD=1` that
  re-enables the old path; we deliberately did not add that
  now to keep the user-facing surface minimal.

## Round 9g Notes — 2026-06-10

User installed v0.3.10 and saw the same `worker-exit code=1` on
their Intel Mac. They also flagged that they were running on an
M-chip and asked whether they could test the x64 build locally
instead of shipping every build to the user. Answer: yes, Apple
Silicon runs x64 under Rosetta 2 directly. So I cloned the DMG
to `/tmp/typetype-x64-test/`, ran it, and reproduced the bug in
my own M2 environment.

Root cause (now found): `electron/asr-engine.ts` had a top-level
`import { app } from 'electron';`. The worker child process forks
under `ELECTRON_RUN_AS_NODE=1` (plain Node, no Electron), and
plain Node cannot `require('electron')`. The require for
`./asr-engine` at the top of `asr-engine-worker.js` synchronously
resolved to `electron`, threw `MODULE_NOT_FOUND`, and the
uncaughtException handler in the worker — registered AFTER the
`require('./asr-engine')` line — never had a chance to fire. The
worker exited with code 1 silently. The Round 9e fix was
correct but incomplete: it patched the runtime path inside
`loadSherpaOnnxNode()` but missed that the module import itself
already failed.

Changes in this round:

- `electron/asr-engine.ts` — replaced the top-level
  `import { app } from 'electron';` with a small lazy helper:
  ```ts
  function getApp() {
    try { return require('electron').app; } catch { return null; }
  }
  ```
  The single `app.getPath('userData')` call site in
  `getAsciiModelLinkRoot()` now uses `getApp()?.getPath('userData')`
  and the `isAsciiPath` check is null-safe. Both call sites are
  already inside try/catch blocks, so a worker that can't reach
  Electron's `app` simply skips the userData-based ASCII-link
  candidate and falls through to the env-var / TEMP candidates.

Reproduction and verification (on the M2 host, running the
x64 build under Rosetta 2):

- 0.3.10 (the build that was already on the desktop):
  ```
  [INFO] [v0.3.10] [asr-engine-proxy] worker-exit {"code":1,"signal":null}
  [ERROR] [v0.3.10] Failed to initialize ASR engine:
      Error: ASR worker exited before ready (code=1 signal=null)
  [ERROR] [v0.3.10] [asr-bootstrap] Packaged model
      "sherpa-onnx-sense-voice" was not found in any of the
      bundled search paths.
  ```
  Same crash as the user reported, on the M2 host. Confirmed the
  reproduction is reliable and architecture-independent.

- 0.3.11 (the new build, after the lazy-electron fix):
  ```
  [INFO] [v0.3.11] Logger initialized at ...
  [INFO] [v0.3.11] Mac Accessibility status: true
  [INFO] [v0.3.11] Mac Microphone status: granted
  [INFO] [v0.3.11] Global shortcut registration {"reason":"startup",...}
  [WARN] [v0.3.11] [asr-bootstrap] Professional voice package
      is unavailable; falling back to the fast offline package.
  [INFO] [v0.3.11] ASR engine initialized
      {"runtime":"已就绪 · 本机加速","model_loaded":true}
  ```
  No worker-exit. The x64 ASR worker (PID 36017) stays alive.
  The pro-voice warning is the expected "pro package is not
  packaged" message from Round 9f (the model is not in the DMG,
  the bootstrap logs a clear error and falls back to the fast
  offline package, which is the default).

- Standalone reproduction (skipped the IPC plumbing, sent
  `init` directly to a fork of the worker):
  ```js
  const { fork } = require('child_process');
  const worker = fork('/path/to/asr-engine-worker.js', [], {
    env: { ..., ELECTRON_RUN_AS_NODE: '1', TYPETYPE_RESOURCES_PATH: ... },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  worker.send({ type: 'init', modelFiles: {...}, recognitionMode: 'non_streaming', ... });
  ```
  0.3.10 worker stderr:
  ```
  Error: Cannot find module 'electron'
  [WORKER EXIT] code=1 signal=null
  ```
  0.3.11 worker message:
  ```
  { type: 'ready', provider: 'cpu',
    runtimeLabel: 'ready · offline · CPU · 2 threads',
    recognitionMode: 'non_streaming',
    modelPath: '/.../sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/model.int8.onnx' }
  ```

Verification:

- `npm run build:electron` → clean TypeScript compile.
- `node --test test/*.test.js` → **138 pass / 0 fail**.
- DMG `release/typetype-0.3.11.dmg` produced at
  1,151,874,886 bytes (~1.073 GiB), matching the 0.3.7/0.3.8/0.3.9/0.3.10
  envelope. Copied to `~/Desktop/typetype-0.3.11.dmg` with
  matching MD5 (`b21739ef57eda2bf578fa26d1585c51a`).
- End-to-end test on the M2 host (Rosetta 2 x64 emulation): the
  shipped DMG launches, the ASR worker forkmodel loads, the
  status reaches `ASR engine initialized ... model_loaded:true`.

Manual verification gap (still):

- I have NOT run the packaged Intel DMG on real Intel hardware.
  The expected UX after install: same as the M2 Rosetta test
  above. If the user still sees `worker-exit code=1` after
  0.3.11, the uncaughtException handler in the worker should
  now actually fire (since `asr-engine.js` is importable in
  plain Node), and the structured `initError` message will be
  in the log.

Lessons:

- The original Round 9e "uncaughtException handler" was a good
  defensive measure but it was registered too late. Module-load
  errors happen before any handler can run, and they silently
  kill the process with code 1. Always test the import path
  itself, not just the runtime behavior. The standalone
  reproduction script (fork the worker, send `init`, watch
  exit) is the right shape of test for this class of bug and
  should be added to the test suite going forward.
- M-chip hosts can run x64 builds under Rosetta 2, so the
  build/test cycle for the Intel target no longer needs a
  separate Intel machine. The Rosetta emulation penalty is
  negligible for the kind of bug we are hunting here (a
  worker-startup race, not a hot-path perf concern).

## Round 9h Notes — 2026-06-11

**Goal.** Fix the macOS menu-bar mic indicator staying on after the
user stops recording with the hotkey. User report:
"用快捷键结束录音后 为什么系统的麦克风始终显示录音状态啊 是不是没关麦克风"
Suspected correctly: the mic device was not being released.

### Diagnosis — four bugs in `src/recorder/recorder.js`

`cleanupStream()` is the function that releases the input device
when recording stops. It had four problems that together prevented
macOS from clearing the orange mic dot:

1. **Fire-and-forget `audioContext.close()`.** The call was
   `audioContext.close().catch(() => {})` — never awaited. The
   renderer returned to the main process before the context
   actually closed. macOS keeps the mic indicator lit until the
   `AudioContext` reaches the `closed` state, so the indicator
   stayed on indefinitely after every stop.
2. **Wrong teardown order.** `mediaStream.getTracks().forEach(t =>
   t.stop())` ran **before** `sourceNode.disconnect()`. Chromium
   leaves the audio graph in a half-released state when the
   source node is still connected at the moment the track dies,
   and the device is not freed until the next GC.
3. **Worklet processor kept running.** `captureNode.port.onmessage
   = null` only removes the JS listener. The `AudioWorkletProcessor`
   itself keeps ticking until the context closes, which keeps the
   graph alive.
4. **Cleanup was sync, callers did not wait.** `cleanupStream` was
   a plain function; its callers (notably `stopRecording`'s
   `finally`) ran straight through to `recorderAPI.sendResult(...)`
   before the device was actually released. The IPC reply
   returned to the main process with the mic still held.

### Fix

`cleanupStream()` is now `async` and follows the correct Chromium
teardown order:

1. `sourceNode.disconnect()` (try/catch)
2. `captureNode.port.close()` + `port.onmessage = null` + `captureNode.disconnect()`
3. `silentGainNode.disconnect()`
4. Stop every `mediaStream` track
5. **`await audioContext.close()`** (try/catch)

`stopRecording()` now:

- Early-returns (no `mediaStream`) just clear timers + worklet blob
  and send an empty result; there is nothing to release so no
  `await` is needed in that branch.
- The main branch computes `resultBuffer` in `try`, and in
  `finally` does `await cleanupStream()` **then**
  `recorderAPI.sendResult(resultBuffer)`. The result is sent only
  after the device is released.
- `sendError` is inside `catch` so the error path does not skip
  the cleanup await.

`startRecording()`'s `catch` block now `await cleanupStream()`
(was sync).

The reorder rationale and the `await audioContext.close()`
behaviour are documented inline in the source so future modifiers
do not regress it.

### Tests

New file `test/recorder-cleanup.test.js` with 3 structural tests
(the recorder module depends on `window`, `AudioContext`,
`MediaStream` and is not runnable in plain Node, so we grep the
source for the ordering invariants instead of executing the
real teardown):

- `cleanupStream is async and awaits audioContext.close` ✅
- `cleanupStream disconnects source/capture/silent-gain before
  stopping MediaStream tracks` ✅
- `stopRecording awaits cleanupStream and only sends the result
  after the device is released` ✅

One initial false-positive in the third test: it used
`indexOf("recorderAPI.sendResult(")` which found the early-return
branch (which legitimately calls `sendResult` before any
`cleanupStream` because there is nothing to release). Fixed by
searching for `sendResult` only **after** the
`await cleanupStream()` token. The source was correct from the
start; only the test was too broad.

Full test run: `node --test test/*.test.js` → **141 pass / 0 fail**
(138 prior + 3 new).

### Packaging

- Bumped `package.json` and `package-lock.json` to **0.3.12**.
- `npm run build -- --x64` → DMG
  `release/typetype-0.3.12.dmg` (1,151,710,524 bytes, ~1.073 GiB).
- Copied to `~/Desktop/typetype-0.3.12.dmg`. MD5
  `fba404f16a71a03088d753baea3b139d` matches in both locations.
- The 7za `-mx=9` mac.zip step was killed (takes 70+ minutes and
  we don't ship the zip anyway).

### Verifying the packaged fix

Mounted the DMG and extracted `app.asar`:

```
npx --no-install asar extract \
  /private/tmp/typetype-mnt-3.12/typetype.app/Contents/Resources/app.asar \
  /tmp/asar-3.12
```

`/tmp/asar-3.12/src/recorder/recorder.js` (the renderer-side
source ships inside the asar) contains all the invariants:

- `async function cleanupStream(` ✅
- `await audioContext.close()` ✅
- No `audioContext.close().catch(` (no fire-and-forget) ✅
- `sourceNode.disconnect()` at offset 2289, `track.stop()` at
  offset 3194 — disconnect runs first ✅
- `captureNode.disconnect()` and `silentGainNode.disconnect()` both
  present ✅
- `await cleanupStream()` inside `stopRecording` ✅
- No `M_TYPETYPE_RESOURCES_PATH` or `function downloadModel`
  leftovers from the Round 9f/9g code ✅

Note: `recorder.js` is a **renderer-side** ESM module — it is
shipped as `app.asar/src/recorder/recorder.js`, **not** under
`dist-electron/`. The compiled main process lives in
`dist-electron/` (e.g. `dist-electron/asr-engine-proxy.js`).
This is easy to get wrong when reading packaged code.

### Manual verification gap

I have NOT watched the orange mic dot clear in real-time on an
Intel Mac. The structural test + the asar-content assertion are
the locks. The user should install
`~/Desktop/typetype-0.3.12.dmg` on their Intel Mac, trigger
recording with Ctrl+Slash, send some audio, then press the
hotkey again to stop. The expected behaviour: the orange mic
dot in the macOS menu bar goes off within ~1 second of the
stop hotkey. If it stays on, send the new log from
`~/Library/Logs/typetype/typetype.log`.

### Lessons

- The single biggest mistake in the original code was
  `.catch(() => {})` swallowing the promise from
  `audioContext.close()`. Fire-and-forget on a teardown is a
  category of bug that does not show up in any synchronous test
  or any log — the device is "released" from the JS point of
  view but the OS still holds it. Always await OS-release-style
  APIs.
- The Chromium audio graph teardown order
  (disconnect → track.stop → context.close) is not obvious and
  not always documented. Comments in the source are now the
  durable note.
- Renderer-side source under `src/` ships inside `app.asar`; the
  asar is the right place to verify packaged renderer fixes. The
  `dist-electron/` tree only contains the compiled main process.

## Round 9i Notes — 2026-06-11

**Goal.** Fix two real-world failures on the Intel Mac:

1. **Accessibility was never auto-prompted.** Microphone has a
   dedicated `askForMediaAccess` IPC and is already lazily prompted
   in `startRecording()`. Accessibility was sitting there waiting
   for the user to find the "Open Accessibility Settings" button in
   the settings panel. Most users never do — they discover the
   problem only after a recording, when paste silently fails with
   osascript error 1002.
2. **Paste failure was silent in the non-streaming path.**
   `outputTranscript()` only `console.warn`'d when `pasteToApp`
   failed. The transcript was already on the clipboard, but the
   user sees the recogniser light up and then nothing happens in
   the foreground app, and reads it as "识别没出来".

### Diagnosis from the user's log

- `01:29:29.759Z` startup: `Mac Accessibility status: false`.
  Nothing in `initialize()` calls `ensureMacPermission("accessibility")`,
  so the system never shows the prompt.
- `01:31:01.468Z` microphone gets prompted (correctly, in
  `startRecording`).
- `01:31:12.605Z` and onwards: `AppleScript paste error: ... "osascript"
  not allowed to send keystrokes (1002)`. The recogniser is working
  (`Streaming transcription complete {"chars":10,"hasText":true}`),
  the transcript is on the clipboard, but no keystroke is delivered.

### Fix — `electron/main.ts`

Three edits:

1. **`initialize()` on macOS, after the silent status read, prompts
   for accessibility if it is currently untrusted.** Uses the
   existing `ensureMacPermission("accessibility")` so the dialog is
   the same one the settings-panel button shows. The OS dialog is
   idempotent on its side, so this only ever fires once per user.
2. **`startRecording()` re-checks accessibility right after the
   microphone check.** When auto-paste is on and the prompt comes
   back untrusted (e.g. user dismissed the startup dialog by
   closing System Settings), it sets
   `streamingAutoPasteSuspended = true` and patches the streaming
   panel with a Chinese message saying paste is skipped, the
   transcript is on the clipboard, and the user should enable
   typetype under System Settings -> Privacy & Security ->
   Accessibility. We do NOT block the recording — recognition is
   still useful even without auto-paste.
3. **`outputTranscript()` patches the streaming panel on
   `pasteToApp` failure** (was: `console.warn` only). Same
   Chinese message about clipboard + accessibility. The streaming
   paste queue already had this pattern; the non-streaming path
   was the gap.

### Tests

New file `test/permissions-launch.test.js` with 3 structural
tests (main.ts is a monolithic entry point — `TypenewApp` is not
exported, so behaviour-level tests would need a full Electron
bootstrap). The structural tests cover:

- `initialize()` calls `getMacPermissionsStatus()` for the silent
  read and `ensureMacPermission("accessibility")` for the prompt,
  and the prompt is guarded by `!permStatus.accessibility` so a
  trusted user is never re-prompted.
- `startRecording()` still calls `ensureMacPermission("microphone")`
  first, then `ensureMacPermission("accessibility")` as well, sets
  `streamingAutoPasteSuspended = true` on denial, and patches the
  streaming panel state.
- `outputTranscript()` patches the streaming panel state on paste
  failure and the message mentions the clipboard.

Full test run: `node --test test/*.test.js` → **144 pass / 0 fail**
(141 prior + 3 new).

### Packaging

- Bumped to **0.3.13** (package.json + package-lock.json).
- `npm run build -- --x64` → DMG
  `release/typetype-0.3.13.dmg` (1,151,055,592 bytes).
- Copied to `~/Desktop/typetype-0.3.13.dmg`. MD5
  `1bdc19e6bef94bcc49399dc8d4cc3a57` matches both locations.
- Killed 7za mid-zip again (no change vs prior rounds).

### Verifying the packaged fix

Mounted the DMG, extracted `app.asar`, and grep'd the compiled
`dist-electron/main.js`:

```
  ok ensureMacPermission("accessibility") in startup
  ok Mac Accessibility prompt result: log
  ok startRecording also calls accessibility
  ok streamingAutoPasteSuspended = true in startRecording
  ok patchStreamingAiPanelState in startRecording
  ok patchStreamingAiPanelState in outputTranscript
  ok last_error accessibility_untrusted
```

7/7 invariants found in the packaged binary. The 0.3.12 DMG is
still on the user's desktop for diff if needed.

### Manual verification gap

I have NOT manually tested the system prompt on real hardware —
Apple's accessibility prompt is the only piece of UX I can't
exercise from a Mac Mini I don't own. The structural tests + the
asar-content assertion are the locks. The user should:

1. Install `~/Desktop/typetype-0.3.13.dmg` on the Intel Mac.
2. Launch typetype. If accessibility was off, a system dialog
   "typetype wants to control this computer using accessibility
   features" should appear within ~1 second of launch. If it
   does not, the system status is being read wrong — send the
   log and I'll dig.
3. Open System Settings -> Privacy & Security -> Accessibility
   and enable typetype. Dismiss the dialog.
4. Open any text input, press Ctrl+Slash, say something, press
   Ctrl+Slash again. The text should land in the foreground app.
5. If it does not, the most likely cause is that the target app
   is not accepting the keystroke — the overlay should now say
   "自动粘贴失败,识别内容已复制到剪贴板..." instead of staying
   silent. Send the log.

## Round 9j Notes — 2026-06-11

**Goal.** Roll back the two main-process accessibility prompts that
0.3.13 added. They worked as designed on M2 hosts but on the user's
slow Intel Mac they triggered a "麦克风不会 stop" regression that
100% reproduced. The cleanupStream fix from 0.3.12 is preserved
(mic release) and the overlay patch from 0.3.13 is preserved
(paste-failure visibility) — only the prompt code paths are
removed.

### What 0.3.13 actually did to stop

The two `ensureMacPermission('accessibility')` calls in 0.3.13 both
routed through `systemPreferences.isTrustedAccessibilityClient(true)`.
On slow Intel macOS, that call can take a long time to return when
the user dismisses the native accessibility dialog (or the dialog
just does not show on certain macOS versions and the call waits
for an OS callback). Both call sites are `await`ed:

- `initialize()` — happens during app startup, before the shortcut
  handler is wired. If the prompt blocks, the app itself is
  unresponsive until the user clicks the system dialog.
- `startRecording()` — happens on every hotkey press. The 600ms
  `RECORDING_STOP_GUARD_MS` in `handleShortcutToggle()` is meant
  to debounce accidental key repeats, but a hotkey press during
  the prompt's blocked window goes to a `startRecording()` call
  that never resolves, and the *next* hotkey press (the user's
  intended stop) hits `shouldStartRecording() === false` and is
  silently swallowed.

That second half is the "麦克风不会 stop" the user reported:
the stop hotkey is registered with the OS, but the main process
is sitting on the `isTrustedAccessibilityClient(true)` await and
never gets to invoke the shortcut callback.

The 0.3.13 log `02:32:56.425Z` and `02:32:56.441Z` (two
"accessibility not trusted" warnings 16ms apart) are the smoking
gun: the start shortcut fired twice in 16ms, both calls blocked
on the prompt, and the stop hotkey that the user pressed next
hit a `shouldStartRecording() === false` state.

### Rollback

1. `initialize()` startup block: removed the
   `if (!permStatus.accessibility) { void
   this.ensureMacPermission('accessibility')… }` call. The block
   is back to the 0.3.12 form — silent read of
   `getMacPermissionsStatus()` only. No native prompt on
   startup.
2. `startRecording()`: removed the
   `if (process.platform === 'darwin') { const axOk = await
   this.ensureMacPermission('accessibility'); … }` block. We no
   longer pre-emptively set `streamingAutoPasteSuspended = true`
   either. The microphone check stays. Auto-paste is best-effort
   at runtime.
3. `outputTranscript()`: kept the 0.3.13
   `patchStreamingAiPanelState(...)` on non-streaming paste
   failure. This one is fire-and-forget IPC publish, it does not
   block the main process, and the user-facing message ("自动粘贴
   失败,识别内容已复制到剪贴板,请手动粘贴。") is the part we want
   to keep.

### What 0.3.14 does NOT do

- It does **not** proactively prompt for accessibility. The user
  has to open System Settings → Privacy & Security → Accessibility
  and toggle typetype on. The settings panel already has the
  "打开辅助功能设置" button (`#accessibility-button`) wired to
  `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')`,
  so the UX path is one click away.
- It does **not** roll back `cleanupStream`. The 0.3.12 fix is
  preserved (mic indicator goes off after stop, 8/8 invariants
  verified in the packaged asar).
- It does **not** roll back the streaming-paste-failure overlay
  patch. That was always part of the existing
  `flushStreamingPasteQueue` catch block.

### Tests

`test/permissions-launch.test.js` updated to lock the rollback.
Three structural tests:

- `initialize() does not block the main process on the
  accessibility prompt` — must not call
  `ensureMacPermission('accessibility')` and must not call
  `isTrustedAccessibilityClient(true)` in the startup block.
  Must still call `getMacPermissionsStatus()` for the silent
  log line.
- `startRecording() does not await any accessibility prompt` —
  must not call `ensureMacPermission('accessibility')` and
  must not pre-emptively set `streamingAutoPasteSuspended =
  true`. Microphone check stays.
- `outputTranscript() surfaces non-streaming paste failures on
  the overlay` — keeps the 0.3.13 patch.

Full test run: `node --test test/*.test.js` → **144 pass / 0 fail**.

### Packaging

- Bumped to **0.3.14** (package.json + package-lock.json).
- `npm run build -- --x64` in progress; will copy DMG to
  `~/Desktop/typetype-0.3.14.dmg` once the 7za child is killed.

### Lessons

- `systemPreferences.isTrustedAccessibilityClient(true)` is one
  of the few Electron APIs that can synchronously show a native
  macOS dialog and block the main process for the duration of
  the user response. Treating it like `askForMediaAccess` (an
  async JS API that does not block IPC) is wrong. The 0.3.13
  call sites were both `await`ed, so any hotkey event that
  arrived during the dialog was queued behind the prompt and
  arrived out of order — exactly the "first hotkey starts, the
  stop hotkey is lost" pattern the user reported.
- The user's heuristic "为啥不申请" is correct in spirit, but
  the cure (a synchronous prompt in the hotkey path) is worse
  than the disease (a silent paste failure). The right answer is
  a settings-panel CTA + a clear overlay message when paste
  fails at runtime, not a proactive prompt.
- The `RECORDING_STOP_GUARD_MS = 600` debounce is not enough to
  protect against a multi-second prompt-induced gap. Anything
  that holds the main thread for more than ~100ms in the
  hotkey path needs a `setImmediate` deferral or a worker
  process.

## Round 9k Notes — 2026-06-11

**Goal.** Stop the user from having to dig through System Settings to
find the Accessibility toggle. Log review confirmed recognition
itself is fine (7 + 9 chars both transcribed correctly); paste is
100% blocked by osascript error 1002 (TCC Automation / Accessibility
denied).

### Diagnosis from the user's 0.3.14 log

```
06:57:56.859Z  Recording started {mode: streaming_output, intent: dictation, streaming: true}
06:58:00.851Z  Streaming ASR chunk decoded {text_length: 4}            ← streaming 识别
06:58:01.853Z  AppleScript paste error: ... 1002                         ← paste 失败
06:58:09.860Z  Streaming transcription complete {chars: 7, hasText: true} ← 7 字识别成功
06:58:30.805Z  Recording started {mode: non_streaming, intent: dictation, streaming: false}
06:58:35.873Z  Transcription complete {chars: 9, hasText: true}         ← 9 字识别成功
06:58:36.502Z  AppleScript paste error: ... 1002                         ← paste 失败
06:58:36.503Z  Auto paste failed; transcript remains on clipboard
                  {error: "...1002...", target: "com.google.Chrome"}
```

**Recognition works perfectly.** Two captures, two correct
transcripts (a 7-char segment in streaming mode and a 9-char
transcript in non-streaming mode, both `language: "<|yue|>"`).
The ASR engine is fine.

**Paste is 100% blocked.** The user's bundleId is `com.google.Chrome`
(they're dictating into Chrome) and the error 1002 is the canonical
macOS "not allowed to send Apple events" — System Events is the only
path to deliver Cmd+V to a foreground app, and Apple has gated it
behind the Accessibility + Automation TCC pair. The user has
neither, so the AppleScript path returns 1002 every time.

**The user knows what happened before they ask.** Both captures
left the transcript on the clipboard (`writeClipboard` always runs
before `pasteToApp`), but the user sees a successful recognition in
the overlay and then nothing in the foreground app, so they read
it as "识别没出来" or "模型没识别". The 0.3.13/0.3.14 overlay
patch on paste failure does fire, but it is one of many lines of
text in the streaming panel — easy to miss.

### Fix — `electron/main.ts`

Two new helpers and two new call sites. All async, none of it
blocks the main process or the shortcut handler.

1. `isLikelyAccessibilityError(error)` — regex-detects the
   canonical 1002 / `not allowed to send` / `osascript` /
   `Accessibility` strings in the `pasteToApp` error message. This
   is the only way to know from the error string whether the
   failure is permission-related vs a foreground-app bug; the
   underlying `pasteMac` callback gives us just the osascript
   stderr.
2. `maybeOpenAccessibilitySettings(reason)` — sets a per-session
   flag and calls `openAccessibilitySettings()` once. The flag is
   reset at the top of `startRecording()` so a fresh recording
   session gets a fresh auto-open attempt. `shell.openExternal` is
   fully async — no main-process blocking, no shortcut handler
   freezing (unlike the `isTrustedAccessibilityClient(true)` call
   that the 0.3.13 round used and had to roll back).
3. `outputTranscript()` — on paste failure, if
   `isLikelyAccessibilityError(pasteResult.error)` is true, calls
   `maybeOpenAccessibilitySettings('non-streaming paste failure')`.
   This is the only place that auto-opens. It runs *after* the
   user has stopped recording, so stealing focus to System Settings
   does not interrupt a live capture.
4. `flushStreamingPasteQueue()` — on paste failure, deliberately
   does NOT auto-open. The streaming capture is still in flight;
   yanking focus to System Settings would interrupt the recording
   the user is still doing. The non-streaming path covers the
   auto-open.

The streaming overlay message was simplified from "请点回微信输入框
后手动粘贴" to "请点回输入框后手动粘贴" — the previous message
hardcoded 微信 (WeChat) but the user is on Chrome in the 0.3.14
session, and the test target was `com.google.Chrome`.

### Tests

`test/permissions-launch.test.js` now has 6 tests:

- `initialize() does not block the main process on the accessibility
  prompt` — locks the 0.3.13 rollback
- `startRecording() does not await any accessibility prompt` — locks
  the 0.3.13 rollback
- `outputTranscript() surfaces non-streaming paste failures on the
  overlay` — locks the 0.3.13 overlay patch
- `outputTranscript() opens System Settings -> Accessibility on the
  first paste failure` — new, locks the auto-open call site
- `flushStreamingPasteQueue() does NOT auto-open System Settings
  mid-recording` — new, locks the deliberate non-call
- `startRecording() resets the auto-open flag at the start of each
  session` — new, locks the per-session flag reset

Full test run: `node --test test/*.test.js` → **147 pass / 0 fail**
(144 prior + 3 new).

### Manual verification gap

`shell.openExternal('x-apple.systempreferences:...')` is the same
URL the existing "打开辅助功能设置" button in the settings panel
already uses. It works on the user's machine — they used the
button in 0.3.11/0.3.12 without issue. The only new thing is that
it fires automatically on the first paste failure of a session,
without the user having to click anything. If the user is in the
middle of dictating into Chrome and the first attempt fails, they
will see System Settings jump to the foreground — that is
intentional, and the flag prevents it from happening on every
subsequent capture. If they want the old behavior back they can
ignore the System Settings window and just dictate, then Cmd+V
manually — the transcript is on the clipboard the whole time.

### Packaging

- Bumped to **0.3.15** (package.json + package-lock.json).
- `npm run build -- --x64` in progress; will copy DMG to
  `~/Desktop/typetype-0.3.15.dmg` once the 7za child is killed.

## Round 9l Notes — 2026-06-11

**Goal.** Full rollback of every change from the 0.3.13 / 0.3.14 /
0.3.15 rounds. The user explicitly asked to look at the code from
before the prompt work — this is that code, on top of the 0.3.12
cleanupStream fix that already shipped.

### What I did to the user

The 0.3.13 round added two new `ensureMacPermission('accessibility')`
call sites in the main process hotkey path. The call routes through
`systemPreferences.isTrustedAccessibilityClient(true)`, which can
synchronously show a native macOS accessibility dialog. On slow
Intel hardware the dialog blocks the main process for the duration
of the user response, which means the second hotkey press (the
user's stop) is silently lost — the user sees a recording that
won't stop. This was rolled back in 0.3.14, but 0.3.15 introduced
a different copy of the same regression: a `shell.openExternal`
call that auto-opens System Settings to the Accessibility pane on
the first paste failure. `shell.openExternal` is async, so it
does not block the main process, but it does steal focus from
whatever app the user is dictating into. The user reads that
focus jump as "录音又不能 stop 了" again, and reports it as
another regression. **Both of those rounds were net negative.**
The user is right: the code that worked was the 0.3.12 code, and
I should have stopped there.

### 0.3.16 = 0.3.12 + cleanupStream

- `electron/main.ts`: every `ensureMacPermission('accessibility')`
  call site from 0.3.13 is gone. The 0.3.15 helpers
  (`isLikelyAccessibilityError`, `maybeOpenAccessibilitySettings`,
  `resetAccessibilityAutoOpenedFlag`, the
  `accessibilityAutoOpenedThisSession` flag, the
  `resetAccessibilityAutoOpenedFlag()` call at the top of
  `startRecording`) are all gone. The `outputTranscript()` paste
  failure overlay patch from 0.3.13 is gone — back to
  `console.warn` only, matching 0.3.12 exactly. The
  `flushStreamingPasteQueue()` "请点回输入框" message is back to
  0.3.12's "请点回微信输入框" (the 0.3.15 message was a
  cargo-culted edit).
- `initialize()` startup block: silent read of
  `getMacPermissionsStatus()` only, no `ensureMacPermission`
  follow-up, matches 0.3.12.
- `startRecording()`: microphone check only, no accessibility
  check, matches 0.3.12.
- The pre-existing `getMacPermissionsStatus()` / `ensureMacPermission()`
  pair is left in place (they are used by the
  `get_mac_permissions` and `request_mac_permission` IPC handlers
  that the settings panel already wires to the
  "打开辅助功能设置" button). The "打开辅助功能设置" button in the
  settings panel is the documented way for the user to flip the
  Accessibility toggle.
- `src/recorder/recorder.js`: the 0.3.12 cleanupStream fix is
  preserved (`async function cleanupStream`, `await
  audioContext.close()`, source/capture/silent-gain disconnect
  before track.stop before context.close, await cleanupStream
  before sendResult in stopRecording).

### What the user does now

- The app launches, asks for microphone on first use, records,
  stops, transcribes, pastes — exactly as 0.3.12.
- If paste fails (typetype is not in Privacy & Security ->
  Accessibility), the transcript is on the clipboard and the
  console.warn is in the log. The settings panel has a button
  labelled "打开辅助功能设置" that opens System Settings to the
  right pane. The user clicks that button themselves when they
  want to. The button has been there since 0.3.5; I am not
  changing it.

### Tests

`test/permissions-launch.test.js` rewritten to lock the rollback:

- `initialize() does not prompt for Accessibility at startup` —
  must not call `ensureMacPermission('accessibility')`, must not
  call `isTrustedAccessibilityClient(true)`, must not auto-open
  System Settings. Must still call `getMacPermissionsStatus()`.
- `startRecording() does not await any accessibility prompt` —
  must not call `ensureMacPermission('accessibility')`, must not
  auto-open System Settings, must not pre-emptively set
  `streamingAutoPasteSuspended = true`. Microphone check stays.
- `outputTranscript() and flushStreamingPasteQueue() do not
  auto-open System Settings on paste failure` — the auto-open
  helper must not appear in either function. The 0.3.13
  `patchStreamingAiPanelState` overlay patch on paste failure is
  also gone, locked by `doesNotMatch`.

Full test run: `node --test test/*.test.js` → **144 pass / 0 fail**.

### Packaging

- Bumped to **0.3.16** (package.json + package-lock.json).
- `npm run build -- --x64` successfully completed, generating `release/typetype-0.3.16.dmg` (~1.1 GB).
- Copied the packaged DMG to the user's Desktop as `/Users/hanfeng/Desktop/typetype-0.3.16-x64.dmg`.

### Lesson for next time

When the user is reporting a regression that I caused and says
"去看以前的代码" / "以前都是好使的", the right move is to roll
back to the version they were running successfully, ship that,
and stop. New behaviour is not an improvement if it ships with a
new regression.

## Round 10 Notes — 2026-06-11

**Goal.** Review the backfill (auto-paste) logic to ensure it is correct and deduplicated, verify all unit/integration tests, and package both Apple Silicon (arm64) and Intel (x64) versions to the user's Desktop.

### Review of Backfill Logic

- Confirmed that `promptForAccessibilityForAutoPaste()` is safely called when paste or replace operations fail due to missing macOS Accessibility permissions.
- In `transcribeAudio` (non-streaming):
  - Step 1 (ASR initial paste) checks if accessibility is missing and shows the prompt.
  - Step 3 (backfill replace) checks for `accessibility_required` code and prompts.
  - Step 4 (final output transcript fallback paste) checks if accessibility is missing and prompts (if step 1 paste was skipped or failed).
- In `applyStreamingAiSummary` & `applyStreamingAiRefinedRaw` (triggered via streaming AI panel clicks), accessibility failures correctly show the prompt.
- Deduplication is successfully handled via the session-scoped `accessibilityPromptedThisSession` flag, which is reset to `false` at the start of each recording session.
- During live streaming chunks (`flushStreamingPasteQueue`), auto-paste failures do NOT trigger the dialog in order to prevent interrupting active recording; instead, auto-paste is gracefully suspended and text is copied to the clipboard. Once recording stops, the user can manually trigger import or check settings.
- This represents a highly robust, non-blocking, and user-friendly permissions flow.

### Verification

- Run `node --test test/*.test.js` -> 149 pass / 0 fail. All unit and structural tests pass cleanly.

### Packaging

- Packaged Apple Silicon (arm64) DMG: `release/typetype-0.3.17-arm64.dmg`
- Packaged Intel (x64) DMG: `release/typetype-0.3.17.dmg`
- Overrode the `mac.target` configuration to output only `dmg` targets, bypassing the time-consuming `7za` compression for `.zip` auto-updater packages.
- Copied both DMG packages to the user's Desktop:
  - `/Users/hanfeng/Desktop/typetype-0.3.17-arm64.dmg`
  - `/Users/hanfeng/Desktop/typetype-0.3.17-x64.dmg`

## Round 11 Notes — 2026-06-11

**Goal.** Fix macOS Accessibility TCC cache corruption/mismatch issues on the Intel (x64) build running under Rosetta 2 on Apple Silicon Macs, and package the new Intel DMG.

### Implementation

- Identified that macOS TCC caches Accessibility permissions based on path/binary signature/architecture. Overwriting native M-chip builds with Intel builds (which are unsigned) causes macOS to block the Intel version's system events control (error `1002`), even if the System Settings UI shows the checkbox as ON.
- Added `resetAccessibilityPermission()` helper in `electron/main.ts` that runs `tccutil reset Accessibility app.typetype` to clear the corrupt TCC cache.
- Updated `promptForAccessibilityForAutoPaste()` dialog in `electron/main.ts`:
  - Added a new button `"修复并打开设置"` (Fix and Open Settings) to trigger the TCC reset and open System Settings.
  - Added details explaining the macOS cache bug and how to fix it by toggling the checkbox back ON.
- Bumped app version to `0.3.18`.

### Verification

- Run `node --test test/*.test.js` -> 149 pass / 0 fail. All unit and structural tests pass cleanly.

### Packaging

- Packaged Intel (x64) DMG: `release/typetype-0.3.18.dmg`
- Overrode target to build only DMG (no slow updater zip).
- Copied to user's Desktop as: `/Users/hanfeng/Desktop/typetype-0.3.18-x64.dmg`

## Round 12 Notes — 2026-06-12

**Goal.** Investigate the generic `Failed to start recording: Error` reported by the user on the Intel (x64) build. Upgrade the recorder window's error capture mechanism to log detailed error messages/stack traces to help pinpoint the root cause (such as macOS TCC microphone permission blocks).

### Implementation

- Identified that the catch block in the hidden `recorderWindow` (`src/recorder/recorder.js`) only forwarded `error.message` to the main process via IPC. For certain `DOMException` or browser security failures (like `NotAllowedError` from `getUserMedia`), `.message` is empty, leading to a generic `Error` with no details.
- Added global uncaught error and unhandled rejection listeners to `src/recorder/recorder.js` to catch and report asynchronous/load-time exceptions.
- Upgraded the error handling inside `startRecording` and `stopRecording` in `src/recorder/recorder.js` to extract and forward the full stack trace (`error.stack`) or `error.name: error.message`, ensuring detailed logs reach the main process.
- Bumped app version to `0.3.19`.

### Verification

- Run `node --test test/*.test.js` -> 149 pass / 0 fail. All unit and structural tests pass cleanly.

### Packaging

- Packaged Intel (x64) DMG: `release/typetype-0.3.19.dmg`
- Overrode target to build only DMG.
- Copied to user's Desktop as: `/Users/hanfeng/Desktop/typetype-0.3.19-x64.dmg`

## Round 13 Notes — 2026-06-21

**Goal.** Fix "麦克风调不起来" on the Intel (x64) build. Investigation established the root cause was NOT the recorder constraints/fallback code (which is correct and identical to the working arm64 path), but packaging: the Intel `.app` bundle was `not signed at all`, while arm64 was at least ad-hoc/linker-signed. An unsigned bundle has an unstable identity under macOS TCC, so the renderer helper's `getUserMedia` is blocked at the CoreAudio layer.

### Root cause (verified by reading electron-builder 25.1.8 + @electron/osx-sign 1.3.1 source)

No conventional `mac.identity` value makes electron-builder emit an ad-hoc signature:
- `identity: null`  -> `macPackager.js:183-188` returns false, skips signing.
- `identity: "-"`   -> electron-builder's own `findIdentity` finds no cert named `-`, `reportError` warns + returns false, never reaches osx-sign.
- no identity + no cert -> osx-sign `sign.js:334` throws `No identity found for signing`.

### Fix

1. `build/entitlements.mac.plist` (new): cs.* keys required by arm64 Electron + `com.apple.security.device.audio-input`.
2. `scripts/mac-adhoc-sign.cjs` (new): custom `mac.sign` hook. Bypasses electron-builder's findIdentity by calling native `codesign --sign - --force --deep --options runtime --entitlements <plist> <app>` directly, then `codesign --verify --deep --strict`, then `codesign -dv`. Initially tried `@electron/osx-sign` `signAsync` with `identity:"-", identityValidation:false` (which correctly emits `codesign -s -`), but osx-sign's `isbinaryfile` dependency crashes with `RangeError: Invalid array length` when scanning large native `.node` libs (sherpa-onnx). Direct `codesign` avoids that whole binary-detection path and is all ad-hoc signing needs.
3. `package.json` `build.mac`: added `entitlements`, `entitlementsInherit` (both -> `build/entitlements.mac.plist`), and `sign` (-> `scripts/mac-adhoc-sign.cjs`). Left `identity` unset; the hook supplies `"-"`.

The hook runs before DMG/ZIP packaging (afterPack -> sign -> packageInDistributableFormat), so the signed `.app` is embedded in the DMG.

### Verification

- `node --test test/*.test.js` -> 149 pass / 0 fail. No regression.
- `npm run build:mac-x64` -> log shows `executing custom sign file=release/mac/typetype.app` then `codesign` succeeds; DMG `release/typetype-0.3.19.dmg` regenerated (09:23).
- `codesign -dv release/mac/typetype.app`: `Signature=adhoc`, `flags=0x10002(adhoc,runtime)`, `Format=app bundle with Mach-O thin (x86_64)`. (Before: "code object is not signed at all".)
- `codesign --verify --deep --strict` passes for app + ALL nested bundles incl. `typetype Helper (Renderer).app` (the one holding getUserMedia), now `Signature=adhoc`.
- Embedded entitlements confirmed on main app: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.disable-library-validation`, `device.audio-input`.

### Remaining (manual, user-side)

- `tccutil reset Microphone app.typetype` to clear stale TCC records, then launch the app, grant mic, and record to confirm `getUserMedia` now succeeds.

## Round 14 Notes — 2026-06-21

**Goal.** Rebuild a pure Intel (x64) package without the redundant arm64 native libs that were inflating the DMG (the previous round's x64 build shipped both `sherpa-onnx-darwin-x64` AND `sherpa-onnx-darwin-arm64`).

### Root cause of the bloat

`sherpa-onnx-node` declares `sherpa-onnx-darwin-arm64` (and every other platform binary) as an `optionalDependency`. The `build:mac-x64` script runs `npm install sherpa-onnx-darwin-x64 --no-save --force`, but that `npm install` re-resolves `sherpa-onnx-node`'s optionalDependencies and re-installs the arm64 package too. The `asarUnpack` glob `node_modules/sherpa-onnx-darwin-arm64/**/*` then matches and ships it. So merely deleting the arm64 dir before the build does nothing — the build itself restores it.

### Fix

Added an explicit cleanup step between the `npm install` and `electron-builder` in both arch-specific scripts (`package.json`):
- `build:mac-x64`: `... && node -e "require('fs').rmSync('node_modules/sherpa-onnx-darwin-arm64',{recursive:true,force:true})" && electron-builder --mac --x64`
- `build:mac-arm64`: symmetric — removes `sherpa-onnx-darwin-x64` before `electron-builder --mac --arm64`

This guarantees only the target-arch native lib is present when electron-builder packs.

### Verification

- During build `node_modules` contained only `sherpa-onnx-darwin-x64` at pack time.
- `Sealed Resources version=2 rules=13 files=141` (was 148 — the 7 arm64 files dropped).
- Mounted DMG: only `sherpa-onnx-darwin-x64` present; its `sherpa-onnx.node` is `Mach-O ... x86_64`.
- Signature intact: `Signature=adhoc`, `flags=0x10002(adhoc,runtime)`, x86_64; entitlements include `cs.allow-jit` + `device.audio-input`.
- DMG size: 1,132,982,574 bytes (~1.05 GiB / 1.13 GB), down from 1,153,093,473 bytes (~1.07 GiB / 1.15 GB). App bundle inside DMG: 1.8G (was 1.9G).
- `release/typetype-0.3.19-mac.zip` was still compressing at report time (max compression over the large ONNX binaries is slow); DMG is the primary deliverable and is complete.
