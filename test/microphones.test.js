const test = require("node:test");
const assert = require("node:assert/strict");

const { parseMacMicrophoneOptions } = require("../dist-electron/microphones.js");

test("parseMacMicrophoneOptions keeps physical input devices and skips virtual loopbacks", () => {
  const raw = JSON.stringify({
    SPAudioDataType: [
      {
        _items: [
          {
            _name: "MacBook Air麦克风",
            coreaudio_default_audio_input_device: "spaudio_yes",
            coreaudio_device_input: 1,
            coreaudio_device_transport: "coreaudio_device_type_builtin",
          },
          {
            _name: "BlackHole 2ch",
            coreaudio_device_input: 2,
            coreaudio_device_transport: "coreaudio_device_type_virtual",
          },
          {
            _name: "USB Mic",
            coreaudio_device_input: 1,
            coreaudio_device_transport: "coreaudio_device_type_usb",
          },
          {
            _name: "MacBook Air扬声器",
            coreaudio_device_output: 2,
            coreaudio_device_transport: "coreaudio_device_type_builtin",
          },
        ],
      },
    ],
  });

  assert.deepEqual(parseMacMicrophoneOptions(raw), [
    { id: "MacBook Air麦克风", label: "MacBook Air麦克风" },
    { id: "USB Mic", label: "USB Mic" },
  ]);
});
