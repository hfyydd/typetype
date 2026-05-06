# Packaging Notes

- Windows builds must include both the ASR runtime and the bundled translation model resources.
- Before shipping a Windows package, verify `release/win-unpacked/resources/app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node` exists.
- Before shipping a Windows package, verify `release/win-unpacked/resources/translation-models/` exists and contains the quantized ONNX files for the bundled translation model.
- Do not rely on host-specific optional dependencies being present by accident. If a Windows runtime package is required for packaging on macOS, make it an explicit project dependency or explicitly vendor it into the packaging inputs.
- When changing global shortcut defaults, prefer low-conflict combinations and keep a tested fallback on Windows for system-reserved keys.

## Long Task Execution Protocol

Apply this protocol whenever the user asks to continue development from a requirements doc, plan, TODO list, or the current codebase, and the work is larger than a one-shot trivial edit.

### Primary Objective

Maximize real task completion in a single session. Do not stop after one small batch if more actionable work remains. Default behavior is to keep executing successive rounds until one of the following is true:

- all requirement-aligned tasks are complete
- a real blocker prevents safe progress
- verification fails and cannot be resolved within the current session

Premature stopping is a failure mode. "I already changed a few files" is not a valid reason to stop.

### Required Round Loop

For long-running implementation work, follow this loop strictly:

1. Create or update `TASKS.md` before making substantive code changes.
2. In `TASKS.md`, capture at minimum:
   - source requirements docs or plans
   - current implementation status
   - known gaps
   - acceptance criteria
   - prioritized todo list
   - execution log by round
   - blockers, if any
3. Choose the highest-priority 3 to 5 todo items that are currently actionable.
4. Implement them directly instead of stopping at planning.
5. Run relevant verification after the implementation batch:
   - tests
   - type checks
   - lint
   - build
   Use every relevant verifier available in the repo. If a verifier does not exist, say so explicitly in `TASKS.md` and in the final report rather than silently skipping it.
6. Update `TASKS.md` with:
   - completed work
   - remaining todo items
   - verification results
   - newly discovered follow-up tasks
7. Re-read the requirements docs and inspect the changed code to find anything still missing.
8. If `TASKS.md` still contains actionable todo items and there is no real blocker, start the next round immediately.

### Priority Rules

- Work from the highest-value path first: correctness, broken flows, missing requirement coverage, regression protection, then polish.
- Prefer tasks that unlock or de-risk other tasks.
- Group tasks into small executable batches, but do not game the batch size to justify stopping early.
- If a requirement is partially implemented, finishing that slice usually outranks starting a new unrelated improvement.

### Real Blocker Definition

Only treat something as a blocker if progress cannot continue without one of these:

- missing product decision that materially changes implementation direction
- missing credential, service, asset, or environment capability that cannot be reasonably mocked or worked around
- destructive or irreversible action requiring user confirmation
- persistent verification failure whose cause cannot be resolved from the repository and available tools

These are not blockers:

- the task is large
- multiple todos remain
- more investigation is needed
- tests failed once but debugging has not been attempted
- the next step is obvious but time-consuming

### Anti-Early-Stop Rules

- Do not end the session just because one round completed.
- Do not hand back partial progress while clear next tasks remain.
- Do not report "done" if `TASKS.md` still contains todo items that are actionable.
- If stopping with unfinished work, explicitly identify the exact blocker and the exact task it prevents.
- Before ending, perform a final continuation check: "Is there any remaining todo item I can execute right now?" If yes, continue.

### Final Reporting Contract

When work stops, the final report must include:

- what was completed in the latest round
- what verification ran and the outcome of each step
- which files changed
- what remains, if anything
- if unfinished, the concrete blocker and why it is real

If all work is complete, state that `TASKS.md` has no remaining actionable todo items.
