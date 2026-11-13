# 企业版网页搜索：直接使用毕昇 MCP

## 运行契约

企业版 Work 的网页搜索由已登录账号的 Work MCP 目录提供，模型工具名为 `mcp__bisheng__web_search`，原始 MCP 名称为 `web_search`。输入、描述和结果沿用 MCP 契约，不增加搜索 Provider、工具 ID 配置接口或独立搜索工具实现。数据库 ID 仅用于后端映射和 `_meta`。原生 `web_fetch` 及其配置保留。

调用路径：Work 工具注册 → 既有企业凭据 broker → `/api/v1/dsh/work/mcp` → 当前用户可用工具 → 毕昇搜索执行器。每次服务端调用重新检查用户权限和个人启用状态。未登录或目录中没有搜索时不提供 MCP 搜索；执行失败返回 MCP 错误，不转发给 DeepSeek 搜索。

该分支已有语义工具命名与 Skill 依赖解析改动，本功能复用这些改动。毕昇服务端必须同时支持语义名称；只部署旧版 `bisheng_tool_<id>` 协议的服务端不能与此客户端配套使用。

## 实现归属与生命周期

`packages/dsh-desktop-enterprise/search-policy.js` 由企业插件挂载，使用当前 Loader 公开的 `loader/patch-context` 事件，将 `@deepseek-ai/dsh-tool-web` 的 `search` 配置设为 false。既有 Loader 条目也在挂载时更新。其他字段不变，未配置 fetch 时继续使用上游默认值，不强制覆盖用户关闭网页读取的选择。

Harness 0.2.1-rc.2 的搜索实例位于 Agent preset 的 plugins 中，而不只在根组合中。因此同时投影 preset 声明中的搜索配置，涵盖嵌套 group、后续创建和更新的 preset。没有修改第三方 bundle、公共搜索包或用户 Profile 文件。卸载策略时恢复仍由本策略持有的配置；若外部已替换配置，则不覆盖该修改。删除的 Loader 条目及时解除跟踪。

部署后须重启应用，使所有会话采用新组合。正在运行且保留旧 preset revision 的 Agent 不由本功能强制重组；不打断用户正在执行的任务。Safe Mode 不加载企业插件时沿用其原有恢复行为。

MCP 搜索沿用通用 MCP 结果展示。搜索返回中的标题、摘要和 URL 供模型阅读与引用，不承诺原生搜索来源卡片、多查询合并或原生搜索的结果数量限制。现有企业 Work 工具范围保持为主任务，子任务不因此获得企业工具权限。

## 验证入口

- `test/enterprise-search-mcp.test.mjs`：真实 Loader、工具注册及 preset revision，覆盖关闭原生搜索、保留 fetch、配置更新、卸载恢复、MCP 搜索、错误与退出清理。
- `test/enterprise-work-cross-runtime.test.ts`、`test/fixtures/work-mcp-backend.py`：通过真实 Python MCP server 和 WorkCapabilitiesService 验证语义搜索工具、返回链接、审计和撤权拒绝。资源适配器与搜索提供商为内存 fixture，不能替代真实账号和搜索提供商验收。
- 相关命名与刷新回归继续使用 `test/enterprise-work-capabilities.test.js` 和 `test/enterprise-tool-sync.test.mjs`。

目标分支不存在 `verify:boundary` 和 `web:pack` npm 命令；不能以当前主工作区的新版本命令推断本分支已完成对应验证。真实安装包、Windows、真实账号及搜索提供商需单独验收。

### 本次本地结果（2026-11-12）

- 搜索、跨 Python MCP、能力目录、工具刷新、契约与企业适配器六个测试文件共 44 项通过。跨 Python 测试已显式设置 backend root 和 Python 解释器，未作为条件跳过。
- `npm run typecheck`、`npx electron-vite build` 和 `git diff --check` 通过。直接编译不等于完整打包。
- `npm test` 在 Office 资源准备阶段下载失败/超时，未进入完整测试。另行执行 `npx vitest run` 得到 315 文件通过、15 文件失败、4 文件跳过；3149 项通过、54 项失败、42 项跳过。失败包括 Office/PPT 产物缺失、宿主启动失败和 README 断言，未完成无改动基线对照，不能宣称全量回归通过。
- 额外尝试毕昇后端目录/命名测试，因本地缺少 bisheng/config.yaml 在收集阶段失败；本次未修改后端业务代码。跨运行时测试使用真实 MCP 服务和隔离的内存资源 fixture，已通过。
- 尚未验证真实账号、实际搜索提供商、完整 npm build/package、安装包 UI 与 Windows。
