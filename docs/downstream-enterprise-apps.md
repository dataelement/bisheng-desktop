# 企业应用访问：服务端授权与动态路由

## 行为

Desktop/Web 共用 RFC 8693 Host。插件提供目标 client ID 和自己已经配置的业务服务地址，Host 向当前 BiSheng 的 POST /api/v1/oauth2/token 换证，再使用目标应用 Token 转发业务请求。

不存在 Desktop 本地 client 登记表或应用白名单，不再读取 enterprise-apps.json 或 BISHENG_ENTERPRISE_APPS，不返回 app_not_configured。之前为临时接线准备的本地 JSON 配置不再需要。

client 是否存在、是否启用换证、scope 是否允许、用户是否同意，全部由 BiSheng 服务端决定。客户端只检查输入类型、长度、地址格式与当前插件/会话生命周期。新增一个服务端 client 不需要改 Desktop 应用清单或为这个 client 发 Desktop 版本。

## 插件调用

~~~js
// configuredServiceUrl 来自插件现有的服务地址设置，不是新增的 Desktop 登记。
const app = ctx.enterpriseAuth.app('xpie', {
  baseUrl: configuredServiceUrl,
  scopes: ['openid', 'profile']
})
const response = await app.request('/v1/projects', { signal })
~~~

appId 直接作为换证 audience。baseUrl 只决定业务请求的路由，不表示服务端已经授权。scope 默认 openid/profile，不隐式申请邮箱；确需邮箱的业务插件可显式增加 email，并由用户对新增范围完成同意。Host 不允许调用者覆盖用户、租户、主凭据或 broker capability。

SDK 方法仍是 app().request()；旧插件若只调用 app('xpie')，需要在插件适配器中补传其现有 xpieUrl：

~~~diff
-const app = enterpriseAuth.app('xpie')
+const app = enterpriseAuth.app('xpie', { baseUrl: xpieUrl })
~~~

缺少服务地址是请求参数缺失，返回 invalid_request（400），不会回退到企业源地址或猜测应用端口。该地址参数需要在插件侧接通；只更新 Host 不能替旧插件生成它没有传递的路由信息。

## 换证与转发

1. SDK 将 appId、appBaseUrl、可选 appScopes、相对路径和当前 sessionVersion 通过授权 transport 传入 Host。
2. Host 验证插件实例仍有效、会话代次仍相同，以及服务地址和相对路径是否合法。
3. Host 只向当前登录 BiSheng 的 Token Endpoint 发送主凭据，不向业务服务发送主凭据。
4. 请求采用 application/x-www-form-urlencoded：grant_type 为标准 token-exchange URN，subject_token_type 为平台会话扩展 urn:bisheng:params:oauth:token-type:platform-session，audience 为 appId，requested_token_type 为标准 access_token URN。
5. 服务端拒绝目标 client 或用户授权时，直接返回受控错误，不发送任何业务请求。不存在的 client 也必须走服务端裁决。
6. Host 验证成功响应后，将应用 Token 附加到业务请求；插件只接收业务 Response，不接收 Token。

当前接入以 BiSheng 已支持 Desktop 主会话作为换证来源为部署前提；没有通过真实用户请求验证115的部署版本。参考 [BiSheng 换证规格](https://github.com/dataelement/bisheng/blob/feat/026-token-exchange-alpha1/features/v3.1.0-beta1/026-oauth2-oidc-provider/token-exchange/first-party-extension.md)。

## 保留的边界

企业地址与业务服务地址均支持 HTTP/HTTPS，不强制 HTTPS，也不要求额外 HTTP 许可开关。仍拒绝地址中的账号密码、query/fragment、路径绕过、loopback、link-local、metadata 等特殊地址，禁止重定向和 Cookie。baseUrl 的部署路径前缀会保留。

普通 enterpriseAuth.request 仍不能直接访问换证凭据端点，不能用普通企业请求绕过应用 Token 隔离。动态路由参数只属于应用请求，普通请求不得携带它。

成功响应必须包含正确的 issued_token_type、Bearer 类型、非空应用 Token 和匹配的 scope；TTL 为1至300秒，不接受 refresh_token/id_token，也不接受主凭据原样返回。换证和响应解析共用15秒总时限，响应体限制64KiB。后台拒绝与业务写请求不自动重放。

目标应用负责校验签名、issuer、audience、有效期、用户和租户，再执行业务权限。Host 不从未验签 JWT 推导服务地址。

## 错误与验证状态

consent_required、invalid_target、invalid_scope、invalid_grant、unauthorized_client 等服务端错误保持可区分，不回显 error_description 或凭据。Host 的 enterprise-app-access 日志只包含受控阶段、应用标识、错误码和状态，不包含 Token、URL 或请求正文。

提交整理时已运行相关回归，覆盖动态路由、未知 client 的服务端裁决、HTTP/HTTPS、账号切换、撤权、超时、流取消及代理边界，并补充空 body 的 HTTP 401 保留与刷新重试回归。类型检查和桌面构建通过；全量回归仍有沙箱环境及其他模块失败，边界门禁仍报告分支相对上游的既有漂移，Web 打包因当前 Node 版本不满足脚本固定版本要求而未完成。上述源码验证不等于已安装插件完成适配或真实登录成功。
