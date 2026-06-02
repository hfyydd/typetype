const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("streaming AI panel exposes synced text areas and usable actions", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/streaming-ai/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/streaming-ai/streaming-ai.js"), "utf8");

  assert.equal(html.includes('id="raw-text"'), true);
  assert.equal(html.includes('id="ai-text"'), true);
  assert.equal(html.includes('id="status-meta"'), true);
  assert.equal(html.includes('id="copy-raw-button"'), true);
  assert.equal(html.includes('id="copy-ai-button"'), true);
  assert.equal(html.includes('id="clear-button"'), true);
  assert.equal(html.includes('id="apply-refined-raw-button"'), true);
  assert.equal(html.includes("AI 修正原文"), true);
  assert.equal(html.includes("refined_raw_text"), true);
  assert.equal(html.includes("can_apply_refined_raw"), true);
  assert.equal(html.includes("subscribeStreamingAiPanelState(render)"), true);
  assert.equal(html.includes("getStreamingAiPanelState()"), true);
  assert.equal(html.includes("copyStreamingAiRaw()"), true);
  assert.equal(html.includes("copyStreamingAiSummary()"), true);
  assert.equal(html.includes("applyStreamingAiRefinedRaw()"), true);
  assert.equal(html.includes("clearStreamingAiPanel()"), true);
  assert.equal(script.includes("applyRefinedRawButton"), true);
  assert.equal(script.includes("refined_raw_text"), true);
  assert.equal(script.includes("can_apply_refined_raw"), true);
  assert.equal(script.includes("subscribeStreamingAiPanelState(render)"), true);
  assert.equal(script.includes("getStreamingAiPanelState()"), true);
  assert.equal(script.includes("copyStreamingAiRaw()"), true);
  assert.equal(script.includes("copyStreamingAiSummary()"), true);
  assert.equal(script.includes("applyStreamingAiRefinedRaw()"), true);
  assert.equal(script.includes("clearStreamingAiPanel()"), true);
});
