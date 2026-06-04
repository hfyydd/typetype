const test = require("node:test");
const assert = require("node:assert/strict");

const { TextInsertionTransaction } = require("../dist-electron/text-insertion-transaction.js");

test("TextInsertionTransaction replaces exactly the text inserted by streaming paste", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) {
      calls.push(["clipboard", text]);
    },
    async pasteToApp(target) {
      calls.push(["paste", target]);
      return { ok: true, targetAppId: target };
    },
    async replaceRecentTextInApp(target, text, chars) {
      calls.push(["replace", target, text, chars]);
      return { ok: true, targetAppId: target };
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");

  await tx.pasteAppend("今天开", "今天开", "editor");
  await tx.pasteAppend(" meeting", "今天开 meeting", "editor");
  const result = await tx.replaceInsertedText("今天开 meeting。", "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(result.charsReplaced, Array.from("今天开 meeting").length);
  assert.equal(tx.getInsertedText(), "今天开 meeting。");
  assert.deepEqual(calls.at(-1), ["replace", "editor", "今天开 meeting。", Array.from("今天开 meeting").length]);
});

test("TextInsertionTransaction refuses to replace when the target changed", async () => {
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp() {
      return { ok: true };
    },
    async replaceRecentTextInApp() {
      throw new Error("should not replace");
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor-a");
  await tx.pasteAppend("原文", "原文", "editor-a");

  const result = await tx.replaceInsertedText("修正文", "editor-b", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "target_changed");
});

test("TextInsertionTransaction does not count failed streaming paste as inserted text", async () => {
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp() {
      return { ok: false, error: "target window not active" };
    },
    async replaceRecentTextInApp() {
      throw new Error("should not replace");
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("wechat");

  const result = await tx.pasteAppend("今天开 meeting", "今天开 meeting", "wechat");

  assert.equal(result.status, "failed");
  assert.equal(tx.hasInsertedText(), false);
  assert.equal(tx.getInsertedText(), "");
  assert.match(result.error, /target window/);
});
