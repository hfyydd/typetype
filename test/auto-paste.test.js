const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FOREGROUND_RESTORE_DELAY_MS,
  createWindowsCaptureForegroundScript,
  createWindowsPasteScript,
  createWindowsRestoreForegroundScript,
  encodePowerShellCommand,
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

test("createWindowsPasteScript sends Ctrl+V instead of a bare V keystroke", () => {
  const script = createWindowsPasteScript();

  assert.match(script, /\$VK_CONTROL = 0x11/);
  assert.match(script, /\$VK_V = 0x56/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, \$KEYEVENTF_KEYUP/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, \$KEYEVENTF_KEYUP/);
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
  assert.match(script, /ShowWindowAsync/);
  assert.match(script, /AppActivate\(456\)/);
});

test("encodePowerShellCommand produces a base64 payload for EncodedCommand", () => {
  const encoded = encodePowerShellCommand('Write-Output "hello"');

  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
});
