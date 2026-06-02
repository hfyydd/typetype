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

function expectedDictationAccelerators() {
  return process.platform === "win32" ? ["Control+/", "F8"] : ["Control+/"];
}

function expectedTranslationAccelerators() {
  return process.platform === "win32" ? ["Control+.", "F9"] : ["Control+."];
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
    ...expectedDictationAccelerators().map((accelerator) => ["register", accelerator, "function"]),
    ...expectedTranslationAccelerators().map((accelerator) => ["register", accelerator, "function"]),
    ...expectedDictationAccelerators().map((accelerator) => ["unregister", accelerator]),
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

  assert.deepEqual(calls, [
    ...expectedDictationAccelerators(),
    ...expectedTranslationAccelerators(),
  ]);
});

test("ShortcutManager falls back to F9 for Ctrl+. on Windows when registration fails", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return accelerator === "F9";
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("translation", "CtrlDot", () => {}), true);
  assert.equal(manager.getCurrentHotkey("translation"), "F9");
  assert.deepEqual(calls, ["Control+.", "F9"]);
});

test("ShortcutManager falls back to F8 for Ctrl+/ on Windows when registration fails", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return accelerator === "F8";
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", "CtrlSlash", () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "F8");
  assert.deepEqual(calls, ["Control+/", "F8"]);
});

test("ShortcutManager registers both Ctrl+/ and F8 on Windows when available", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", "CtrlSlash", () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "CtrlSlash,F8");
  assert.deepEqual(calls, ["Control+/", "F8"]);
});

test("ShortcutManager can suppress fallback hotkeys reserved by another action", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(
    manager.register("dictation", "CtrlSlash", () => {}, { disabledFallbackHotkeys: ["F8"] }),
    true
  );
  assert.equal(manager.getCurrentHotkey("dictation"), "CtrlSlash");
  assert.deepEqual(calls, ["Control+/"]);
});

test("ShortcutManager exposes Windows dictation and translation shortcuts", () => {
  if (process.platform !== "win32") {
    return;
  }

  const { ShortcutManager } = loadShortcutManagerWithMock({
    register() { return true; },
    unregister() {},
    isRegistered() { return false; },
  });

  const values = new ShortcutManager().getAvailableShortcuts().map((shortcut) => shortcut.value);

  assert.equal(values.includes("CtrlSlash"), true);
  assert.equal(values.includes("CtrlDot"), true);
  assert.equal(values.includes("AltDictation"), true);
  assert.equal(values.includes("AltTranslation"), true);
  assert.equal(values.includes("F8"), true);
  assert.equal(values.includes("F9"), true);
});

test("ShortcutManager keeps legacy right Alt hotkey values working", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();
  const legacyPrefix = ["Type", "less"].join("");

  assert.equal(manager.register("dictation", `${legacyPrefix}Dictation`, () => {}), true);
  assert.equal(manager.register("translation", `${legacyPrefix}Translation`, () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "AltDictation,F8");
  assert.equal(manager.getCurrentHotkey("translation"), "AltTranslation,F9");
  assert.deepEqual(calls, ["AltGr", "F8", "AltGr+Shift", "F9"]);
});
