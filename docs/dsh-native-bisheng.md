# DSH 直接连接 BiSheng

当前整合分支 `codex/v120-unified-credits`，基于 `origin/V1.2.0@a1ce7bf83c1d3f98dda0802f197e906669de167f`。原生登录来源为 V1.1.0 的 `9600d6c`。

企业连接的授权请求、换证和退出改用 `/api/v1/dsh/authorizations`、`/api/v1/dsh/token`、`/api/v1/dsh/logout`，直接请求 Python BiSheng。平台分支 `feat/bisheng-work-120-main` 同时提供旧 `/api/dsh/*` 别名。客户端仍校验协议 0.5.0、PKCE、state、回调和响应结构；凭证保存在既有安全存储中。

模型正文、message_sources、父子会话及标题协商沿用 V1.1.0 实现；本次没有删减这些审计字段。席位错误码只作为连接旧服务的兼容提示，使用重新登录或升级平台的文案，不引导购买或分配席位。

服务端切换后应退出旧企业连接并重新登录，旧 Gateway Token 不会导入 Python。本次变更未发布安装包或修改用户已有 Profile。

验证：npm ci（postinstall 完整成功）、npm run typecheck、npm run build；完整 npm test 通过 2011 项（1 skipped），相关行为和视图测试均通过。完整门禁和联调边界见关联 BiSheng feature validation.md。真实 Electron UI 到无 Gateway 服务的登录、模型调用和实际审计记录仍需部署环境联调，单元测试及 mock HTTP 不代替该验收。
