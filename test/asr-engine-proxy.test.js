const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { AsrEngineProxy } = require("../dist-electron/asr-engine-proxy.js");

function createFakeWorker() {
  const emitter = new EventEmitter();
  emitter.sent = [];
  emitter.killed = false;
  emitter.send = (message) => {
    emitter.sent.push(message);
  };
  emitter.kill = (signal) => {
    emitter.killed = signal ?? true;
  };
  return emitter;
}

test("AsrEngineProxy sends an init message and caches the ready status", async () => {
  const worker = createFakeWorker();
  const proxy = new AsrEngineProxy({
    modelFiles: {
      modelPath: "/models/model.onnx",
      tokensPath: "/models/tokens.txt",
    },
    recognitionMode: "non_streaming",
    computeBackend: "cpu",
    forkProcess: () => worker,
    resolveNodeExecPath: () => "node",
  });

  const initPromise = proxy.initialize();
  assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].type, "init");
  assert.equal(worker.sent[0].recognitionMode, "non_streaming");
  assert.equal(worker.sent[0].computeBackend, "cpu");
  assert.equal(worker.sent[0].modelFiles.modelPath, "/models/model.onnx");

  worker.emit("message", {
    type: "ready",
    provider: "cpu",
    runtimeLabel: "ready · offline · CPU · 4 threads",
    recognitionMode: "non_streaming",
    modelPath: "/models/model.onnx",
    modelDirectory: "/models",
  });
  await initPromise;

  assert.equal(proxy.getActiveProvider(), "cpu");
  assert.equal(proxy.getModelPath(), "/models/model.onnx");
  assert.equal(proxy.getModelDirectory(), "/models");
  assert.equal(proxy.getRecognitionMode(), "non_streaming");
  assert.equal(proxy.getRuntimeLabel(), "ready · offline · CPU · 4 threads");
});

test("AsrEngineProxy rejects the init promise when the worker reports initError", async () => {
  const worker = createFakeWorker();
  const proxy = new AsrEngineProxy({
    modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
    recognitionMode: "non_streaming",
    computeBackend: "cpu",
    forkProcess: () => worker,
    resolveNodeExecPath: () => "node",
  });

  const initPromise = proxy.initialize();
  worker.emit("message", { type: "initError", message: "model missing" });
  await assert.rejects(initPromise, /model missing/);
});

test("AsrEngineProxy.transcribeRich round-trips a request and resolves with the rich result", async () => {
  const worker = createFakeWorker();
  const proxy = new AsrEngineProxy({
    modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
    recognitionMode: "non_streaming",
    computeBackend: "cpu",
    forkProcess: () => worker,
    resolveNodeExecPath: () => "node",
  });

  const initPromise = proxy.initialize();
  worker.emit("message", {
    type: "ready",
    provider: "cpu",
    runtimeLabel: "ready",
    recognitionMode: "non_streaming",
    modelPath: "/m.onnx",
    modelDirectory: "/m",
  });
  await initPromise;

  const transcribePromise = proxy.transcribeRich(new Float32Array([0.1, 0.2, 0.3]));
  const transcribeRequest = worker.sent[worker.sent.length - 1];
  assert.equal(transcribeRequest.type, "transcribe");
  assert.equal(typeof transcribeRequest.requestId, "number");
  assert.equal(transcribeRequest.samples.length, 3);
  assert.ok(Math.abs(transcribeRequest.samples[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(transcribeRequest.samples[1] - 0.2) < 1e-6);
  assert.ok(Math.abs(transcribeRequest.samples[2] - 0.3) < 1e-6);

  worker.emit("message", {
    type: "transcribeResult",
    requestId: transcribeRequest.requestId,
    text: "你好世界",
    language: "zh",
    confidence: 0.97,
    segments: [],
    candidates: ["你好世界", "你好世姐"],
    code_switch_hints: [],
  });
  const result = await transcribePromise;
  assert.equal(result.text, "你好世界");
  assert.equal(result.language, "zh");
  assert.equal(result.confidence, 0.97);
  assert.deepEqual(result.candidates, ["你好世界", "你好世姐"]);
});

test("AsrEngineProxy rejects pending requests when the worker exits unexpectedly", async () => {
  const worker = createFakeWorker();
  const proxy = new AsrEngineProxy({
    modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
    recognitionMode: "non_streaming",
    computeBackend: "cpu",
    forkProcess: () => worker,
    resolveNodeExecPath: () => "node",
  });

  const initPromise = proxy.initialize();
  const pending = initPromise.catch((error) => error);
  worker.emit("exit", 1, "SIGTERM");
  const error = await pending;
  assert.match(error.message, /exited/);
});

