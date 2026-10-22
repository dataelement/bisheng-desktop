# DSH 直接连接 BiSheng

开发分支 `codex/dsh-without-gateway`，合并目标 `V1.1.0`。当前已合入目标分支 `033fc58947135aa988b1868d5c614b44d4ab6798`，沿用其企业认证通道、模型协议和市场能力。

企业连接的创建授权、换证与刷新、退出使用 `/api/v1/dsh/authorizations`、`/api/v1/dsh/token`、`/api/v1/dsh/logout`，请求配套 Python BiSheng 原生认证服务。服务端 `feat/bisheng-work-110` 同时提供旧 `/api/dsh/*` 别名，并可完全不部署 Java Gateway。

客户端继续校验协议白名单 0.4.0/0.5.0、PKCE、state、同源浏览器确认和回调响应，凭证保存在既有安全存储中。模型审计正文、message_sources、父子会话和标题能力协商保留。旧席位错误仅提供重新登录或升级平台的兼容提示，不引导购买或分配席位。

## 兼容范围

- 服务端切换到 Python 认证后应重新登录，旧 Gateway Token 不导入新会话。登录切换不清理本地聊天历史。
- 当前客户端固定使用 v1 认证路径，没有旧路径回退。仅提供 `/api/dsh/*` 认证的旧服务端不能直接兼容；协议版本白名单不代表认证端点兼容。
- 旧客户端连接新服务端可使用 Python 的旧路径别名；实际旧安装包的登录、刷新和退出仍需按版本组合验收。
- 新旧客户端分别使用独立测试 Profile；HTTP 协议兼容不等于客户端持久化格式可无损降级。

## 验证

合入上述目标分支后重新运行 `npm ci`，所有 patch-package 补丁、品牌资源和 Electron 安装步骤通过；`npm run typecheck`、`npm run build` 通过。

完整 `npm test`：231 个文件通过、2 个跳过；2042 项通过、3 项跳过。目标分支的签名构建测试使用 Python 3.11 的 contextlib.chdir；本机默认 Python 3.10 首轮有一项环境失败，改用现有 Python 3.11 执行完整回归，不为此修改业务代码。

2026-10-20 已在此前功能提交上完成无 Gateway 的本地 Electron 登录、真实模型调用、个人额度优先、部门额度继承、成员独立计量和审计正文核验。该记录不替代合入目标增量后的全部 UI、Windows/macOS 安装包及旧服务端组合验收。本 PR 不发布安装包或更新用户真实 Profile。
