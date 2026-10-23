# 会话审计标题同步

2026-10-20，feat/3.0.0-dsh-audit。协议依据为毕昇审计契约0.5 §8、设计0.14 §4.7，根协议保持0.5.0。

## 实现边界

- 独立能力`audit_conversation_title: {version:1}`，不改变模型audit_context五字段。
- 企业插件只登记实际使用企业适配器的会话，公开`sessionTitle.get(session)`及`session/event`的`session/title`提供最终标题与持久事件序号。主/子Agent归各自会话，不扫描全量历史，不修改Harness核心。
- `audit-title.js`后台读取及同步，500ms合并、128会话/512KiB估算候选、单并发、5秒请求；NOT_READY/429/网络/5xx最多重试6次、总寿命5分钟。注销/切身份/能力消失/卸载清理和取消。最后一次模型调用后的改名仍同步，不额外调用模型。
- Loopback broker `POST /v1/audit/conversations/title`只接收`{connectionKey,auditTitleEpoch,update}`，8192字节上限，保留Host/loopback/Origin/capability约束。主进程复核epoch，冻结base/token，最多同epoch内刷新凭据一次；内部key/epoch不发送给服务端。
- 服务端`POST /api/v1/dsh/audit/conversations/title`仅接收`{conversation_id,title,title_event_seq}`。经过现有Nginx/Gateway，业务及认证在毕昇，不新增网关名单、席位或Token消耗。
- ID精确保留1..256码点；标题非空白、≤512码点/2048 UTF8字节，无控制符/非法Unicode；序号0..MAX_SAFE_INTEGER严格整数，总体≤4096字节。未知键拒绝。
- UPDATED/UNCHANGED成功；STALE/CONFLICT终止旧候选；DISABLED不记成功；NOT_READY独立重试，不重放模型。标题是可能敏感的短文本元数据，METADATA/CONTENT可存，OFF不更新。

## 验证与限制

`enterprise-audit-title.test.mjs`覆盖队列、末次调用后改名、在途替换、退避、容量、取消、能力及输入；service/broker测试覆盖重登epoch、401刷新、字段剥离和窄路由限制。本轮完整测试1914通过、2跳过，npm build/typecheck通过。实际部署及客户端操作记录在毕昇`audit-title-validation.md`，自动测试不是正式客户端验收。

内存队列退出可能丢失，无全历史补报；同ID跨设备日志顺序冲突不自动解决。旧服务端缺能力则自动停标题通道，不影响原模型调用。
