# Web runtime 测试

当前分支维护 Web runtime 和自有插件，已移除 Electron main、preload、shared 和旧桌面市场安装器。对应的 IPC、原生窗口、桌面 Profile 迁移、Safe Mode、旧安装器 generation 及桌面专属补丁测试随实现一起清理；不通过修改 Vitest 或 TypeScript 的 exclude 掩盖失效导入。

## 默认回归

在仓库根目录运行：

```bash
npm test
npm run typecheck
npm run test:windows
```

Windows 配置覆盖 Web runtime 启动/分发、插件包和工作台。macOS 上执行该配置仅验证选中的跨平台测试，不能替代 Windows 原生验收。

TypeScript 检查覆盖 Vitest 配置、TypeScript 测试与声明文件；插件 JavaScript 通过行为测试验证。

## 覆盖边界

- 客户端插件保留真实 React/DOM 渲染、交互、本地化和清理行为。
- 企业代理、企业市场和工作台目录保留请求失败、分页、账号切换以及安装结果校验。
- Office 脚本单测使用临时目录和可控输入，不依赖预先准备好的运行产物。
- 具名源码补丁以当前 patches 目录为准。补丁中的 slot 声明只证明源码组合契约，不能作为已安装客户端激活的证据；已安装 bundle 的检查单独保留。
- Web runtime 的导入、离线启动、Windows 分发测试保留，缺失实际分发依赖须修复准备/构建流程，不删除对应守卫。

## 完整 Office 产物验收

准备 Office payload、Python、模板和 Electron 后，显式开启：

```bash
DSH_TEST_OFFICE_RUNTIME=1 npx vitest run test/integration/office-runtime.test.mjs
```

默认回归会报告这两项集成测试跳过。显式开启时缺少准备产物会报错，且完整打包检查仍会捕获 Web 入口缺少依赖等真实问题。
