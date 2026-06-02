const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readPngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("icon assets are present for app, installer, and tray", () => {
  const root = path.join(__dirname, "..");
  const iconPng = fs.readFileSync(path.join(root, "resources/icon.png"));
  const iconIco = fs.statSync(path.join(root, "resources/icon.ico"));
  const trayIcon = fs.readFileSync(path.join(root, "resources/tray-icons/idle/frame_0.png"));
  const trayIcon16 = fs.readFileSync(path.join(root, "resources/tray-icons-16/idle/frame_0.png"));

  assert.deepEqual(readPngSize(iconPng), { width: 1024, height: 1024 });
  assert.equal(iconIco.size > 10000, true);
  assert.deepEqual(readPngSize(trayIcon), { width: 32, height: 32 });
  assert.deepEqual(readPngSize(trayIcon16), { width: 16, height: 16 });
});
