const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { PassThrough, Writable } = require("node:stream");

function createSettings(overrides = {}) {
  return {
    hotkey: "F8",
    translate_hotkey: "F9",
    microphone_id: null,
    auto_paste: true,
    launch_at_login: false,
    recognition_mode: "non_streaming",
    compute_backend: "auto",
    translation_target_language: "en",
    custom_dictionary: [],
    model_path: null,
    pinned_model_version: "sherpa-onnx-sense-voice",
    llm_rewrite: {
      enabled: false,
      provider: "openai",
      api_key: "",
      base_url: "",
      model: "",
      temperature: 0.2,
      max_tokens: 256,
    },
    ...overrides,
  };
}

function createHttpsMock({ response, requestError }) {
  return {
    get(_url, callback) {
      const request = new PassThrough();
      request.setTimeout = () => request;
      request.destroy = (error) => {
        PassThrough.prototype.destroy.call(request, error);
        return request;
      };

      process.nextTick(() => {
        if (requestError) {
          request.emit("error", requestError);
          return;
        }

        const body = new PassThrough();
        body.statusCode = response.statusCode;
        body.headers = response.headers ?? {};
        callback(body);
        if (response.body) {
          body.end(response.body);
        } else {
          body.resume();
          body.end();
        }
      });

      return request;
    },
  };
}

function createFsMock(overrides = {}) {
  const realFs = require("fs");
  return {
    ...realFs,
    existsSync() {
      return false;
    },
    mkdirSync() {},
    rmSync() {},
    unlinkSync() {},
    ...overrides,
  };
}

function createFsMockWithFailingWriteStream() {
  return createFsMock({
    createWriteStream() {
      const stream = new Writable({
        write(_chunk, _encoding, callback) {
          callback(new Error("mock write failure"));
        },
      });
      stream.close = (callback) => {
        callback?.();
      };
      return stream;
    },
  });
}

function loadAsrBootstrapWithMocks({ findModelPath, initialize, moduleMocks = {} }) {
  const modulePath = require.resolve("../dist-electron/asr-bootstrap.js");
  const originalLoad = Module._load;

  delete require.cache[modulePath];
  Module._load = function mockLoad(request, parent, isMain) {
    if (moduleMocks[request]) {
      return moduleMocks[request];
    }

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
    settings: createSettings({
      custom_dictionary: [],
      model_path: "/tmp/custom-model",
      pinned_model_version: "sherpa-onnx-sense-voice",
    }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  assert.deepEqual(calls, [["/tmp/custom-model"]]);
});

test("initializeAsrEngine returns null instead of throwing when model download request fails", async () => {
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath() {
      return null;
    },
    async initialize() {},
    moduleMocks: {
      fs: createFsMock(),
      https: createHttpsMock({
        requestError: new Error("network unavailable"),
      }),
    },
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings(),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.equal(engine, null);
});

test("initializeAsrEngine returns null instead of throwing when temp download file cannot be written", async () => {
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath() {
      return null;
    },
    async initialize() {},
    moduleMocks: {
      fs: createFsMockWithFailingWriteStream(),
      https: createHttpsMock({
        response: {
          statusCode: 200,
          headers: { "content-length": "4" },
          body: Buffer.from("test"),
        },
      }),
    },
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings(),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.equal(engine, null);
});
