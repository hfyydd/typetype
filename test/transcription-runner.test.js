const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  TRANSCRIPTION_STOPPED_ERROR_MESSAGE,
  TranscriptionRunner,
} = require("../dist-electron/transcription-runner.js");

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.killCalls = [];
  }

  send(message) {
    this.sent.push(message);
  }

  kill(signal = "SIGTERM") {
    this.killCalls.push(signal);
    this.emit("exit", null, signal);
    return true;
  }
}

test("TranscriptionRunner rejects with a stop error when the active worker is cancelled", async () => {
  const child = new FakeChildProcess();
  const runner = new TranscriptionRunner(
    "/tmp/asr-worker.js",
    () => child
  );

  const pending = runner.transcribe({
    modelPath: "/tmp/model.onnx",
    tokensPath: "/tmp/tokens.txt",
    samples: new Float32Array([0.1, 0.2]),
  });

  child.emit("message", { type: "ready" });
  runner.cancel();

  await assert.rejects(
    pending,
    new Error(TRANSCRIPTION_STOPPED_ERROR_MESSAGE)
  );
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
});
