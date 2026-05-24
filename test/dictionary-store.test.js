const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DictionaryStore } = require("../dist-electron/dictionary-store.js");

function createStoreFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-dict-store-"));
  const resourcesPath = path.join(tempDir, "resources");
  const lexiconDir = path.join(resourcesPath, "lexicons");
  fs.mkdirSync(lexiconDir, { recursive: true });
  fs.writeFileSync(path.join(lexiconDir, "system-lexicon.json"), JSON.stringify([
    { term: "会议纪要", category: "办公/会议", source: "test" },
    { term: "DeepSeek", category: "IT/AI", source: "test" },
  ]), "utf-8");

  return {
    tempDir,
    store: new DictionaryStore({
      dataDir: path.join(tempDir, "data"),
      resourcesPath,
      legacyCustomDictionary: [],
    }),
  };
}

test("system lexicon switches are visible, persisted, and filter matched terms", () => {
  const { tempDir, store } = createStoreFixture();
  let view = store.getViewData();

  assert.equal(view.system_lexicon_enabled, true);
  assert.equal(view.stats.system_terms, 2);
  assert.equal(view.stats.system_enabled_terms, 2);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), ["DeepSeek", "会议纪要"]);

  view = store.setSystemCategoryEnabled("IT/AI", false);
  assert.equal(view.system_categories.find((item) => item.category === "IT/AI").enabled, false);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), ["会议纪要"]);

  view = store.setSystemLexiconEnabled(false);
  assert.equal(view.stats.system_enabled_terms, 0);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), []);

  const reloaded = new DictionaryStore({
    dataDir: path.join(tempDir, "data"),
    resourcesPath: path.join(tempDir, "resources"),
    legacyCustomDictionary: [],
  });
  assert.equal(reloaded.getViewData().system_lexicon_enabled, false);
  assert.equal(reloaded.getViewData().system_categories.find((item) => item.category === "IT/AI").enabled, false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
