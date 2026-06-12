const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  RuntimeDependencyManager,
} = require("../dist-electron/runtime-dependency-manager.js");

function makeTempInstaller() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-runtime-"));
  const installerDir = path.join(root, "runtime-installers");
  fs.mkdirSync(installerDir, { recursive: true });
  fs.writeFileSync(path.join(installerDir, "vc_redist.x64.exe"), "stub");
  return root;
}

test("RuntimeDependencyManager classifies ONNX load errors as repairable runtime issues", () => {
  const resourcesPath = makeTempInstaller();
  const manager = new RuntimeDependencyManager({
    resourcesPath,
    platform: "win32",
    arch: "x64",
    spawnSyncFn: () => ({ status: 1, stdout: "", stderr: "" }),
  });

  const status = manager.getStatus("The operating system cannot run %1");

  assert.equal(manager.isRuntimeEnvironmentError("DLL initialization routine failed"), true);
  assert.equal(status.status, "needs_repair");
  assert.equal(status.can_install, true);
  assert.equal(status.action, "install_runtime_dependency");
  assert.equal(status.vc_redist_installer_exists, true);
  assert.match(status.user_message, /基础断句已可用/u);
});

test("RuntimeDependencyManager hides install action when the bundled installer is missing", () => {
  const manager = new RuntimeDependencyManager({
    vcRedistInstallerPath: path.join(os.tmpdir(), "missing-runtime-installers", "vc_redist.x64.exe"),
    platform: "win32",
    arch: "x64",
    spawnSyncFn: () => ({ status: 1, stdout: "", stderr: "" }),
  });

  const status = manager.getStatus("onnxruntime failed");

  assert.equal(status.status, "installer_missing");
  assert.equal(status.can_install, false);
  assert.equal(status.action, undefined);
  assert.match(status.user_message, /重新安装 typetype/u);
});

test("RuntimeDependencyManager detects installed VC++ runtime from registry output", () => {
  const manager = new RuntimeDependencyManager({
    platform: "win32",
    arch: "x64",
    spawnSyncFn: () => ({
      status: 0,
      stdout: [
        "Installed    REG_DWORD    0x1",
        "Version      REG_SZ        14.44.35211.0",
      ].join("\n"),
      stderr: "",
    }),
  });

  const status = manager.getStatus("");

  assert.equal(status.status, "ready");
  assert.equal(status.vc_redist_installed, true);
  assert.equal(status.vc_redist_version, "14.44.35211.0");
});

test("RuntimeDependencyManager reports repaired runtime as ready even if ONNX still needs restart", () => {
  const resourcesPath = makeTempInstaller();
  const manager = new RuntimeDependencyManager({
    resourcesPath,
    platform: "win32",
    arch: "x64",
    spawnSyncFn: () => ({
      status: 0,
      stdout: [
        "Installed    REG_DWORD    0x1",
        "Version      REG_SZ        14.44.35211.0",
      ].join("\n"),
      stderr: "",
    }),
  });

  const status = manager.getStatus("The operating system cannot run %1");

  assert.equal(status.status, "ready");
  assert.equal(status.can_install, false);
  assert.equal(status.action, undefined);
  assert.match(status.user_message, /已安装\/修复/u);
});

test("RuntimeDependencyManager runs bundled VC++ installer with passive norestart args", () => {
  const resourcesPath = makeTempInstaller();
  let command = "";
  let args = [];
  const manager = new RuntimeDependencyManager({
    resourcesPath,
    platform: "win32",
    arch: "x64",
    tempDir: resourcesPath,
    spawnSyncFn: (cmd, cmdArgs) => {
      if (cmd === "reg") {
        return { status: 1, stdout: "", stderr: "" };
      }
      command = cmd;
      args = cmdArgs;
      return { status: 3010, stdout: "", stderr: "" };
    },
  });

  const result = manager.installVcRedist();

  assert.equal(result.ok, true);
  assert.equal(result.exit_code, 3010);
  assert.equal(path.basename(command), "vc_redist.x64.exe");
  assert.deepEqual(args.slice(0, 3), ["/install", "/passive", "/norestart"]);
  assert.equal(args.includes("/log"), true);
  assert.match(result.message, /建议重启/u);
});

test("RuntimeDependencyManager disables installer on unsupported platforms", () => {
  const manager = new RuntimeDependencyManager({
    platform: "darwin",
    arch: "arm64",
    spawnSyncFn: () => ({ status: 1, stdout: "", stderr: "" }),
  });

  const status = manager.getStatus("onnxruntime failed");

  assert.equal(status.status, "unsupported");
  assert.equal(status.can_install, false);
});
