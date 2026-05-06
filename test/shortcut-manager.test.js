const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadShortcutManagerWithMock(globalShortcutMock) {
  const modulePath = require.resolve("../dist-electron/shortcut-manager.js");
  const originalLoad = Module._load;

  delete require.cache[modulePath];
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "electron") {
      return { globalShortcut: globalShortcutMock };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function translationHotkeyForPlatform() {
  return { value: "CtrlDot", accelerator: "Control+." };
}

function dictationHotkeyForPlatform() {
  return { value: "CtrlSlash", accelerator: "Control+/" };
}

test("ShortcutManager unregisters only the requested managed accelerator", () => {
  const calls = [];
  const translationHotkey = translationHotkeyForPlatform();
  const dictationHotkey = dictationHotkeyForPlatform();
  const globalShortcutMock = {
    register(accelerator, handler) {
      calls.push(["register", accelerator, typeof handler]);
      return true;
    },
    unregister(accelerator) {
      calls.push(["unregister", accelerator]);
    },
    unregisterAll() {
      calls.push(["unregisterAll"]);
    },
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", dictationHotkey.value, () => {}), true);
  assert.equal(manager.register("translation", translationHotkey.value, () => {}), true);
  manager.unregister("dictation");

  assert.deepEqual(calls, [
    ["register", dictationHotkey.accelerator, "function"],
    ["register", translationHotkey.accelerator, "function"],
    ["unregister", dictationHotkey.accelerator],
  ]);
});

test("ShortcutManager unregisterAll only clears shortcuts it registered", () => {
  const calls = [];
  const translationHotkey = translationHotkeyForPlatform();
  const dictationHotkey = dictationHotkeyForPlatform();
  const globalShortcutMock = {
    register() {
      return true;
    },
    unregister(accelerator) {
      calls.push(accelerator);
    },
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  manager.register("dictation", dictationHotkey.value, () => {});
  manager.register("translation", translationHotkey.value, () => {});
  manager.unregisterAll();

  assert.deepEqual(calls, [dictationHotkey.accelerator, translationHotkey.accelerator]);
});

test("ShortcutManager does not fall back for Ctrl+. on Windows when registration fails", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return accelerator === "CommandOrControl+Shift+V";
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("translation", "CtrlDot", () => {}), false);
  assert.equal(manager.getCurrentHotkey("translation"), null);
  assert.deepEqual(calls, ["Control+."]);
});
