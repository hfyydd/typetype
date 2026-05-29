const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  extractAutoLearnedTerms,
  isLearnableTerm,
} = require("../dist-electron/auto-learning.js");
const { DictionaryStore } = require("../dist-electron/dictionary-store.js");

test("auto learning extracts high-confidence local terms and filters secrets", () => {
  const terms = extractAutoLearnedTerms(
    "MiniMax-M2.7 和 DeepSeek 都要保留，王晓明今天提到王晓明，还提到南安客户。邮箱 test@example.com，API Key sk-cp-abcdefghijklmnop123456，手机号 13812345678。"
  ).map((item) => item.term);

  assert.equal(terms.includes("MiniMax-M2.7"), true);
  assert.equal(terms.includes("DeepSeek"), true);
  assert.equal(terms.includes("王晓明"), true);
  assert.equal(terms.includes("南安客户"), true);
  assert.equal(terms.some((term) => term.includes("example.com")), false);
  assert.equal(terms.some((term) => term.includes("sk-cp")), false);
  assert.equal(terms.some((term) => term.includes("13812345678")), false);
  assert.equal(isLearnableTerm("test@example.com"), false);
});

test("DictionaryStore silently learns local terms and can promote them to manual", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-dict-"));
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-res-"));

  try {
    const store = new DictionaryStore({ dataDir, resourcesPath });
    const result = store.autoLearnFromText(
      "MiniMax-M2.7、DeepSeek、王晓明、王晓明、南安客户",
      true
    );

    assert.equal(result.learned >= 4, true);
    let view = store.getViewData();
    assert.equal(view.stats.auto_learned >= 4, true);
    assert.ok(view.stats.last_auto_learned_at);

    const learned = view.entries.find((entry) => entry.source === "auto_learned" && entry.term === "MiniMax-M2.7");
    assert.ok(learned);
    store.promoteAutoLearnedEntry(learned.id);
    view = store.getViewData();
    assert.equal(view.entries.find((entry) => entry.id === learned.id).source, "manual");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(resourcesPath, { recursive: true, force: true });
  }
});
