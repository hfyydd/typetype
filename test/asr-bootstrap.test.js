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

test("initializeAsrEngine successfully downloads and decompresses model archive", async () => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const cp = require("child_process");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-test-"));
  const modelDirName = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";
  const srcDir = path.join(tmpDir, modelDirName);
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, "tokens.txt"), "tokens content");
  fs.writeFileSync(path.join(srcDir, "model.int8.onnx"), "model content");

  const archivePath = path.join(tmpDir, "archive.tar.bz2");
  cp.execSync(`tar -cf - -C "${tmpDir}" "${modelDirName}" | bzip2 > "${archivePath}"`);
  const archiveBuffer = fs.readFileSync(archivePath);

  // Clean up source dir to verify decompression recreates it
  fs.rmSync(srcDir, { recursive: true, force: true });

  const { initializeAsrEngine } = loadAsrBootstrapWithMocks({
    findModelPath(paths) {
      // Return null on first check to force download,
      // but find the model on second check (after download/extraction finishes)
      const found = paths.some(p => p.includes(modelDirName) && fs.existsSync(path.join(p, "tokens.txt")));
      if (found) {
        return {
          modelPath: path.join(paths[0], "model.int8.onnx"),
          tokensPath: path.join(paths[0], "tokens.txt"),
        };
      }
      return null;
    },
    async initialize() {},
    moduleMocks: {
      https: createHttpsMock({
        response: {
          statusCode: 200,
          headers: { "content-length": String(archiveBuffer.length) },
          body: archiveBuffer,
        },
      }),
      // We do NOT mock fs so that real filesystem operations are tested
    },
  });

  const targetDataDir = path.join(tmpDir, "target-data");
  const engine = await initializeAsrEngine({
    dataDir: targetDataDir,
    settings: createSettings({
      pinned_model_version: "sherpa-onnx-sense-voice",
    }),
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.ok(engine);
  // Verify files were extracted correctly
  const extractedModelPath = path.join(targetDataDir, "models", modelDirName, "model.int8.onnx");
  const extractedTokensPath = path.join(targetDataDir, "models", modelDirName, "tokens.txt");
  assert.ok(fs.existsSync(extractedModelPath));
  assert.ok(fs.existsSync(extractedTokensPath));
  assert.equal(fs.readFileSync(extractedModelPath, "utf8"), "model content");
  assert.equal(fs.readFileSync(extractedTokensPath, "utf8"), "tokens content");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

