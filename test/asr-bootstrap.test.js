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
    streaming_model: "multilingual_realtime",
    compute_backend: "auto",
    voice_package: "fast_offline",
    streaming_enhancement_mode: "offline_private",
    rewrite_scenario: "general",
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
          constructor(modelInfo, options) {
            this.modelInfo = modelInfo;
            this.options = options;
          }

          static findModelPath(paths, recognitionMode) {
            return findModelPath(paths, recognitionMode);
          }

          async initialize() {
            return initialize(this);
          }
        },
      };
    }

    if (request.endsWith("/asr-engine-proxy") || request === "./asr-engine-proxy") {
      return {
        AsrEngineProxy: class FakeAsrEngineProxy {
          constructor(options) {
            this.options = options;
            this.modelInfo = options.modelFiles;
          }
          async initialize() {
            return initialize(this);
          }
          async destroy() {}
          async reinitialize() {}
          getModelPath() { return this.modelInfo?.modelPath ?? null; }
          getModelDirectory() { return null; }
          getActiveProvider() { return 'cpu'; }
          getRecognitionMode() { return this.options.recognitionMode; }
          getRuntimeLabel() { return 'fake · offline · CPU'; }
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

test("initializeAsrEngine defaults streaming to multilingual realtime model", async () => {
  const calls = [];
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath(paths, recognitionMode) {
      calls.push({ paths, recognitionMode });
      return {
        modelPath: "/resources/models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en/encoder.int8.onnx",
        tokensPath: "/resources/models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en/tokens.txt",
        encoderPath: "/resources/models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en/encoder.int8.onnx",
        decoderPath: "/resources/models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en/decoder.int8.onnx",
      };
    },
    async initialize() {},
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings({
      recognition_mode: "streaming_output",
      streaming_model: "multilingual_realtime",
    }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  assert.equal(calls[0].recognitionMode, "streaming_output");
  assert.match(calls[0].paths[0], /streaming-paraformer-trilingual/);
  assert.match(calls[0].paths.join("\n"), /streaming-zipformer-ctc-zh-xlarge/);
  assert.equal(engine.options.recognitionMode, "streaming_output");
});

test("initializeAsrEngine uses non-streaming multilingual model for segmented streaming", async () => {
  const calls = [];
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath(paths, recognitionMode) {
      calls.push({ paths, recognitionMode });
      return {
        modelPath: "/resources/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8/model.int8.onnx",
        tokensPath: "/resources/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8/tokens.txt",
      };
    },
    async initialize() {},
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings({
      recognition_mode: "streaming_output",
      streaming_model: "multilingual_segmented",
    }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  assert.equal(calls[0].recognitionMode, "non_streaming");
  assert.match(calls[0].paths[0], /sense-voice/);
  assert.equal(engine.options.recognitionMode, "non_streaming");
});

test("initializeAsrEngine prioritizes Chinese realtime model when selected", async () => {
  const calls = [];
  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath(paths, recognitionMode) {
      calls.push({ paths, recognitionMode });
      return {
        modelPath: "/resources/models/sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8/model.int8.onnx",
        tokensPath: "/resources/models/sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8/tokens.txt",
        bpeVocabPath: "/resources/models/sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8/bpe.model",
      };
    },
    async initialize() {},
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings({
      recognition_mode: "streaming_output",
      streaming_model: "zh_high_accuracy_realtime",
    }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  assert.equal(calls[0].recognitionMode, "streaming_output");
  assert.match(calls[0].paths[0], /streaming-zipformer-ctc-zh-xlarge/);
  assert.match(calls[0].paths.join("\n"), /streaming-paraformer-trilingual/);
  assert.equal(engine.options.recognitionMode, "streaming_output");
});



test("initializeAsrEngine returns null and never hits the network when the packaged sense-voice model is missing", async () => {
  // When the packaged model is not on disk, the bootstrap must fail
  // fast with a clear error. The previous behaviour silently
  // downloaded an archive from github.com as a recovery path; that
  // violated the "ships offline" contract, so downloadModel has been
  // removed entirely.
  let httpsCalls = 0;

  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath() {
      return null;
    },
    async initialize() {},
    moduleMocks: {
      fs: createFsMock(),
      https: new Proxy({}, {
        get() {
          httpsCalls += 1;
          throw new Error("initializeAsrEngine must not make any https calls when the packaged model is missing");
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
  assert.equal(httpsCalls, 0, "no network requests should be issued");
});

test("initializeAsrEngine returns null and never hits the network when the streaming model is missing", async () => {
  let httpsCalls = 0;

  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath() {
      return null;
    },
    async initialize() {},
    moduleMocks: {
      fs: createFsMock(),
      https: new Proxy({}, {
        get() {
          httpsCalls += 1;
          throw new Error("initializeAsrEngine must not make any https calls when the streaming model is missing");
        },
      }),
    },
  });

  const engine = await initializeAsrEngine({
    dataDir: "/tmp/typetype-data",
    settings: createSettings({ recognition_mode: "streaming_output" }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.equal(engine, null);
  assert.equal(httpsCalls, 0, "no network requests should be issued");
});
