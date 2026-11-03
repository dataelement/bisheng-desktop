# 桌面云端会话删除

## 原因与行为

桌面统一历史列表通过 `CloudHistoryRow` 呈现毕昇云端会话，原实现仅绑定打开操作。云端历史桥已有列表与导航能力，删除尚未接入。此次直接扩展自有插件、窄 preload 和企业聊天主进程服务。

会话行的更多菜单提供红色“删除”，菜单向左对齐并保持在侧栏范围。确认弹窗由现有 `shell.overlay` 承载，复用 Harness 焦点管理、Esc、遮罩与主题；原生 Chat 在弹窗期间让出显示区域。处理中保持弹窗，失败保留记录并提供重试，成功后移除列表项。删除当前云端会话时返回 `/workspace/c/new`，其他会话保持当前展示。

## 请求与状态边界

- 复用毕昇 `DELETE /api/v1/chat/{chat_id}` 及服务端现有审计逻辑，成功以 HTTP 状态和 `status_code: 200` 共同确认。
- `enterprise-chat:remove` 使用既有可信主窗口 / 主 frame 校验。主进程同时验证 ID、当前身份代际、当前身份读取过的历史路由；Cookie 留在隔离 Session。
- 确认绑定打开时的账号代际。切换账号清除确认，异步结果只提交到原身份；后台历史刷新按请求序列接受结果。
- 已删除 ID 在本次身份内保留为删除记录，过滤滞后的列表响应；身份清理时同步释放。分页使用实际请求页号，保留服务端原始页的 `hasMore` 判定。
- 远程删除成功与新聊天导航分别处理；导航失败进入现有恢复状态，删除结果保持成功。

## 基线与范围

2026-11-03 在线核对 `dataelement/dsh-desktop:v0.9.0` 返回 Branch not found；当前保留工作区对应 BISHENG 桌面产品。实际使用已核对的 `dataelement/bisheng-desktop:V1.2.0`，SHA `703ad964bac2df42e7325f5db3ace667ed64c1b9`。

工作树名称 `bisheng-cloud-chat-delete-20261103`，分支 `codex/cloud-chat-delete-20261103`。安装依赖从同基线验证工作树独立克隆，实际 Harness 为 `0.2.1-rc.2`、Electron 为 `43.0.0`；本次直接修改宿主源码。Office 构建复用经 SHA 校验的下载缓存，生产构建完整执行。

## 验证

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npx vitest run test/enterprise-chat-view.test.ts test/session-delete-locale.test.mjs test/desktop-modes-ui.test.mjs test/session-search-recovery.test.mjs`：4 文件 / 138 项通过，包含本次新增 19 项行为用例。
- 基线客户端重放新增中英文云端确认用例：2 项失败，旧版缺少云端删除弹窗注册。
- 首轮完整串行回归：325 文件通过，`desktop-client-ui.test.ts` 的注册数量断言在新增云端确认 overlay 后需要同步；3,267 项通过，5 项按条件跳过。已将预期更新为本地与云端各自的 overlay，单文件 4 项通过。最终 `npm test -- --file-parallelism --maxWorkers=4`：326 文件 / 3,268 项通过，4 文件 / 5 项按环境条件跳过。
- `node scripts/verify-cloud-chat-delete.mjs`：macOS Electron 原生隔离环境，中英文 × 深浅主题 4 组通过；浅色 100%、深色 125% 缩放。运行实际插件、安装的 Menu / Modal / Button 与主题资源、实际 EnterpriseChatView 和带测试 Cookie 的本机 HTTP 端点；IPC 传输由夹具提供。覆盖菜单侧栏边界、确认弹窗视口范围、原生视图让位、Esc 取消与焦点恢复、业务失败重试、删除后列表和当前页更新。
- `git diff --check`：通过。

测试数据和账号均为隔离夹具。Windows 安装版、正式包及真实企业账号端到端验收待执行；本轮交付为代码和自动化验证。

本地日志与截图保存在外层工作区 `outputs/cloud-chat-delete-20261103/`，生成物独立于仓库提交。
