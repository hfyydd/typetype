const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyBasicTranscriptPunctuation,
  ensureFinalPunctuation,
} = require("../dist-electron/transcript-punctuation.js");

test("applyBasicTranscriptPunctuation adds sentence ending punctuation without LLM", () => {
  assert.equal(applyBasicTranscriptPunctuation("今天测试语音输入"), "今天测试语音输入。");
  assert.equal(applyBasicTranscriptPunctuation("这个功能好不好"), "这个功能好不好？");
});

test("applyBasicTranscriptPunctuation adds conservative commas at common speech boundaries", () => {
  assert.equal(
    applyBasicTranscriptPunctuation("今天先测试原文然后继续测试翻译另外检查快捷键"),
    "今天先测试原文，然后继续测试翻译，另外检查快捷键。"
  );
});

test("applyBasicTranscriptPunctuation does not duplicate existing punctuation", () => {
  assert.equal(
    applyBasicTranscriptPunctuation("今天先测试原文，然后继续测试翻译。"),
    "今天先测试原文，然后继续测试翻译。"
  );
});

test("ensureFinalPunctuation handles English fallback", () => {
  assert.equal(ensureFinalPunctuation("hello world"), "hello world.");
});
