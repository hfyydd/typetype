const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyVoiceFormattingCommands,
} = require("../dist-electron/transcript-formatting.js");

test("voice formatting commands convert spaces and line breaks", () => {
  assert.equal(
    applyVoiceFormattingCommands("张三空格李四"),
    "张三 李四"
  );
  assert.equal(
    applyVoiceFormattingCommands("第一点换行第二点"),
    "一、\n二、"
  );
});

test("voice formatting commands keep title and blank line structure", () => {
  assert.equal(
    applyVoiceFormattingCommands("标题项目进度隔一行第一点已完成开发"),
    "项目进度\n\n一、已完成开发"
  );
});

test("partial voice formatting only applies safe streaming commands", () => {
  assert.equal(
    applyVoiceFormattingCommands("标题项目进度空格继续换行下一句", { partial: true }),
    "标题项目进度 继续\n下一句"
  );
});
