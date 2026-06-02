const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStreamingAiResult,
  sanitizeStreamingAiText,
} = require("../dist-electron/streaming-ai-text.js");

test("streaming AI text sanitizer removes markdown and generated status sections", () => {
  const cleaned = sanitizeStreamingAiText(`
**功能介绍：**
- 这是演示说明

AI修正原文：
**今天上午开会，讨论客户交付。**

整理稿：
**一、会议要点**
- 确认交付时间
- 安排负责人

**当前状态：**
正在演示该功能。
`);

  assert.equal(cleaned.includes("**"), false);
  assert.equal(cleaned.includes("- 确认"), false);
  assert.equal(cleaned.includes("功能介绍"), false);
  assert.equal(cleaned.includes("当前状态"), false);
  assert.equal(cleaned.includes("今天上午开会，讨论客户交付。"), true);
  assert.equal(cleaned.includes("确认交付时间"), true);
});

test("streaming AI parser separates refined raw text and structured draft", () => {
  const parsed = parseStreamingAiResult(`
AI修正原文：
我们今天讨论了产品上线时间，张三负责测试。

整理稿：
一、会议要点
确认产品上线时间。

二、待办
张三负责测试。
`, "原文");

  assert.equal(parsed.refinedRawText, "我们今天讨论了产品上线时间，张三负责测试。");
  assert.equal(parsed.summaryText.includes("一、会议要点"), true);
  assert.equal(parsed.summaryText.includes("张三负责测试。"), true);
});
