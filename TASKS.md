# Desktop Translation Tasks

## Source Requirements

- User reported current desktop usability issues around translation, hotkeys, settings apply flow, and launch-at-login.

## Current Implementation Status

- Desktop currently supports translation through a `transformers.js`-based NLLB pipeline.

## Known Gaps

- Streaming dictation/translation usability is currently broken or incomplete.
- Non-streaming translation path is reported as not functioning in the app.
- `Alt + .` is reported as unreliable for triggering translation.
- Settings currently auto-save; user requested an explicit Apply/Save button.
- Launch-at-login behavior needs runtime verification.

## Acceptance Criteria

- Voice input/translation hotkey flows work in both supported modes, or unsupported combinations are clearly disabled in UI.
- Settings page exposes an explicit Apply action for shortcut/language changes.
- Launch-at-login behavior is re-verified.

## Prioritized Todo

- [ ] Investigate and fix broken non-streaming translation flow.
- [ ] Investigate and fix `Alt + .` hotkey reliability.
- [ ] Decide and implement supported behavior for streaming translation.
- [ ] Add explicit Apply/Save button in settings and stop relying only on auto-save.
- [ ] Verify launch-at-login behavior after recent settings changes.

## Execution Log

- 2026-04-30 Round 1: User reported six current usability issues across streaming, translation, hotkeys, settings apply flow, and launch-at-login verification. Priorities captured for follow-up.

## Blockers

- None currently recorded for the remaining desktop usability fixes.
