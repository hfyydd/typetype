const test = require("node:test");
const assert = require("node:assert/strict");

const { StateMachine } = require("../dist-electron/state-machine.js");

test("StateMachine cleanupTranscript applies dictionary and punctuation cleanup without writing profiles", () => {
  const machine = new StateMachine({
    hotkey: "F8",
    translate_hotkey: "CtrlShiftV",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    compute_backend: "auto",
    translation_target_language: "en",
    custom_dictionary: [{ from: "typo type", to: "typetype" }],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
  });

  const result = machine.finishTranscription("typo type ,test");

  assert.equal(result, "typetype,test");
});

test("StateMachine stopTranscribing exposes a stopped status without committing transcript", () => {
  const machine = new StateMachine({
    hotkey: "F8",
    translate_hotkey: "CtrlShiftV",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    compute_backend: "auto",
    translation_target_language: "en",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
  });

  machine.beginTranscribing();
  machine.stopTranscribing();

  assert.deepEqual(machine.snapshot(), {
    status: "stopped",
    detail: "Stopped",
    final_text: "",
    elapsed_label: "",
    waveform: [],
    settings: {
      hotkey: "F8",
      translate_hotkey: "CtrlShiftV",
      microphone_id: null,
      auto_paste: true,
      launch_at_login: false,
      recognition_mode: "non_streaming",
      compute_backend: "auto",
      translation_target_language: "en",
      custom_dictionary: [],
      model_path: null,
      pinned_model_version: "sherpa-onnx-sense-voice",
    },
  });
});

test("StateMachine beginTranslating exposes translating status", () => {
  const machine = new StateMachine({
    hotkey: "F8",
    translate_hotkey: "CtrlShiftV",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    compute_backend: "auto",
    translation_target_language: "yue",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
  });

  machine.beginTranslating();

  assert.equal(machine.snapshot().status, "translating");
  assert.equal(machine.snapshot().detail, "Translating");
});

test("StateMachine beginTranscribing exposes transcribing status copy", () => {
  const machine = new StateMachine({
    hotkey: "F8",
    translate_hotkey: "CtrlShiftV",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    compute_backend: "auto",
    translation_target_language: "en",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
  });

  machine.beginTranscribing();

  assert.equal(machine.snapshot().status, "transcribing");
  assert.equal(machine.snapshot().detail, "Thinking");
});
