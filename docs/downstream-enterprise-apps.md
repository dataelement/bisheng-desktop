# 企业应用访问：后台配置与插件通用 API

## 功能

企业插件通过统一的 enterpriseAuth.app(appId).request(path, init) 访问独立企业应用，不再自行调用应用专用取票接口，不需要再次登录，也不读取、保存或转发企业主会话凭据。应用 ID、地址、允许的插件和权限由 BiSheng 后台管理；业务服务在线校验短期应用凭据，仍自行执行项目、成员和资源权限。

本功能由两个仓库共同组成：BiSheng Desktop/Work 的公共 SDK 与可信 Host；BiSheng 后台的管理 API、管理页面、签发和在线 introspection。两端需要配套发布。本次实现没有修改或部署旧 Xpie 服务/插件，不能仅更新 Host 就删除旧的 /api/v1/dsh/xpie/delegations。

## 完整流程

~~~mermaid
sequenceDiagram
  participant P as 企业插件
  participant H as 可信 Host
  participant B as BiSheng 后台
  participant A as 独立企业应用
  P->>H: enterpriseAuth.app(appId).request(相对路径)
  H->>B: 当前企业 Bearer + 可信加载器插件ID/实例ID
  B->>B: 员工/租户/会话 + 已发布插件可见性 + 应用配置
  B-->>H: 应用地址 + 最长60秒的 opaque 凭据
  H->>A: 应用 Bearer + 业务请求
  A->>B: introspect(appId, 应用凭据)
  B->>B: 重查当前会话、配置 revision、目录授权和有效期
  B-->>A: active / issuer / audience / scope / tenant / user / exp
  A->>A: 检查自身项目/资源权限
  A-->>H: 业务 Response
  H-->>P: 脱离凭据的业务 Response
~~~

企业主凭据仅发送到当前企业 origin；应用凭据仅发送到后台登记的应用地址。SDK 不缓存应用票据，每次业务请求重新申请，服务端按当前配置授权。不自动重放业务 HTTP 401 或写请求。

## 管理员配置

入口：BiSheng 管理后台 → DSH 管理 → 接入设置 → 企业应用接入。页面受现有管理员能力控制，后台最终以当前可信租户和 get_tenant_admin_user 校验权限；普通用户不请求管理接口。新应用默认停用，scope 和插件白名单默认空，不自动放行。

| 字段 | 含义与约束 |
| --- | --- |
| app_id | 稳定应用标识，最长64；小写字母开头，后接小写字母/数字及单连字符分段，如 xpie |
| name | 后台展示名称 |
| base_url | HTTPS 地址，可带部署路径前缀；无账号密码、query、fragment、点段或编码路径绕过 |
| enabled | 启停应用；未登记或停用时拒绝签发 |
| audience | 目标应用验证的受众；1..256个可见 ASCII 字符，不含空白，可与 app_id 不同 |
| scopes | 每行一项，OAuth scope-token 语法；最多64项、每项128字符、空格拼接最长2048；启用时不得为空 |
| allowed_plugin_ids | 企业目录实际32位小写十六进制插件 ID 白名单；单独的 * 明确允许所有当前已授权企业插件 |
| token_ttl | 短期应用凭据有效期，单位秒，1..60，默认30 |

* 不能与具体插件 ID 混用，也不绕过插件的真实企业目录可见性。这里的“开放所有插件”是公共 API 可供所有企业插件接入；应用默认仍需管理员启用与授权。

允许正常企业内网 HTTPS 地址（例如10.x、192.168.x和IPv6 ULA），拒绝 localhost、loopback、link-local、unspecified、multicast 和常见元数据地址。域名 DNS rebinding、连接 IP 固定及企业出站代理策略不由此 SDK 完成，应由部署网络策略保证。

配置存入现有 Config 表的独立租户键 dsh_integrations:<tenant_id>，不新增表或 schema migration。整表更新携带 revision，行锁与 revision 对比避免丢更新；首次插入的唯一键冲突也转409。发生冲突时页面保留草稿，显式重新加载后再保存。真实 MySQL/DM8 并发事务仍需部署环境验证。

必须配置可信 dsh.platform_public_url（企业公开 origin）。发行者不从请求 Host 或 forwarded header 推导，缺少该配置时关闭签发。原始主会话 Bearer 只在服务端 Redis 临时记录中保存最多60秒；Redis 使用 opaque token 的 SHA-256 作为键，不记录明文票据到日志。

## 插件 API

~~~js
export const inject = ['enterpriseAuth']

export function apply(ctx) {
  const auth = ctx.enterpriseAuth
  if (typeof auth.app !== 'function') {
    throw new Error('Enterprise application access requires an updated enterprise host.')
  }
  const xpie = auth.app('xpie')
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())

  async function listProjects() {
    const state = await auth.refresh()
    if (!state.connected) return { needsEnterpriseLogin: true }
    const response = await xpie.request('/v1/projects', { signal: lifetime.signal })
    if (!response.ok) return { status: response.status }
    return response.json()
  }
  // 按插件自身生命周期注册listProjects，产品文案使用现有locale服务。
}
~~~

xpie 只是后台登记的 app_id，SDK 内没有 Xpie 专用路径、token 正则或业务规则。其他企业插件访问另一应用只需替换 ID 与业务路径。

~~~ts
interface EnterpriseAppClient {
  readonly appId: string
  request(path: string, init?: {
    method?: string
    headers?: HeadersInit
    body?: string | ArrayBuffer | ArrayBufferView
    signal?: AbortSignal
  }): Promise<Response>
}
~~~

- path 必须是单斜杠开头的相对路径；不接受任意 URL。后台 base_url=https://apps.example/app、path=/v1/projects 时访问 /app/v1/projects，保留部署前缀。
- 插件不能传用户 ID、租户 ID、插件 ID 或认证头覆盖宿主身份。Authorization、Cookie、x-dsh-* 等受控头仍被拒绝。
- JSON body 显式 JSON.stringify；支持带 offset 的二进制 view，不支持普通对象、FormData、Blob 或 ReadableStream。沿用现有1MiB请求体、32MiB响应体限制；大文件采用业务应用已有分片协议。
- Desktop 与 Web 共享相同的实例绑定和会话代次。旧自定义 transport 不支持 requestApp 时返回 app_unavailable，不回退为向企业 origin 发送业务路径。
- 退出、账号变化或卸载会撤销 Host 实例并取消在途请求。仅自动 token refresh 不更换用户身份。
- 普通 auth.request 不允许直调 /api/v1/dsh/integrations 的凭据接口；此限制在 Host 边界执行。旧 Xpie 专用接口保留兼容，迁移后由业务侧移除。

通用客户端 owner 与可信宿主分别执行 client.dispose()、host.revoke(transport)；插件仅使用被绑定的公共服务，不自助 grant。认证模块其他 API 见 [静默会话复用](downstream-enterprise-sso.md)。

## 后台 HTTP 协议 v1

### 管理 API

GET /api/v1/dsh/admin/integrations 和 PUT 同一路径使用浏览器管理员认证。PUT body 与 GET 的 data 均为：

~~~json
{
  "revision": 0,
  "applications": [{
    "app_id": "xpie",
    "name": "Xpie",
    "base_url": "https://xpie.example.com/team",
    "enabled": true,
    "audience": "xpie-service",
    "scopes": ["projects:read"],
    "allowed_plugin_ids": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    "token_ttl": 30
  }]
}
~~~

成功遵循现有 resp_200(data=...)，保存后 revision 增加。CAS 冲突为 HTTP409、错误码26120；请求不含 tenant，服务器从当前管理员的可信租户上下文获得。表单/API均只接受注册字段，不回显任何 Bearer、token 或 secret。

### 宿主签发 API

POST /api/v1/dsh/integrations/{app_id}/delegations。仅可信 Host 访问，Authorization 为当前 DSH access Bearer，x-dsh-plugin-id 与 x-dsh-plugin-instance-id 由 Host 实际 grant 注入；重复认证/身份头拒绝。body 为 {}，或可选的 scopes 列表用于进一步缩小已配置范围，超范围请求拒绝。

响应为裸 JSON，不加业务 data 包装：

~~~json
{
  "protocol_version": 1,
  "app_id": "xpie",
  "audience": "xpie-service",
  "base_url": "https://xpie.example.com/team",
  "token_type": "Bearer",
  "access_token": "bapp_v1_<43个base64url字符>",
  "expires_in": 30,
  "scope": "projects:read"
}
~~~

主凭据需通过现有 DSH 专用 JWT 验签、真实用户/租户/活跃会话校验。插件必须是当前租户可见的已发布、未停用目录记录，且在应用白名单中。插件头只是可信 Host 的关联信息，不是远程代码证明；拥有企业主 Bearer 的受控宿主本身是信任边界。

Host 严格验证八个响应字段、app_id、协议版本、token格式、scope、URL和TTL；交换15秒总超时、响应体64KiB上限、禁止重定向。失败不向应用发业务请求，不向插件泄露后端原始错误内容。

### 应用在线校验 API

POST /api/v1/dsh/integrations/{app_id}/introspect，body={"token":"bapp_v1_..."}。以不可猜测的256位opaque凭据在线校验，无效时只返回 {"active":false}，依赖不可用时503并拒绝业务，不降级为本地或匿名身份。

有效响应为：

~~~json
{
  "active": true,
  "app_id": "xpie",
  "issuer": "https://bisheng.example.com",
  "audience": "xpie-service",
  "scope": "projects:read",
  "tenant_id": "34",
  "user_id": "12",
  "exp": 1790000030
}
~~~

exp 是 Unix 秒示例。目标应用必须独立核对 active=true、app_id、预配固定 issuer、预配 audience、所需 scope、有效 exp、合法 tenant/user，并用 issuer+tenant+user 隔离主体，继续执行业务资源权限。不要把原始token、用户自报字段或仅active=true当作完整权限证明。

每次校验重新验证原父会话、主体身份、配置revision/enabled、插件目录revision/发布版本及白名单。配置修改、插件停用/换版和会话撤销令旧凭据失效。校验返回前再次检查到期时间，慢依赖不能让过期凭据变成有效。目标应用若缓存结果，会自行引入撤权延迟；建议每次业务请求在线验证，长任务在关键读写/流检查点重验。

新 opaque 协议不是 JWT/JWKS，也不是 OAuth provider 授权码登录接口。原 Xpie xpie_v1_、scope=xpie:projects 与专用introspection合同不会自动兼容 bapp_v1_，必须先改造目标应用验证器和插件调用，再删除旧桥。

## 生命周期与部署限制

本能力不把独立应用变成宿主插件，也不直接读取另一个浏览器中的SSO Cookie。独立 xpie 客户端建立自身企业会话仍属于另一个客户端登录/身份交换场景。

后台配置撤销在下一次签发/在线校验生效；已经执行的业务副作用不会被取消。Host 能即时取消本地退出/插件撤销的流，远端应用应自行在长任务检查点重验授权。跨应用交换与后台introspection当前不续 Host idle session，避免后台校验无限保活；仅使用外部应用时仍可能达到既有 idle 到期策略。

当前 Web 形态仍按一个 Host/Profile 管理一份企业账号，不宣称多浏览器用户隔离。目标服务TLS、DNS/出站策略、真实Redis、MySQL/DM8锁和生产SSO属于部署验收；未部署代码不能视为线上可用。

## 验证入口

~~~bash
npm run verify:boundary
npx --no-install vitest run test/enterprise-apps-host.test.mjs test/enterprise-apps-integration.test.mjs test/enterprise-auth-sdk.test.mjs test/enterprise-web-auth.test.mjs
npm run typecheck
npm run build
npm test
npm run web:pack
git diff --check
~~~

本轮已执行：桌面完整回归5012 passed / 11 skipped、495个测试文件中491 passed / 4 skipped；新增应用resolver与双端集成测试无跳过。后台新增授权/中间件/跨仓HTTP验证组合106 passed，平台管理API与界面81 passed；类型检查、Desktop构建、下游边界门禁通过。该记录不代表后端全量回归或生产部署已验收；更广后端测试中既有ContextVar断言失败的复现见后端validation记录。

构建、完整测试和Web打包依次执行，避免共享Office准备目录并发写入。使用项目要求的普通Node版本，不把Electron的Node shim当作原生Node。后台 test/dsh/test_integrations.py、test/dsh/test_middleware.py 及platform新增API/面板测试提供服务与管理验收，跨仓wire烟测和实际执行结果记录于后端 features/local/enterprise-integrations/validation.md。
