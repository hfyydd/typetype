const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureStreamingFinalPunctuation,
  prefixStreamingBoundaryPunctuation,
} = require("../dist-electron/streaming-punctuation.js");

test("prefixStreamingBoundaryPunctuation inserts a Chinese comma between paused streaming chunks", () => {
  assert.equal(
    prefixStreamingBoundaryPunctuation("今天我们测试流式输入", "然后继续说下一段"),
    "，然后继续说下一段"
  );
});

test("prefixStreamingBoundaryPunctuation does not duplicate existing punctuation", () => {
  assert.equal(
    prefixStreamingBoundaryPunctuation("今天已经结束。", "然后继续"),
    "然后继续"
  );
  assert.equal(
    prefixStreamingBoundaryPunctuation("今天继续", "，然后继续"),
    "，然后继续"
  );
});

test("ensureStreamingFinalPunctuation adds final sentence punctuation", () => {
  assert.equal(ensureStreamingFinalPunctuation("今天测试流式输入"), "今天测试流式输入。");
  assert.equal(ensureStreamingFinalPunctuation("这个功能好不好"), "这个功能好不好？");
  assert.equal(ensureStreamingFinalPunctuation("今天先说到这里，"), "今天先说到这里。");
});
