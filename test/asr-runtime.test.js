const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDefaultNumThreads,
  getProviderCandidates,
} = require("../dist-electron/asr-runtime.js");

test("getProviderCandidates prefers hardware backends before cpu in auto mode", () => {
  assert.deepEqual(getProviderCandidates("auto", "darwin"), ["coreml", "cpu"]);
  assert.deepEqual(getProviderCandidates("auto", "win32"), ["cuda", "directml", "cpu"]);
});

test("getProviderCandidates restricts to cpu when compute backend is cpu", () => {
  assert.deepEqual(getProviderCandidates("cpu", "darwin"), ["cpu"]);
  assert.deepEqual(getProviderCandidates("cpu", "win32"), ["cpu"]);
});

test("getProviderCandidates excludes cpu fallback when gpu is required", () => {
  assert.deepEqual(getProviderCandidates("gpu", "darwin"), ["coreml"]);
  assert.deepEqual(getProviderCandidates("gpu", "win32"), ["cuda", "directml"]);
});

test("getDefaultNumThreads caps worker thread count to keep the app responsive", () => {
  assert.equal(getDefaultNumThreads(1), 1);
  assert.equal(getDefaultNumThreads(2), 2);
  assert.equal(getDefaultNumThreads(8), 6);
});
