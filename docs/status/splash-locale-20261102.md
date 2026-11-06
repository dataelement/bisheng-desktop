# 安全模式重启 Loading 页语言

## 问题与实现

2026-11-02 测试截图记录：Windows 客户端设置为英文，通过安全模式入口重启，Loading 页仍显示中文；预期跟随 Desktop 设置。

`showSplash()` 原来只向本地页面传主题，`build/splash.html` 直接从 `navigator.language` 选择文案。主进程已经持有 Harness 上报的活动语言，Loading 页应消费同一个状态。

现在 `showSplash()` 同时传入 `harnessLocale()`，页面优先采用有效的 `en` / `zh`，同步标题、说明及 HTML lang。独立打开页面时使用浏览器语言回退；应用首次启动、活动语言尚未上报时使用现有宿主系统语言回退。普通重启和安全模式启动共用此入口。

[PR #118](https://github.com/dataelement/bisheng-desktop/pull/118) 负责将普通 Profile 的语言配置继承到安全模式 Profile。本次改动负责显示 Harness 加载前的本地 Loading 页；整段安全模式语言体验需要两项修复共同验收。

## 基线

- 仓库：`dataelement/bisheng-desktop`，目标版本分支 `V1.2.0`。
- 远端核对 SHA：`09c22fe34e5c89193c15387685810fbaa45e73fc`。
- 工作树：`.worktrees/bisheng-splash-locale-20261102`；分支 `codex/v120-splash-locale`。
- 实际依赖：Harness `0.2.1-rc.2`、Electron `43.0.0`。复用独立复制的、锁文件 SHA 完全一致的现有依赖，构建预处理已成功执行。
- 本次目标为 BISHENG V1.2.0；远端 `dataelement/dsh-desktop` 的 `refs/heads/v0.9.0` 查询返回空。

## 验证

- 新增 `test/splash-locale.test.mjs`，直接执行本地 HTML：中英设置与系统语言相反、深浅主题、Windows 布局标识、无参数/无效参数回退，以及主进程传参契约。修复前 6/8 失败；修复后 8/8 通过。
- 专项：`npm test -- test/splash-locale.test.mjs test/application-locale.test.ts test/native-locale.test.ts test/safe-mode-locale.test.mjs test/brand-assets.test.ts test/release.test.ts`，6 文件 / 73 项通过，包含打包资源携带检查。
- `npm run typecheck`、`npm run build` 通过。
- 完整回归：`npm test -- --no-file-parallelism`，326 个文件 / 3,223 项通过，4 个文件 / 5 项按条件跳过，耗时 440 秒。
- `git diff --check` 通过。
- macOS 真实 Electron 43 使用临时独立 userData 加载实际 `build/splash.html`；模拟相反的 navigator 语言和 Win32 平台标识，中英 × 深浅主题 4 组断言通过。已查看英文浅色、中文深色截图；该验证范围为页面渲染。
- 本地证据：`artifacts/splash-locale/` 中的运行结果、截图、验证脚本与日志。
- Windows 安装包、Windows 实机设置语言→安全模式→重启全流程、两项 PR 合并后的产品验收：待执行。
