const test = require("node:test");
const assert = require("node:assert/strict");

const { APP_VERSION, LOG_FILE_NAME, getLogDirectory } = require("../dist-electron/logger.js");

test("logger uses the typetype log filename", () => {
  assert.equal(LOG_FILE_NAME, "typetype.log");
});

test("logger exports the current app version for log prefixes", () => {
  assert.equal(APP_VERSION, "0.1.0");
});

test("logger prefers PORTABLE_EXECUTABLE_DIR when present", () => {
  const original = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = "C:\\PortableDir";
  try {
    assert.equal(getLogDirectory(), "C:\\PortableDir");
  } finally {
    if (original === undefined) {
      delete process.env.PORTABLE_EXECUTABLE_DIR;
    } else {
      process.env.PORTABLE_EXECUTABLE_DIR = original;
    }
  }
});
