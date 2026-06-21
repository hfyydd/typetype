# TASKS — main 纯 Windows 化

## 背景 / 规划原则

平台分工:
- **main**:Windows 专属功能主干(x64)。移除所有 macOS 打包配置,保留跨平台运行时逻辑。
- **codex/mac-platform**:macOS 专属(M 芯片 + Intel 双架构打包)。功能对齐 main,叠加 mac 打包适配。

运行时 `process.platform === 'darwin'` 分支逻辑 **保留**(Windows 上永不执行,且是 mac 分支对齐基础),只清理纯 mac **打包/构建配置**。

## 需求来源
- 用户指令:main 专攻 Windows,移除其他平台代码;mac 分支功能对齐 main。

## 当前状态(起点)
- main = `93f8070`(合并 PR #12 后,0.3.6 Windows 功能主干,但仍残留 mac 打包配置)

## 验收标准
- [ ] `package.json` 无 `build.mac`、无 `build:mac` 脚本、`build` 脚本仅 `--windows`
- [ ] `test/package-config.test.js` 无 mac 相关断言,且全量测试通过
- [ ] `npm run build:electron` 通过
- [ ] 运行时 darwin 分支逻辑保留(不破坏代码)
- [ ] Windows 打包链路(`build.win` / `build:win` / afterPack / sherpa-win-x64)完好

## 优先级 TODO
1. [ ] 清理 `package.json` mac 打包配置(build.mac、build:mac 脚本、build 脚本 --mac)
2. [ ] 更新 `test/package-config.test.js`,移除/调整 mac 断言
3. [ ] 处理 mac 资源文件 `resources/icon.icns`(删除或保留待定)
4. [ ] 运行验证:build:electron + 全量 node --test
5. [ ] 提交并推送 main

## 执行日志
- (待填)

## Blocker
- 无
