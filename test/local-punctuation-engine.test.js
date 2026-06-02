const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  hasRequiredPunctuationFiles,
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
