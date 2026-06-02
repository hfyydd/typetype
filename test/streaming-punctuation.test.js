const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prefixStreamingBoundaryPunctuation,
  ensureStreamingFinalPunctuation,
} = require("../dist-electron/streaming-punctuation.js");

test("streaming boundary punctuation does not insert mechanical commas", () => {
  assert.equal(prefixStreamingBoundaryPunctuation("今天我们开会", "讨论项目进度"), "讨论项目进度");
  assert.equal(prefixStreamingBoundaryPunctuation("今天我们开会，", "讨论项目进度"), "讨论项目进度");
});

test("streaming final punctuation still adds a sentence ending", () => {
  assert.equal(ensureStreamingFinalPunctuation("今天我们开会"), "今天我们开会。");
});
