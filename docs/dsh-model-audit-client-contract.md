# 客户端模型审计接口开发说明

日期：2026-10-14。客户端分支：feat/3.0.0-dsh-audit，基于远端 main 的 3f6f010b280e7e095a13f59d8e3faae2c6223ab2。

正式线协议来源：毕昇仓库 features/v3.0.0-beta2/062-dsh-desktop-model-access/audit-guardrails-proposal/client-api-audit-extension.md 0.3；对应规格 0.19、设计 0.8。本说明只记录客户端落点，不替代该契约，也不表示服务器已实现或上线。

GET {BASE}/api/v1/dsh/config 在合法 enabled/client_id/contract_version 根响应上可增加：

~~~json
{"audit_context":{"fields":["conversation_id","request_kind"]}}
~~~

只接受字符串数组，与本期已知字段取交集；旧响应、空交集及坏可选能力均不发送扩展。根响应错误仍使首次登录失败。不增加协议 version 或猜测服务器能力。

POST {BASE}/api/v1/dsh/chat/completions 的既有模型参数不变，可附加：

~~~json
{"audit_context":{"conversation_id":"existing-session-id","request_kind":"chat"}}
~~~

conversation_id 取 GenerateOptions.sessionId，保持原值，非空且最多 256 Unicode 码点。request_kind 独立可选：purpose 未设置时为 chat，已知值 compaction/session-title 原样传递，其他值省略。只发送服务器公布的合法字段，空对象不发送；整个附加对象紧凑 JSON UTF-8 最多 4096 字节，超限整体省略。未知字段、身份、源消息、轮次、任务、version 和响应后补报都不发送。模型正文、图片限额和工具序列化保持既有行为。

能力是主进程当前连接的进程内快照，不写凭证库；初始化恢复、登录及手动刷新重新读取；退出、重新登录/切换 BASE、停止进程清除。并发刷新由代次防止旧响应覆盖新快照。模型调用和 SSE 增量不额外查 config。只有能力刷新失败时，后续有效模型请求省略扩展，不自动重发。

实现链路：主进程 config → EnterprisePublicState.audit_context → 企业插件当前 state → 适配器 auditFields 回调 → 最终请求 → credential broker → 主进程使用自己的 fields 再净化 → 服务器。回调只提供字段白名单，不依赖旧 PoC 的消息来源或自报能力。

管理审计配置、权限、原文存储和会话归组均在服务器；桌面不读取租户模式，也不提供审计正文上报入口。验证证据见 [开发验证说明](./dsh-model-audit-validation.md)。
