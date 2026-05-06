const test = require("node:test");
const assert = require("node:assert/strict");

const { getModelSearchPaths } = require("../dist-electron/model-search-paths.js");

test("getModelSearchPaths only returns app-scoped model directories", () => {
  const paths = getModelSearchPaths({
    dataDir: "/tmp/typetype-data",
    processResourcesPath: "/Applications/typetype.app/Contents/Resources",
    appPath: "/Applications/typetype.app/Contents/Resources/app.asar",
  });

  assert.deepEqual(paths, [
    "/tmp/typetype-data/models",
    "/Applications/typetype.app/Contents/Resources/models",
  ]);
});
