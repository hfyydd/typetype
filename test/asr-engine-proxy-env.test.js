const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const { AsrEngineProxy } = require("../dist-electron/asr-engine-proxy.js");

function createFakeWorker() {
  const emitter = new EventEmitter();
  emitter.sent = [];
  emitter.send = (message) => emitter.sent.push(message);
  emitter.kill = () => {};
  return emitter;
}

test("proxy injects TYPETYPE_RESOURCES_PATH so the worker can locate app.asar.unpacked modules", () => {
  const captured = {};
  const fakeWorker = createFakeWorker();

  // Simulate the worker process importing sherpa-onnx-node via the
  // env-var hint the proxy is supposed to set. We don't actually fork
  // anything; we just verify the env-var logic inside ensureWorker.
  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, "resourcesPath", {
    value: "/Applications/typetype.app/Contents/Resources",
    configurable: true,
  });

  try {
    const proxy = new AsrEngineProxy({
      modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
      recognitionMode: "non_streaming",
      computeBackend: "cpu",
      forkProcess: (modulePath, args, options) => {
        captured.modulePath = modulePath;
        captured.args = args;
        captured.env = options.env;
        captured.execPath = options.execPath;
        return fakeWorker;
      },
      resolveNodeExecPath: () => "node",
    });

    void proxy.initialize();
    assert.equal(captured.env.TYPETYPE_RESOURCES_PATH,
      "/Applications/typetype.app/Contents/Resources");
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath;
    } else {
      Object.defineProperty(process, "resourcesPath", {
        value: originalResourcesPath,
        configurable: true,
      });
    }
  }
});

test("proxy passes the worker through the fork() contract with stdio ipc channel 3", () => {
  const captured = {};
  const fakeWorker = createFakeWorker();
  const proxy = new AsrEngineProxy({
    modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
    recognitionMode: "non_streaming",
    computeBackend: "cpu",
    forkProcess: (modulePath, args, options) => {
      captured.stdio = options.stdio;
      return fakeWorker;
    },
    resolveNodeExecPath: () => "node",
  });
  void proxy.initialize();
  // stdio[3] is the IPC channel that lets process.send / process.on('message') work.
  assert.deepEqual(captured.stdio[3], "ipc");
});

test("proxy falls back to a bare require('sherpa-onnx-node') when no resourcesPath is set (dev mode)", () => {
  // The proxy itself should not throw when process.resourcesPath is
  // undefined; the worker then relies on loadSherpaOnnxNode's
  // fallthrough. This guards against a regression where ensureWorker
  // crashes in `npm run dev` / tests.
  const fakeWorker = createFakeWorker();
  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, "resourcesPath", {
    value: undefined,
    configurable: true,
  });

  try {
    const proxy = new AsrEngineProxy({
      modelFiles: { modelPath: "/m.onnx", tokensPath: "/t.txt" },
      recognitionMode: "non_streaming",
      computeBackend: "cpu",
      forkProcess: () => fakeWorker,
      resolveNodeExecPath: () => "node",
    });
    assert.doesNotThrow(() => void proxy.initialize());
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath;
    } else {
      Object.defineProperty(process, "resourcesPath", {
        value: originalResourcesPath,
        configurable: true,
      });
    }
  }
});
