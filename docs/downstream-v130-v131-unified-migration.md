# V1.3.0 / V1.3.1 到 unified 的功能核对

## 基线与迁移边界

对比 `origin/V1.3.0`、`origin/V1.3.1`（`3a47ede7`）与 `codex/bisheng-unified`。
当前已同步的公共基线为 `upstream/V0.14.1`：`97a1fc4a4d9289b27af8e2b64cb01ea2ca3a71df`。
门禁及企业 CI 采用该分支，公共文件必须与评审后的上游字节一致，不扩大公共目录白名单。

企业目录、权限、收藏、云应用、欢迎案例、Chat/Work 产品 UI、企业手机协议都由
`packages/dsh-desktop-enterprise/` 维护。复用现有 Plugin Manager 安装/停用/卸载、
会话与工作区接口、Agent preset、UI slots、Office/PPT 服务。没有新增公共收藏数据库、
企业案例 Provider 或企业会话绑定框架。

本轮需要并已合入上游的通用扩展：

- [#931](https://github.com/dataelement/dsh-desktop/pull/931)：市场集合排列、接管和可见性。
- [#932](https://github.com/dataelement/dsh-desktop/pull/932)：Office/PPT 客户端选择状态服务，供已有选择器和扩展共享真实状态。
- [#933](https://github.com/dataelement/dsh-desktop/pull/933)：通用品牌 fixture 与新增客户端服务的资源体积契约修正。
- [#934](https://github.com/dataelement/dsh-desktop/pull/934)：集合 `renderDefault` 和公共筛选栏开关，企业“已安装”补充云入口并保留原生卡片。
- [#935](https://github.com/dataelement/dsh-desktop/pull/935)：主进程手机产品扩展，公共桥负责传输认证、生命周期与 Host 请求；企业账号绑定、网关和业务 RPC 留在下游。

以上 PR 已合并并同步；V0.14.1 没有触发远端 CI，不能把本地检查称作远端 CI 通过。

## 功能对应

| V1.3.0 / V1.3.1 能力 | unified 实现与验收入口 |
| --- | --- |
| 工作台集合 | 来自企业、云端工作台、工作台市场、我的收藏、已安装，顺序与 V1.3.1 一致；市场关闭时四页。真实公共 Market 组件 DOM 回归覆盖页数、默认项、键盘切换和策略变化。 |
| 企业安装与更新 | 企业目录与校验制品通过现有 Manager 安装，保留预期包名/版本校验、明确生命周期结果；更新提示重启；卸载前离开活动工作台并确认，保留用户数据。 |
| 管理员收回工作台授权 | 保留 `enterprise-installs.json`；新安装记来源；从可信企业目录补认历史安装，排除市场与本地来源。明确拒绝则停用、不卸载；故障保留状态；授权恢复只清除原因，不自动启用。启动、Manager 变更、周期检查及页面刷新触发核对，企业页面展示原因。 |
| 企业插件名称与授权 | 插件页显示企业名称与描述，操作仍使用账号隔离标识；继续采用 unified 的 managed source、Root composition 和授权租约，保留清理与恢复入口。 |
| 收藏 | 合并企业、云和公共市场，保留搜索、来源筛选、收藏时间与名称排序、下架后取消收藏。旧文件及原型 localStorage 按账号接管，保存成功再清理；revision 冲突重试；损坏文件不覆盖。 |
| 云工作台入口 | 分页目录、添加、移除本机入口、打开、笔记、会话关联；移除后不再出现在已安装，云应用及笔记/会话保留。Desktop 使用隔离原生视图及一次性票据，Web 使用独立窗口提交票据。 |
| 云开发工具 | 恢复 guide/list/create/checkout/resume/publish/progress/limits、当前项目检查、归档限制及发布/schema 确认；Desktop broker 保持原版认证边界。 |
| 旧云数据兼容 | Host 启动前备份旧公共状态并投影公共字段；企业层接管云入口、笔记、绑定及独立开发会话。保留 `cloud-development` 项目目录，使用原连接身份指纹校验归属；账号隔离、重复启动、删除入口与损坏/冲突路径均有回归。 |
| Work 欢迎页 | 原 34 个双语 Work 案例、批次切换、重复点击撤销、Creator preset、Word/Excel 模板与提示词联动、PPT 模式及已选模板保留。使用现有 hero/composer slots，异步准备校验草稿 revision，不覆盖用户编辑。 |
| Chat/Work 交互 | 旧版布局、侧栏、历史、资源与工具引用、知识库/技能选择、案例动效、原生弹层与云视图遮挡协调移入企业层。公共 client-ui 恢复上游原样。 |
| Chat 欢迎案例 | 桌面嵌入式 Chat 继续由企业 Web 页面提供案例；没有向它再注入一套桌面静态目录。原 10 个 Chat 案例保留给手机欢迎接口，与旧版行为一致。 |
| 企业账号 | 恢复昵称/头像/账号展示、profile 刷新及冷却、切账号异步结果隔离、工作区身份刷新、原生 preload 的项目/重命名/运行状态事件。保留 unified 的 Web 登录与会话凭据实现。 |
| 企业模型 | 恢复 slug、上下文容量、输入模态、推理等级、积分倍率和缺少价格提示；模型目录与已有选择器同步，保留 unified 的容量别名与 max_tokens 兼容。 |
| Work MCP / 技能 | 接受服务端自定义 MCP 名称，工具依赖按目录元数据解析，不猜 `bisheng_tool_<id>`；保留目录缓存/错误退避、显式刷新、个人/企业技能分组；使用共享审批策略。企业搜索仅来自认证 MCP，原生 fetch 保留。 |
| 审计反馈 | 恢复 Desktop broker 的消息评分/撤销与标题同步、受限字段、账号 epoch 检查、重试和销毁；不把本地成功当成生产平台已经接收。 |
| 手机访问 | 企业网关绑定/解绑、重连与账号切换、受认证远程通道、会话分页/增量投影、权限选择、技能/知识库/工具、Office/PPT、分块上传；欢迎案例路由改为企业目录，不依赖已移走的公共 Office 企业数据。 |

工作台授权核对继承旧版的异步收回语义；它不是恶意本地插件的沙箱，也不是平台 API 授权的替代品。

## 有意保留的 unified 行为

- 保留 unified 的并发能力，没有重新引入旧版最多 8 个 Chat 请求的限制。
- 老服务未声明上下文容量时，模型目录不伪造元数据；运行时保留 unified 的 128000 默认值，供当前 Harness 压缩流程使用。
- 企业插件使用当前 Root composition 作用域与 managed-source 合同，不能原样换回旧 Harness 的实现。
- Windows、Safe Mode、安装 generation、Host/客户端模块发现继续继承当前 upstream；没有移植旧版整套壳或 loader。
- 云开发原生工具、嵌入式 Chat、手机桌面绑定仍属于 Desktop 的原版能力；独立 Web 不虚构原生窗口/桌面 broker。共有目录、收藏、模型与账号等继续通过 Web 的企业认证路径运行。

## 验证与替换边界

当前平台为 macOS arm64；临时 Profile 验收不修改用户现有 Profile。

- `npm run verify:boundary`：通过，基准 `97a1fc4a4d`，检查 318 个文件；另跑门禁行为回归 17 项通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，正式 Desktop 主进程、Host 和 preload 编译成功。
- `npm run web:pack`：通过；包内启动器 `--version` 返回 `0.2.2-rc.5`。
- `npm test`：474 个文件通过、3 个文件跳过；4755 项通过、10 项跳过、0 失败。跳过不计作通过。
- 全量回归包含真实 Electron + 临时 Host/Profile 的企业账号设置、Escape 关闭及 Chat/Work 容器挂载；公共 Market + 企业扩展的真实 DOM 回归覆盖五页/四页及默认选择。
- 手机端回归覆盖真实 HTTP/WebSocket 通道、错误身份、远程 token、账号切换、解绑和销毁；补充手机欢迎案例到企业目录的适配。
- 云迁移、收藏、撤销授权、欢迎案例/模板、MCP/技能、Profile 和模型元数据有对应 `test/enterprise-*` 行为回归。测试变更包括把缓存后的刷新用例改为显式 `sync({ force: true })`，继续验证保存前响应不能覆盖保存后目录；路由清单增加企业授权核对路由；损坏安装来源文件改为拒绝覆盖并验证原文保留。
- 独立 Web 产物使用随包 Node 启动，数据目录为独立临时目录；未认证 API 返回 401，交换本次进程 launch token 后，HTML、企业 state、欢迎案例接口返回 200，目录包含 34 个 Work / 10 个 Chat 案例。真实 Electron 浏览器加载此 Web 服务，确认 bootstrap 注册、应用挂载、企业账号菜单及企业登录表单；没有执行生产 SSO。
- `git diff --check` 与暂存区差异检查通过。

Web 产物：`dist/bisheng-web-runtime-darwin-arm64-1795513711653.tar.gz`，SHA-256：
`f18b649b9ae000a4fd8e0018069d001468dac827072cbe59cc89c5eaf62ba203`。
本次构建与全量测试运行于保留原有 WIP 的工作区；提交时将模型执行器、去 Harness 身份与 developer-role 等原有改动分离保留，不把这些改动归为版本迁移。

代码迁移、测试、安装包、实际安装和正式发布是不同状态。此任务没有删除 V1.3.1 分支，也没有替换正式安装版本。
真实企业服务的授权撤销、生产 SSO、云票据及发布审批，以及 Windows 安装后流程，必须在相应环境完成验收后才能宣布可直接替换正式版本。

## V1.3.1 手机会话列表增量（2026-11-24）

来源为 `cd4e182eb7aeb4865323f745066d007be3d4d4bf`（合入 V1.3.1 的 `8015b3f3`）。按当前架构迁入企业插件的 `desktop/mobile/mobile-rpc.ts` 与 `mobile-phone-view.ts`，不恢复旧版主进程业务实现。

已迁入：隐藏子会话、归档及非当前打开的空白会话；当前空白、置顶、普通会话分组排序；分段游标；未分组独立分页；投影保留 origin。`enterprise-mobile-rpc.test.ts` 覆盖分组跨页、RPC 参数传递、未分组排除所有工作区及旧游标回到第一页。

暂未迁入：公共桥接层 `workspace/follow` 的 `pinned` 与 `replace` 更新帧处理。现有 baseline 可提供置顶信息，但后续置顶变化及完整快照替换不会被公共快照接收。用户要求先不修改 upstream，本次仅提交已完成的下游部分；不能将此记录视为手机功能完整验收。真实手机联调尚未执行。
