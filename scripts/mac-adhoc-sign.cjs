// 自定义 macOS 签名钩子：强制 ad-hoc 签名（codesign -s -）。
//
// 背景：electron-builder 25.1.8 的默认签名路径无法自动产出 ad-hoc 签名——
//   - mac.identity: null  -> 直接跳过签名
//   - mac.identity: "-"   -> electron-builder 自己的 findIdentity 找不到名为 "-" 的
//                            证书，reportError 仅 warn 后 return false，同样跳过签名，
//                            根本到不了 osx-sign
//   - 不设 identity 且无证书 -> osx-sign 抛 "No identity found for signing"
// 后果就是 Intel (x64) 包 "not signed at all"，未签名 bundle 在 macOS TCC 下身份
// 不稳定，renderer helper 的 getUserMedia 被拦在 CoreAudio 层，麦克风调不起来。
//
// 为何不直接用 @electron/osx-sign 的 signAsync：osx-sign 依赖 isbinaryfile 在签名前
// 扫描 bundle 区分二进制/资源，在体积较大的原生库（sherpa-onnx .node 等）上其 protobuf
// 长度解析会触发 RangeError: Invalid array length 崩溃。ad-hoc 签名并不需要这套二进制
// 识别，因此这里直接调用原生 codesign：对主 app 用 --deep 递归签 Frameworks / Helpers /
// 插件，主 app 自身带 entitlements，子 bundle 继承同一份 entitlements，保证 renderer
// helper 也带齐 cs.* 与 audio-input。该钩子在 DMG/ZIP 打包前执行，签名后的 .app 会被
// 正确嵌进分发产物。

const { execFileSync } = require("child_process");
const path = require("path");

const entitlementsPath = path.resolve(__dirname, "..", "build", "entitlements.mac.plist");

function run(cmd, args, label) {
  try {
    execFileSync(cmd, args, { stdio: "inherit" });
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    throw new Error(`mac-adhoc-sign: ${label} failed: ${detail}`);
  }
}

/**
 * @param {{ app: string }} configuration
 */
module.exports = async function adHocSign(configuration) {
  const appPath = configuration && configuration.app;
  if (!appPath) {
    throw new Error("mac-adhoc-sign: configuration.app is required");
  }

  // 1. 深度 ad-hoc 签名所有子 bundle（Frameworks、Helpers、插件），先签子项再签父项。
  //    --deep 已被 Apple 弃用但仍可用；osx-sign/electron-builder 对 Electron bundle 一直
  //    靠它兜底。--options runtime 对应 Hardened Runtime（ad-hoc 下无害）。
  run("codesign", [
    "--sign", "-",
    "--force",
    "--deep",
    "--options", "runtime",
    "--entitlements", entitlementsPath,
    appPath,
  ], "codesign --deep (bundles)");

  // 2. 校验签名结构（不验证身份，ad-hoc 无可验证证书）。--verify 失败说明 bundle 内有
  //    未签到的 Mach-O，此时直接报错让构建失败，而不是把一个半签名包打进 DMG。
  run("codesign", ["--verify", "--deep", "--strict", appPath], "codesign --verify");

  // 3. 记录最终签名状态，便于排障（不影响构建成败）。
  run("codesign", ["-dv", appPath], "codesign -dv");
};
