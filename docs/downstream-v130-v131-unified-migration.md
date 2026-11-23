# V1.3.0 / V1.3.1 到 unified 的功能核对

## 对比基线

- V1.3.0：`origin/V1.3.0`，标签 `v1.3.0`
- V1.3.1：`origin/V1.3.1`，提交 `3a47ede7`
- unified：当前分支 `codex/bisheng-unified`，提交 `408f6005`

## V1.3.0 功能范围

V1.3.0 主要引入或修复了云端工作台、移动端会话分页和增量同步、工作台安装及卸载恢复、工作台开发会话、欢迎案例、Office 模板导入、插件状态恢复、企业工作台权限回收、自定义 MCP 工具引用校验，以及工作台弹层和设置页回归。

unified 已经包含其中一部分底座升级和安装恢复改动。实际是否在打包应用中生效仍需按安装包和真实 Profile 验收，不能只根据分支提交记录判断。

## V1.3.1 新增功能

V1.3.1 相对 V1.3.0 的主要变化来自以下提交和文件。

- 工作台集合分组，支持企业、云端、市场、收藏和已安装来源
- 企业及云端工作台收藏，收藏记录独立于 `state.json` 保存，并带 revision 冲突保护
- 已下架或权限收回的收藏保留可移除状态
- 从市场、企业和云端来源统一展示收藏时间、来源和排序
- Work 欢迎案例批次轮换、Creator 案例和 Office 模板联动
- Chat 与 Work 欢迎案例的布局、动画和切换状态联动
- 企业账号资料变化后刷新嵌入式 Chat 页面身份
- 云端工作台下架后不再错误显示在已安装列表

对应的主要上游文件包括 `packages/dsh-desktop-workbenches/client.js`、`packages/dsh-desktop-workbenches/index.js`、新增的 `favorites.mjs`、`packages/dsh-desktop-office/client.js`、`welcome-cases.json`，以及 Chat 宿主和 Preload 文件。

## 当前 unified 已落地

- 企业层在账号资料变化后通知嵌入式 Chat 刷新身份
- Chat 欢迎页状态识别同时接受 `/workspace/c/new` 和已有会话路径
- Preload 提供 `enterprise-chat:profile-changed` 的受限监听桥
- 企业层新增“来自企业”工作台集合渲染器，读取 `/api/enterprise.workbenches/catalog`，通过已验证的 `/api/desktop-workbenches/enterprise-install` 安装，并按企业账号指纹保存收藏。

这些改动位于 `packages/dsh-desktop-enterprise/`，符合下游企业层白名单。

## 当前阻塞与边界

企业集合已经在下游实现，但要把它显示为公共 Workbench Market 的独立 Tab，仍依赖 upstream `V0.14.1` 的 collection 注册 Slot。该 Slot 已在 upstream `fbea1d8d0d` 提交，尚未进入下游门禁使用的 `upstream/bisheng-adaptor` 基线，因此当前不能把公共文件直接留在 unified。

- `packages/dsh-desktop-workbenches/client.js`
- `packages/dsh-desktop-workbenches/index.js`

同步 upstream 基线后，企业集合注册会显示为“来自企业”Tab；收藏读写、企业 API、安装请求和权限处理仍由 enterprise 包负责。欢迎案例和 Office 模板继续使用已有公共 Slot，不需要企业层改公共 Office 文件。

## 本次验证

- `npm run verify:boundary` 通过
- `npm run typecheck` 通过
- `npm test -- --run test/enterprise-workbench-catalog.test.ts test/enterprise-workbench-install.test.mjs test/enterprise-chat-view.test.ts test/enterprise-desktop-preload.test.mjs` 通过，21 项

工作台完整客户端回归当前仍有 9 项既有失败，集中在 Sidebar 测试 fixture 的 `layout` 缺失和源码契约断言，需要单独修复或更新测试基线。
