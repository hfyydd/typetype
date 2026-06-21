const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  hasRequiredPunctuationFiles,
  inspectOnnxRuntimeNativeFiles,
  LocalPunctuationEngine,
} = require("../dist-electron/local-punctuation-engine.js");

const modelDir = path.join(__dirname, "..", "resources", "punctuation-models", "pcs-47lang");

test("offline punctuation model resources are present", () => {
  assert.equal(hasRequiredPunctuationFiles(modelDir), true);
});

test("offline punctuation model restores punctuation for data governance dictation", async () => {
  const engine = new LocalPunctuationEngine({ modelDir });
  const raw = "服务化基座统一的数据供给模式本层构建了一个统一的数据中台作为支撑为所有业务的唯一数据供给源如图四右侧金字塔所示这一基作由数据管理与整合层与政策规范层共同构成确保了数据的质量与合规所有的标准化核心数据如罪犯档案行为记录等由中台统一管理提供各个业务模块通过标准化与中台连接取得一致准确的数据学啥呢学了走了啊嗯来";
  const result = await engine.restorePunctuation(raw, {
    final: true,
    preserveTerms: ["服务化基座", "数据供给模式", "数据中台", "数据供给源", "标准化核心数据", "业务模块"],
  });

  assert.equal(result.source, "model");
  assert.equal(result.ready, true);
  assert.ok((result.text.match(/[，。；、]/g) || []).length >= 5, result.text);
  assert.ok(result.sentences.length >= 3, result.text);
  assert.equal(result.text.includes("共，同"), false);
  assert.equal(result.text.includes("数据供给，源"), false);
  assert.equal(result.text.includes("标准，化"), false);
  assert.equal(result.text.includes("中，台"), false);
});

test("offline punctuation model missing directory is detected", () => {
  assert.equal(hasRequiredPunctuationFiles(path.join(__dirname, "missing-punctuation-model")), false);
});

test("offline punctuation engine keeps onnxruntime out of top-level startup imports", () => {
  const compiled = fs.readFileSync(path.join(__dirname, "../dist-electron/local-punctuation-engine.js"), "utf8");

  assert.equal(compiled.includes('require("onnxruntime-node")'), false);
  assert.match(compiled, /loadDefaultOnnxRuntime/u);
  assert.match(compiled, /require\('onnxruntime-node'\)/u);
});

test("offline punctuation engine does not load onnxruntime during construction", () => {
  let loaderCalled = false;
  const engine = new LocalPunctuationEngine({
    modelDir,
    onnxRuntimeLoader: () => {
      loaderCalled = true;
      throw new Error("A dynamic link library (DLL) initialization routine failed");
    },
  });

  const status = engine.getStatus();

  assert.equal(loaderCalled, false);
  assert.equal(status.ready, false);
  assert.equal(status.available, true);
});

test("offline punctuation engine falls back when onnxruntime DLL initialization fails", async () => {
  const engine = new LocalPunctuationEngine({
    modelDir,
    onnxRuntimeLoader: () => {
      throw new Error("A dynamic link library (DLL) initialization routine failed");
    },
  });

  const result = await engine.restorePunctuation("今天开会然后同步进度", { final: true });
  const status = engine.getStatus();
  const diagnostics = engine.getDiagnostics();

  assert.equal(result.source, "rules");
  assert.equal(result.ready, false);
  assert.match(result.text, /。$/u);
  assert.match(result.error, /ONNX Runtime 加载失败/u);
  assert.match(status.detail, /本地断句增强需要系统运行库，基础断句已可用/u);
  assert.match(diagnostics.last_error, /DLL/u);
});

test("offline punctuation diagnostics report missing native onnxruntime files", () => {
  const missingNativeDir = path.join(__dirname, "missing-onnxruntime-native");
  const diagnostics = inspectOnnxRuntimeNativeFiles({
    onnxRuntimeNativeDir: missingNativeDir,
  });

  assert.equal(diagnostics.native_dir, missingNativeDir);
  assert.equal(diagnostics.binding_exists, false);
  assert.equal(diagnostics.runtime_dll_exists, false);
  assert.equal(diagnostics.directml_dll_exists, process.platform === "win32" ? false : true);
});
