const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyDictionaryReplacements,
  buildImportPreview,
  createDictionaryEntry,
  findMatchedDictionaryTerms,
} = require("../dist-electron/dictionary-engine.js");

test("dictionary replacements prefer longer aliases and keep terms local", () => {
  const entries = [
    createDictionaryEntry({
      kind: "replacement",
      term: "typetype",
      aliases: ["太普太普", "太普"],
      replacement: "typetype",
    }),
    createDictionaryEntry({
      kind: "term",
      term: "结构化润写",
    }),
  ];

  const result = applyDictionaryReplacements("太普太普可以做结构化润写", entries);
  assert.equal(result, "typetype可以做结构化润写");
});

test("dictionary matched terms include user and system lexicon terms", () => {
  const entries = [
    createDictionaryEntry({ kind: "term", term: "客户专有名词" }),
    createDictionaryEntry({ kind: "replacement", term: "MiniMax", aliases: ["迷你麦克斯"], replacement: "MiniMax" }),
  ];
  const systemEntries = [
    { term: "会议纪要", category: "办公/会议", source: "test" },
    { term: "没有命中", category: "测试", source: "test" },
  ];

  const terms = findMatchedDictionaryTerms("今天的会议纪要要保留客户专有名词和MiniMax", entries, systemEntries);
  assert.deepEqual(terms, ["MiniMax", "客户专有名词", "会议纪要"]);
});

test("dictionary import preview classifies add duplicate invalid and too long", () => {
  const existing = [
    createDictionaryEntry({ kind: "term", term: "typetype" }),
  ];
  const preview = buildImportPreview([
    { term: "typetype", kind: "term", raw: "typetype" },
    { term: "DeepSeek", kind: "term", raw: "DeepSeek" },
    { term: "", kind: "term", raw: "" },
    { term: "x".repeat(81), kind: "term", raw: "x".repeat(81) },
  ], existing, "paste");

  assert.equal(preview.summary.added, 1);
  assert.equal(preview.summary.duplicate, 1);
  assert.equal(preview.summary.invalid, 1);
  assert.equal(preview.summary.too_long, 1);
});
