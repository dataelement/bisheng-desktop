# DSH 模型审计客户端开发验证

日期：2026-10-14；分支 feat/3.0.0-dsh-audit。fetch origin main 后创建独立 worktree，基线 HEAD 与 origin/main 均为 3f6f010b280e7e095a13f59d8e3faae2c6223ab2。未提交、推送或部署；主检出和旧 codex/dsh-audit-poc 的用户修改未动。

## 实现范围

客户端只新增已协商的 conversation_id/request_kind。parseConfig 对坏可选能力软降级；normalizeAuditContext 在插件和主进程共用。主进程保留当前连接的可信字段快照，公开状态只含字段能力，不含 token 或租户审计模式。适配器使用现有 GenerateOptions.sessionId/purpose，既有 messages/tools/图片序列化未改，不新增模型重试、补报、源消息或版本字段。

初次登录的根 config 仍必须有效；已经有效连接上的可选能力刷新失败只清除附加字段，不清除模型目录。初始化恢复、登录、手动刷新重新协商，模型请求和 SSE 不额外取 config。并发刷新只接受最新代次，BASE/账号变更与退出清除旧能力。

## 已执行验证

- 红灯：新增能力测试在实现前 3 条失败，复现 parseConfig 丢能力以及不存在 normalizeAuditContext；新增真实适配器/主进程用例 5 条失败，复现未发字段和附加字段被拒绝。
- 共享解析/主进程/适配器：47 条通过，含 256/257 Unicode 码点、4096/4097 UTF-8 字节、字段子集/独立字段/未知字段、未知 purpose、输入内容不变；图片大小/类型和危险业务字段拒绝回归。
- npm run typecheck：通过；TypeScript 范围不包含 JS 插件，因此另跑插件行为测试。测试中的 ArrayBufferView 适配类型错误已修复，不关闭 strict。
- 企业相关 12 文件：最终 114 条通过（构建后复跑）；覆盖登录、凭证 broker、插件状态和注册、代理、工具/图片及用量回归。
- 全链路合成 mock：config → 主进程公开状态 → 真实插件注册 → 真实模型适配器 → credential broker → 主进程净化 → mock，正常/压缩/标题/未知 purpose，字段子集、无会话 ID、刷新网络故障；请求计数验证无审计重放，config 计数验证不每次模型请求协商。
- 持久会话：在临时目录调用实际 Harness JsonlSessionPersistence 创建并关闭会话，重新打开后原 Session ID 不变；重新启动 EnterpriseService 从临时凭证库恢复后，再经真实插件/代理使用原 ID。凭据和提示词均为 mock 合成值。
- BASE 切换、坏可选能力、退出与重新连接：在两套 loopback mock 上验证旧快照清除、字段子集重取、模型目录保持；返回给插件的字段数组是副本，外部修改不改变主进程快照。
- git diff --check：通过。没有新增依赖、锁文件、第三方补丁或 UI 文案。
- 最后补充并发 config 响应乱序后，能力/服务/集成 3 文件 24 条通过；旧响应不覆盖新能力。
- npm run build：通过。生成本 worktree 的 Office/PPT 输入及 main/preload bundle；既有提示 renderer config is missing 不影响退出码 0。未制作或安装正式应用包。

## 客户端任务映射与实现细节调整

| 任务 | 结果/落点 |
|---|---|
| C001、C002 | 能力和字段规范化测试/实现，contract.js 与声明同步 |
| C003、C004 | EnterpriseService 连接快照、清除及代次保护；enterprise-desktop.ts 的 snapshot 原本完整透传 EnterprisePublicState，无需新增一条字段映射 |
| C005、C006 | 实际 openai.js 序列化测试，sessionId/purpose 附加两字段；用 auditFields 回调而不是旧 PoC 的自由 auditContext/messageSources 回调 |
| C007、C008 | parseEnterpriseChatPayload 显式接受审计键，按主进程能力净化，其他业务/凭证/header/图片约束不放宽 |
| C009 | mock 可切换能力并记录请求数量与收到的审计字段；声明同步 |
| C010 | 合成 mock、实际 JSONL 持久化、真实客户端代码到本地毕昇审计/共享存储的 HTTP 联调均通过；真实 Electron 界面/Fork/并行 Agent 发起流程与生产身份/供应商链路未执行，不能将本任务视为全部产品端到端验收完成 |

## 独立复现

在本分支检出且已安装锁定依赖的仓库根目录运行：

~~~sh
npm run typecheck
npx vitest run test/enterprise-audit-context.test.ts test/enterprise-audit-integration.test.ts test/enterprise-service.test.ts test/enterprise-chat.test.ts test/enterprise-chat-proxy.test.ts test/enterprise-openai-adapter.test.mjs test/enterprise-contract.test.ts test/enterprise-contract-import.test.ts test/enterprise-adapter.test.ts test/enterprise-credential-broker.test.ts test/enterprise-package.test.ts test/enterprise-package-backend.test.js
BISHENG_MOCK_AUDIT_MODE=both node scripts/mock-bisheng-enterprise.mjs
~~~

mock 模式为 both/conversation/kind/malformed/none，默认 none 保持旧版行为。UI 手动验证须使用独立开发 Profile，不访问现有用户 Profile 或真实企业凭证。

本次 worktree 依赖复用了同锁文件主检出已安装依赖，但将本地 dsh-desktop-* 包入口链接到本工作树，防止测试实际加载旧主检出 enterprise 实现；没有更改共享依赖或主工作树包。该步骤不替代干净 npm ci 与正式安装验证。

## 本地真实双端联调结果

2026-10-14 在 loopback 隔离服务执行 test/enterprise-audit-local-bisheng.test.ts，初轮 3 次、严格顺序/精确 ID 增测 1 次及服务端冻结后全新实例复跑 1 次均通过。服务端使用真实 DSH 模型/管理审计路由、异步队列、隔离 MySQL 8.0、Redis 7.2、MinIO、加密原文存取；身份、上游模型与用量账本准入使用合成适配器。客户端使用真实 EnterpriseService、插件 apply、适配器、credential broker 与主进程净化代码；Harness 插件注册服务是测试接缝，没有启动真实 Electron UI。此结果是本地真实代码+共享存储的 HTTP 联调，不是生产部署/供应商/完整鉴权验证。

最初本地 fixture 的 client_id 与正式 dsh-desktop 契约不一致，客户端正确拒绝；服务端修正 fixture 并重启后测试通过。客户端没有放宽正式契约校验。

初轮最后一次于 20:12 执行，1 个集成用例通过，测试执行 649 ms。每次独立发起 5 次模型调用：同一会话两轮、compaction、session-title、无会话 ID。5 个响应编号与持久化详情一致且各自不同；认证用户为合成用户 20；CONTENT 均 COMPLETE；模型调用期间 config 读取 0 次，不发生审计重放。管理员精确请求查询仅 1 条且无正文，关联时间线恰好 4 条；原文 NDJSON 的输入文本与实际模型输出增量顺序、连续 seq、完成 end、no-store 均已核对。audit_context 不进入实际模型输入原件。

初轮最后一轮的安全元数据证据（不记录访问凭证）：

~~~json
{
  "conversation_id": "local-audit-b5775d62-317e-4c93-99bc-11e07481e696",
  "request_ids": [
    "4678e1e5-1b7a-4d08-80c2-0b5c24d24bd2",
    "c44025eb-56a5-41d0-8de5-edd5c2b75cef",
    "5747599c-e17f-4fdb-8d47-d23826de5a85",
    "3b77602b-f1a4-4d3e-882d-add86a96a126",
    "1e798e9f-fe3d-45a8-9464-c7bcc6a01fa1"
  ],
  "model_posts": 5,
  "config_reads_during_model_calls": 0,
  "associated_requests": 4,
  "content_status": "COMPLETE",
  "body_transfer": "COMPLETED"
}
~~~

### 最终版本复跑：严格顺序与精确 ID

21:25 对最终版本隔离 MySQL/Redis/MinIO 服务复跑，服务端已使用 DATETIME(6)/UTC、精确会话 ID 摘要过滤、scope HMAC 完整性及生产默认 16 KiB 分块。1 个集成用例通过，测试执行 1.03 s；typecheck 与 git diff --check 通过。测试不以这一小样本宣称验证了大正文容量或性能。

会话列表不再只比较排序后的 ID 集合：HTTP 返回的 request_ids 必须逐项等于四次实际调用顺序。新增大小写不同和尾部 U+0020 空格不同的两个 ID 探针，分别精确查询只有自身请求，原会话仍恰好四条、按原顺序返回。核心流程单独确认 5 次无重放，探针额外 2 次，总计 7 次模型 POST，期间 config 读取 0 次；7 条 CONTENT 完整、NDJSON 传输完成，输入/输出及 audit_context 剥离校验保留。

最终版本安全证据：

~~~json
{
  "conversation_id": "local-audit-6d2868c7-84e3-4e4c-913e-1d067266cfff",
  "core_request_ids": [
    "1e45b7ff-2dc3-478c-8e91-65e9b5b7fe9f",
    "76703535-1d72-4e38-89dc-7faed7b9ff80",
    "40044067-88a3-4159-87be-2e7499932354",
    "be4d3151-2e71-45b9-9533-12948de79592",
    "70b5c57b-8904-4519-94ff-d48e8cce7961"
  ],
  "exact_id_probes": [
    {"conversation_id":"LOCAL-AUDIT-6D2868C7-84E3-4E4C-913E-1D067266CFFF","request_id":"b26d123e-a21d-4bdb-a7b8-9088b490882f"},
    {"conversation_id":"local-audit-6d2868c7-84e3-4e4c-913e-1d067266cfff ","request_id":"186ee9ef-a980-4649-a90b-9a99bd79273d"}
  ],
  "core_model_posts": 5,
  "exact_id_model_posts": 2,
  "total_model_posts": 7,
  "config_reads_during_model_calls": 0,
  "associated_requests": 4,
  "content_status": "COMPLETE",
  "body_transfer": "COMPLETED"
}
~~~

## 联调复现与尚未执行的边界

### 服务端冻结后的最终复跑证据

22:23 在全新隔离 MySQL/Redis/MinIO 实例上复跑既有 7 次用例，无客户端功能扩展。1 个集成用例通过，测试执行 830 ms；typecheck 与 git diff --check 通过。该版服务端已完成原件增量编码、必填 content:null 保留、结束帧发送状态及历史块读取限制的修复；本轮作为整体协议/留存回归，相关异常专项断言仍以服务端测试证据为准。

核心 5 次调用及 2 次精确 ID 探针全部独立，调用期间 config 查询 0 次。原会话四条请求严格按调用先后返回，大写与末尾空格两个 ID 各只关联自己的请求；7 条 CONTENT 完整、NDJSON 传输完成，输入/输出顺序及 audit_context 剥离保持通过。最终安全元数据如下，不保存访问凭证：

~~~json
{
  "conversation_id": "local-audit-04c679a9-b335-4a41-94e7-6ffa794a83c2",
  "core_request_ids": [
    "87340b39-5d1a-45c5-93f3-6142a384e23a",
    "7eed3bbe-4ccb-44aa-87b4-458c7f25dd8a",
    "63bd3992-076d-442b-9b01-1044546be546",
    "baa7aa53-d7e5-4a5c-8ad2-508c1931a0bc",
    "1d80bb3d-ef22-4b8a-a5cc-bc2b5fea9cbb"
  ],
  "exact_id_probes": [
    {"conversation_id":"LOCAL-AUDIT-04C679A9-B335-4A41-94E7-6FFA794A83C2","request_id":"dea924db-4dc5-4dca-963f-d89fde1e6182"},
    {"conversation_id":"local-audit-04c679a9-b335-4a41-94e7-6ffa794a83c2 ","request_id":"f8e12437-cd4e-481f-8720-1c971dd8ea68"}
  ],
  "core_model_posts": 5,
  "exact_id_model_posts": 2,
  "total_model_posts": 7,
  "config_reads_during_model_calls": 0,
  "associated_requests": 4,
  "content_status": "COMPLETE",
  "body_transfer": "COMPLETED"
}
~~~

测试默认明确跳过，不将 skipped 当作双端通过。启用要求 DSH_AUDIT_LOCAL_FIXTURE=1、DSH_AUDIT_LOCAL_BASE（明确 HTTP loopback origin）、DSH_AUDIT_LOCAL_ACCESS_TOKEN、DSH_AUDIT_LOCAL_ADMIN_TOKEN、DSH_AUDIT_LOCAL_TENANT_ID、DSH_AUDIT_LOCAL_USER_ID；模型可用 DSH_AUDIT_LOCAL_MODEL 指定（默认 bisheng:42）。凭证必须由本地隔离 fixture 临时提供，不写文档或代码，也不读取现有 Desktop Profile/账号。设置这些环境变量后运行 npx vitest run test/enterprise-audit-local-bisheng.test.ts。准备和真实执行后的 typecheck 均通过。

联调准备阶段另补携带 audit_context 的 SSE 错误测试，验证模型请求仅 1 次、错误 request_id 不变；适配器/共享字段/主进程 3 文件共 48 条通过。此项仍是客户端局部回归，不是服务端持久化验证。

租户模式矩阵、角色越权拒绝和全部故障矩阵由服务端专项测试负责，本用例只用已开启 CONTENT 的隔离合成超管/用户验证留存与查看链路；不以这一用例声称生产鉴权、MySQL/DM8 双库、全部租户模式或供应商模型已通过。没有上线、部署或制作正式安装包，未把合成 mock 当作服务器持久化证据。

未运行真实 Electron 窗口/现有用户 Profile；Fork 在本轮自动化中只验证使用新 ID 后的传参，不宣称实测了真实 UI Fork 操作。取消、异常和错误编号有现有企业代理/适配器回归和本轮 audit_context 错误用例，真实双端取消/错误场景仍需后续补齐。Windows 安装、正式包分发及应用内加载未验证。测试执行时长只是本用例数据，不是 D-09 的正式性能/时效评估或 SLA。

## 2026-10-15 提交前补充验证

按用户要求提交审计分支前补跑 `npm test`：214 个文件通过、1 个文件失败、1 个文件跳过；1826 项通过、3 项失败、1 项跳过，49.32s。跳过项为需显式启用的本机双端联调，本轮未重启存储 fixture；此前真实双端证据仍见上文。

3 个失败均为未修改的 `test/local-path-links.test.ts`，当前安装的上游 bundle 缺少测试要求的 `workspaceOpenCandidates` / `pathOpenFailureMessage`。将原基线 HEAD `3f6f010b280e7e095a13f59d8e3faae2c6223ab2` 解包到临时目录、复用相同本机依赖重跑该文件，仍为相同 3 项失败、5 项通过。因此本机相同依赖环境下可复现于原基线，不是审计改动新增失败；不代表干净 npm ci 已验证，不顺带修改第三方补丁或共享依赖。

本轮 `npm run typecheck`、`git diff --check` 通过；未把全量测试标绿，未制作安装包或部署。提交仅保存本阶段代码和验证记录，正式产品验收仍保持上面的限制。
