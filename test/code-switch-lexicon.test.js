const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { CodeSwitchLexicon } = require("../dist-electron/code-switch-lexicon.js");

const lexiconPath = path.join(__dirname, "..", "resources", "lexicons", "code-switch-lexicon.json");

function createLexicon() {
  return new CodeSwitchLexicon({
    resourcesPath: path.join(__dirname, "..", "resources"),
  });
}

test("bundled code-switch lexicon is a real 10000-entry first-release library", () => {
  const parsed = JSON.parse(fs.readFileSync(lexiconPath, "utf8"));
  const terms = new Set(parsed.entries.map((entry) => entry.term));

  assert.ok(parsed.entries.length >= 10000);
  assert.equal(terms.has("check 一下"), true);
  assert.equal(terms.has("send 个 file"), true);
  assert.equal(terms.has("你有冇 confirm meeting"), true);
  assert.equal(terms.has("DeepSeek V4 Flash"), true);
  assert.equal(terms.has("deepseek-v4-flash"), true);
  assert.equal(terms.has("Qwen3.6 Plus"), true);
  assert.equal(terms.has("Kimi K2.6"), true);
  assert.equal(terms.has("MiniMax M2.7"), true);
  assert.equal(terms.has("GLM-5.1"), true);
  assert.equal(terms.has("Doubao Seed 2.0 Code"), true);
  assert.equal(terms.has("RAG"), true);
  assert.equal(terms.has("embedding"), true);
  assert.equal(terms.has("tool calling"), true);
});

test("CodeSwitchLexicon restores common mixed Chinese-English workplace terms", () => {
  const lexicon = createLexicon();
  const result = lexicon.applyToText("今天开个密厅然后review一下PRD和皮皮踢");

  assert.equal(result.text.includes("meeting"), true);
  assert.equal(result.text.includes("review"), true);
  assert.equal(result.text.includes("PRD"), true);
  assert.equal(result.text.includes("PPT"), true);
  assert.ok(result.replacementCount >= 2);
});

test("CodeSwitchLexicon keeps AI professional terms as English inside Chinese speech", () => {
  const lexicon = createLexicon();
  const result = lexicon.applyToText("今天讲rag和embedding还有Kimi K2.6以及DeepSeek V4 Flash");

  assert.equal(result.text.includes("RAG"), true);
  assert.equal(result.text.includes("embedding"), true);
  assert.equal(result.text.includes("Kimi K2.6"), true);
  assert.equal(result.text.includes("DeepSeek V4 Flash"), true);
});

test("CodeSwitchLexicon avoids high-risk false positives without technical context", () => {
  const lexicon = createLexicon();
  const result = lexicon.applyToText("他说披啊这个词只是语气词，不是代码合并");

  assert.equal(result.text.includes("PR"), false);
  assert.equal(result.replacementCount, 0);
});

test("CodeSwitchLexicon preserves high-risk developer terms with enough context", () => {
  const lexicon = createLexicon();
  const result = lexicon.applyToText("这个代码皮阿需要合并到主分支");

  assert.equal(result.text.includes("PR"), true);
  assert.equal(result.highRiskCount, 1);
});
