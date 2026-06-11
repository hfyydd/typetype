const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FOREGROUND_RESTORE_DELAY_MS,
  AutoPaste,
  createWindowsCaptureForegroundScript,
  createWindowsPasteScript,
  createWindowsReplaceRecentTextScript,
  createWindowsRestoreForegroundScript,
  createMacReplaceRecentTextScript,
  encodePowerShellCommand,
  isSameWindowsForegroundTarget,
  runAutoPasteSequence,
} = require("../dist-electron/auto-paste.js");

test("runAutoPasteSequence restores the previous app before pasting", async () => {
  const calls = [];

  await runAutoPasteSequence(
    "com.example.editor",
    async (bundleId) => {
      calls.push(["restore", bundleId]);
    },
    async () => {
      calls.push(["paste"]);
    },
    async (ms) => {
      calls.push(["wait", ms]);
    }
  );

  assert.deepEqual(calls, [
    ["restore", "com.example.editor"],
    ["wait", FOREGROUND_RESTORE_DELAY_MS],
    ["paste"],
  ]);
});

test("runAutoPasteSequence pastes immediately when no app restoration target exists", async () => {
  const calls = [];

  await runAutoPasteSequence(
    null,
    async () => {
      calls.push(["restore"]);
    },
    async () => {
      calls.push(["paste"]);
    }
  );

  assert.deepEqual(calls, [["paste"]]);
});

test("createWindowsPasteScript sends Ctrl+V through keybd_event instead of a bare V keystroke", () => {
  const script = createWindowsPasteScript();

  assert.match(script, /\$VK_CONTROL = 0x11/);
  assert.match(script, /\$VK_V = 0x56/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, \$KEYEVENTF_KEYUP/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, \$KEYEVENTF_KEYUP/);
});

test("createWindowsReplaceRecentTextScript selects recent text with SendKeys before pasting", () => {
  const script = createWindowsReplaceRecentTextScript(25);

  assert.match(script, /New-Object -ComObject WScript\.Shell/);
  assert.match(script, /SendKeys\("\^\{END\}"\)/);
  assert.match(script, /SendKeys\("\+\{LEFT\}"\)/);
  assert.match(script, /SendKeys\("\^v"\)/);
  assert.match(script, /\$count = 25/);
});

test("createWindowsCaptureForegroundScript queries the current foreground window handle", () => {
  const script = createWindowsCaptureForegroundScript();

  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetWindowText/);
  assert.match(script, /ConvertTo-Json -Compress/);
});

test("createWindowsRestoreForegroundScript restores a captured window handle", () => {
  const script = createWindowsRestoreForegroundScript(JSON.stringify({
    hwnd: "12345",
    pid: "456",
    title: "Notepad",
    process: "notepad"
  }));

  assert.match(script, /\[IntPtr\]::new\(12345\)/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /BringWindowToTop/);
  assert.match(script, /AttachThreadInput/);
  assert.match(script, /ShowWindowAsync/);
  assert.match(script, /AppActivate\(456\)/);
});

test("encodePowerShellCommand produces a base64 payload for EncodedCommand", () => {
  const encoded = encodePowerShellCommand('Write-Output "hello"');

  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
});

test("isSameWindowsForegroundTarget accepts same handle or same process fallback", () => {
  const expected = JSON.stringify({ hwnd: "123", pid: "456", title: "微信", process: "WeChat" });
  const same = JSON.stringify({ hwnd: "123", pid: "999", title: "微信", process: "WeChat" });
  const sameProcess = JSON.stringify({ hwnd: "124", pid: "456", title: "微信", process: "WeChat" });
  const differentProcess = JSON.stringify({ hwnd: "124", pid: "456", title: "微信", process: "Notepad" });

  assert.equal(isSameWindowsForegroundTarget(expected, same), true);
  assert.equal(isSameWindowsForegroundTarget(expected, sameProcess), true);
  assert.equal(isSameWindowsForegroundTarget(expected, differentProcess), false);
  assert.equal(isSameWindowsForegroundTarget(expected, null), false);
});

test("createMacReplaceRecentTextScript emits one backspace per character followed by Cmd+V", () => {
  const script = createMacReplaceRecentTextScript(5);

  assert.match(script, /tell application "System Events"/);
  const matches = script.match(/key code 51/g) || [];
  assert.equal(matches.length, 5);
  assert.match(script, /keystroke "v" using command down/);
});

test("createMacReplaceRecentTextScript skips the backspace loop and just pastes for zero chars", () => {
  const script = createMacReplaceRecentTextScript(0);

  assert.doesNotMatch(script, /key code 51/);
  assert.match(script, /keystroke "v" using command down/);
});

test("createMacReplaceRecentTextScript caps the backspace count to a safe upper bound", () => {
  const script = createMacReplaceRecentTextScript(99999);

  const matches = script.match(/key code 51/g) || [];
  assert.equal(matches.length, 20000);
});

test("AutoPaste.replaceRecentTextInApp on darwin returns accessibility_required when not granted", async () => {
  if (process.platform !== 'darwin') {
    return;
  }

  const autoPaste = new AutoPaste();
  const result = await autoPaste.replaceRecentTextInApp(
    'com.example.editor',
    '修正后的原文',
    6
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'accessibility_required');
  assert.match(result.error ?? '', /辅助功能/);
});

