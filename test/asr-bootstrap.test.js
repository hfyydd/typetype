const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadAsrBootstrapWithMocks({ findModelPath, initialize }) {
  const modulePath = require.resolve("../dist-electron/asr-bootstrap.js");
  const originalLoad = Module._load;

  delete require.cache[modulePath];
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getAppPath: () => "/Applications/typetype.app/Contents/Resources/app.asar",
        },
      };
    }

    if (request.endsWith("/asr-engine") || request === "./asr-engine") {
      return {
        AsrEngine: class FakeAsrEngine {
          constructor(modelPath, tokensPath) {
            this.modelPath = modelPath;
            this.tokensPath = tokensPath;
          }

          static findModelPath(paths) {
            return findModelPath(paths);
          }

          async initialize() {
            return initialize(this);
          }
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("initializeAsrEngine prefers the configured model path before fallback search paths", async () => {
  const calls = [];
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath(paths) {
      calls.push(paths);
      if (paths[0] === "/tmp/custom-model") {
        return {
          modelPath: "/tmp/custom-model/model.int8.onnx",
          tokensPath: "/tmp/custom-model/tokens.txt",
        };
      }
      return null;
    },
    async initialize() {},
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: {
      hotkey: "F8",
      microphone_id: null,
      auto_paste: true,
      custom_dictionary: [],
      model_path: "/tmp/custom-model",
      pinned_model_version: "sherpa-onnx-sense-voice",
    },
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  assert.deepEqual(calls, [["/tmp/custom-model"]]);
});
