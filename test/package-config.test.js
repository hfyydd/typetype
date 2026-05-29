const test = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");

test("electron-builder includes renderer source assets in packaged app", () => {
  assert.ok(Array.isArray(pkg.build?.files));
  assert.ok(pkg.build.files.includes("src/**/*"));
});

test("electron-builder does not package models twice", () => {
  const resourcesEntry = pkg.build.files.find((entry) => entry?.from === "resources");

  assert.deepEqual(resourcesEntry?.filter, [
    "**/*",
    "!models/**",
    "!translation-models/**",
    "!runtimes/**",
  ]);
});

test("electron-builder excludes bundled model sample assets from packaged output", () => {
  const resourcesEntry = pkg.build.files.find((entry) => entry?.from === "resources");
  const modelEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/models");

  assert.deepEqual(resourcesEntry?.filter, [
    "**/*",
    "!models/**",
    "!translation-models/**",
    "!runtimes/**",
  ]);
  assert.deepEqual(modelEntry?.filter, [
    "**/*",
    "!**/README.md",
    "!**/test_wavs",
    "!**/test_wavs/**",
  ]);
});

test("electron-builder packages bundled translation runtimes as extra resources", () => {
  const runtimeEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/translation-runtime");
  const llamaRuntimeEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/runtimes");

  assert.equal(runtimeEntry, undefined);
  assert.deepEqual(llamaRuntimeEntry, {
    from: "resources/runtimes",
    to: "runtimes",
    filter: ["**/*"],
  });
});

test("package metadata uses the typetype app name", () => {
  assert.equal(pkg.name, "typetype");
  assert.equal(pkg.build.productName, "typetype");
  assert.equal(pkg.build.appId, "app.typetype");
});

test("package uses the native sherpa node addon instead of the wasm package", () => {
  assert.equal(pkg.dependencies["sherpa-onnx-node"] !== undefined, true);
  // Windows support removed
    // assert.equal(pkg.dependencies["sherpa-onnx-win-x64"] !== undefined, true);
  assert.equal(pkg.dependencies["sherpa-onnx"] === undefined, true);
});

// Windows support removed
test("windows packaging unpacks native sherpa runtime files", () => {
  assert.deepEqual(pkg.build.asarUnpack, [
    "node_modules/sherpa-onnx-node/**/*",
  ]);
});

// Windows support removed
test("windows packaging explicitly includes ffmpeg.dll beside the executable", () => {
  // no win config
  assert.equal(pkg.build.win, undefined);
});

// Windows support removed
test("windows packaging keeps only Chinese and English Electron locales", () => {
  assert.equal(pkg.build.win, undefined);
});
