const test = require("node:test");
const assert = require("node:assert/strict");

const { usesRecorderWindow } = require("../dist-electron/recorder-platform.js");

test("usesRecorderWindow routes Windows through the hidden recorder window", () => {
  assert.equal(usesRecorderWindow("win32"), true);
});

test("usesRecorderWindow routes macOS through the hidden recorder window", () => {
  assert.equal(usesRecorderWindow("darwin"), true);
});

test("usesRecorderWindow does not claim Linux support", () => {
  assert.equal(usesRecorderWindow("linux"), false);
});

test("usesRecorderWindow rejects other platforms (freebsd, aix, etc.)", () => {
  assert.equal(usesRecorderWindow("freebsd"), false);
  assert.equal(usesRecorderWindow("openbsd"), false);
  assert.equal(usesRecorderWindow("sunos"), false);
});
