# 企业插件统一身份与静默会话复用

## 功能与适用范围

用户只在 BiSheng 企业账号入口完成一次登录。同一宿主内，被企业目录授权并由可信加载器加载的业务插件复用该会话，不再弹出登录页，不保存密码、access token 或 refresh token。后续企业插件，包括 xpie 的 BiSheng 集成插件，使用相同的身份状态与请求接口。

“静默”指读取现有企业会话、由宿主刷新凭据、为插件实例提供授权代理；不指绕过授权、自动创建企业账号或在会话失效时隐藏地完成交互式登录。

| 场景 | 行为与边界 |
| --- | --- |
| 当前 Desktop 企业账号已登录 | 企业市场加载插件时绑定实例授权，业务插件直接使用 enterpriseAuth |
| 当前独立 Web Host 已有企业会话 | 使用 Web 身份代理，不再依赖 Desktop broker；原部署仍是每个 Host/Profile 一份企业会话 |
| token 即将过期且刷新凭据有效 | 宿主合并并发刷新，插件无需再次登录 |
| 企业会话过期、撤销或退出 | 旧请求及授权失效，用户通过企业账号入口重新认证 |
| 插件未获授权 | 拒绝使用，不通过重复登录解决权限问题 |
| xpie 是独立客户端，只有另一个浏览器中的 BiSheng 已登录 | 本模块不直接读取浏览器 Cookie；需要额外的企业认证端身份兑换协议 |
| 多个浏览器用户共用一个 Web Host | 当前部署未提供每用户会话隔离，不可据此作为多人 SaaS 登录实现 |

独立企业应用的短期身份交换、后台应用管理及通用 `enterpriseAuth.app(appId).request()` API 见 [企业应用访问](downstream-enterprise-apps.md)。该扩展采用独立协议，需要配套后台与目标应用适配；下文的跨客户端边界仍成立。

## 身份与信任边界

必须区分三个身份：用户/租户身份由企业认证服务确认；pluginId 来自经过授权的企业插件目录记录；instanceId 由可信宿主为每次加载生成。插件配置、插件提交的 userId、请求头以及插件 ID 字符串本身都不是身份凭据。

现有 Desktop 的企业登录继续使用一次性 identity_ticket、PKCE S256 与 state：浏览器负责企业认证，主进程兑换并保管凭据。业务插件不发起另一轮 SSO。

Desktop 主进程的凭据 broker 仅允许可信 owner 创建/撤销实例 capability。Host 加载器将对应 transport 绑定到实际插件 fiber 的上下文，不绑定到共享 root、可复用 Loader entry 或不相关的兄弟插件。卸载后保留拒绝访问的绑定，旧上下文不能继承新实例的授权。

Web 使用闭包保存实例授权和会话代次，代理验证会话及用户/租户后注入企业凭据。账号变化、注销和 Host 停止时撤销旧实例。

这些是可信宿主内的授权隔离，不是对同一 Node 进程内任意恶意代码的安全沙箱。外部客户端发送的 x-dsh-plugin-id 不构成服务端可信插件身份证明；若服务端按插件控制权限，仍须验证服务端签发的授权或等价可信授权记录。

## 模块结构与入口

| 包入口 | 使用者 | 职责 |
| --- | --- | --- |
| dsh-desktop-enterprise/auth | 普通 JS/TS 客户端与非 Cordis 宿主 | 不依赖 Electron/Cordis 的认证客户端、类型和错误；接收已授权 transport |
| dsh-desktop-enterprise/auth-host | 可信 Cordis/Desktop Host | 注册 enterpriseAuth 服务、绑定/继承实际插件上下文、建立 broker transport |
| dsh-desktop-enterprise/auth-web-host | 可信 Web/Node Host | 将现有企业会话转为实例授权代理，校验目标、请求头、身份和会话代次 |

源码由 [enterprise-auth-client.js](../packages/dsh-desktop-enterprise/enterprise-auth-client.js)、[Cordis 适配](../packages/dsh-desktop-enterprise/enterprise-auth.js)、[Web 宿主代理](../packages/dsh-desktop-enterprise/web-auth.js) 和 [企业加载器](../packages/dsh-desktop-enterprise/market-runtime.js) 组成。新增模块不修改公共底座、OS scheme 或安装流程。

加载发生在后端 apply/activate 阶段：企业目录已验证插件归属，Harness 按该插件包的有效解析基准加载代码，企业适配器在 apply 前授予实例上下文。普通 Profile 使用现有企业加载链路；Safe Mode 不额外开启企业授权或加载企业市场插件。SDK 导入成功不等于插件已被企业目录授权，也不证明客户端 UI 已挂载。

## 企业插件开发者接入

由企业目录登记并经现有企业市场加载的 Cordis 插件，只需依赖 enterpriseAuth 服务。不要从普通插件中调用 grant、bindEnterpriseAuth 或读取 broker 配置。

以下示例的业务路径是示意，接入时替换为企业服务实际提供且允许当前用户访问的接口。

~~~js
import { EnterpriseAuthError } from 'dsh-desktop-enterprise/auth'

export const inject = ['enterpriseAuth']

export function apply(ctx) {
  const auth = ctx.enterpriseAuth
  const lifetime = new AbortController()
  const unsubscribe = auth.subscribe(state => {
    // 更新插件自己的可用状态；账号变化时清除旧用户展示数据。
    updateAccountView(state)
  })
  ctx.effect(() => () => {
    unsubscribe()
    lifetime.abort()
  })

  async function execute() {
    const state = await auth.refresh()
    if (!state.connected) {
      showEnterpriseAccountEntry()
      return
    }
    try {
      const response = await auth.request('/api/example/business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'example' }),
        signal: lifetime.signal
      })
      if (!response.ok) {
        showBusinessError(response.status)
        return
      }
      showResult(await response.json())
    } catch (error) {
      if (error instanceof EnterpriseAuthError) {
        showEnterpriseError(error.errorCode)
        return
      }
      throw error
    }
  }

  registerBusinessAction(execute) // 插件按自身生命周期注册/清理业务入口。
}
~~~

示例中的界面及业务入口函数由插件实现，产品文案使用插件现有 locale 服务。插件前端需要展示身份或执行操作时，应经过自身经过认证的后端接口；不要向 window、DOM、前端配置或日志传递 transport capability 或用户凭据。

## 非 Cordis 宿主与 xpie 的接入

通用客户端本身不负责信任认证。xpie 的可信宿主必须先拥有 BiSheng 认可的当前用户会话，再根据可信插件记录创建 transport，最后将受限客户端注入插件。不得让普通插件通过传入任意 pluginId 自助申请身份。

同一 Node/Web 宿主可复用现有 Web adapter，以下示例由可信宿主执行：

~~~js
import { createEnterpriseAuthClient } from 'dsh-desktop-enterprise/auth'
import { createWebEnterpriseAuth } from 'dsh-desktop-enterprise/auth-web-host'

// 每个企业用户会话一份 host。不要把它共享给不同的 Web 登录用户。
const host = createWebEnterpriseAuth({
  getAccount: () => accountSnapshot,
  getSessionAuth: () => ensureValidBiShengSession()
})

// 两个值均由可信目录/加载器提供；pluginId 沿用企业目录的 32 位小写十六进制 ID。
const transport = await host.grant({ pluginId: trustedRecord.pluginId, instanceId: crypto.randomUUID() })
let client
try {
  client = await createEnterpriseAuthClient(transport)
} catch (error) {
  await host.revoke(transport)
  throw error
}

// 只给业务插件四个公共方法，不暴露 host、transport 或用户 token。
const pluginAuth = {
  getState: () => client.getState(),
  refresh: () => client.refresh(),
  subscribe: listener => client.subscribe(listener),
  request: (path, init) => client.request(path, init)
}
attachPluginIdentity(pluginAuth)

async function unloadPlugin() {
  client.dispose()
  await host.revoke(transport)
}

function onEnterpriseSessionChanged() {
  host.invalidate() // 在替换账号/退出时同步执行，然后为新会话重新授权插件。
}
~~~

accountSnapshot 至少含 connected、connectionKey、user.id 和 tenant.id，可含 base；ensureValidBiShengSession 返回 base、tokens.access_token、user.id 和 tenant.id。connectionKey 在登录/换账号/退出时更新，同一会话的凭据刷新不改变它。宿主负责安全保存和刷新 token，刷新结果不得跨账号提交或在退出后恢复旧会话。Host 关闭时先使所有授权失效，再销毁其余资源。

若初始化完成前插件已取消加载，宿主必须在初始化 Promise 返回后立即 dispose/revoke，不再挂载插件。

xpie 若使用独立进程或浏览器 renderer，则通过受认证、限定插件实例和生命周期的 IPC/后端通道实现同一个 transport 契约；不能把上例中的 tokens 或 Web host 对象搬进不可信前端。客户端模块使用标准 AbortController、AbortSignal.any、fetch Response 和 Web Streams，需要宿主提供兼容运行环境。

如果 xpie 只有自己的 SSO 会话，企业认证服务还必须完成：登记 client_id=xpie；验证身份源、issuer/audience/有效期；映射企业员工与租户；签发绑定 xpie 的短期会话。可以复用 SSO 浏览器登录态或可信服务端身份兑换。当前仓库已接通 RFC 8693 默认换证入口：Host 使用当前 Enterprise 主会话，以插件提供的 client ID 向服务端申请应用 Token，并按插件现有服务地址转发请求，动态路由接口与部署前提见 [企业应用 RFC 8693 迁移](downstream-enterprise-apps.md)。后台须支持该主会话来源；主凭据只发送给 BiSheng，xpie 只收到换证后的应用凭据。

## Desktop 统一平台登录后续迁移

统一平台认证入口为 POST /api/v1/auth/login，配套 POST /api/v1/auth/refresh、GET /api/v1/auth/session、POST /api/v1/auth/logout。参考实现见 [BiSheng platform_auth 路由](https://github.com/dataelement/bisheng/blob/feat/026-token-exchange-alpha1/src/backend/bisheng/user/api/endpoints/platform_auth.py)。它们与跨应用 RFC 8693 Token Endpoint 分属主会话建立和目标应用换证两个阶段。

本次跨应用 Host 迁移不改变 Desktop 当前系统浏览器授权、identity_ticket 和 /api/v1/dsh/token 主登录。Desktop 主登录切换仍需单独完成 UI/浏览器交接、Native 凭据交付、client_id、刷新轮换、安全存储与旧会话迁移。参考分支只列出 bisheng-web / bisheng-mobile，不能以冒充 Mobile 或只改 URL 的方式声明 Desktop 主登录已经迁移；实际部署的 Desktop 正式契约应由后台版本确定。

## 公共 API 与生命周期

| API | 语义 |
| --- | --- |
| getState() | 同步返回脱敏快照副本，字段仅 connected、enterpriseId、userId、sessionVersion |
| refresh() | 合并并发的状态读取，不打开登录页，不直接向插件返回 token；读取失败时缓存转为 disconnected，并保留异常给调用方 |
| subscribe(listener) | 仅通知状态变化；初始状态用 getState；返回取消订阅函数；监听器收到快照副本 |
| request(path, init) | 通过宿主访问当前企业相对路径，附加会话代次；保留业务 HTTP Response，不自动重放 401/写请求 |
| dispose() | 仅通用客户端 owner 可用；取消本地请求信号、轮询及订阅；宿主还必须 revoke 对应实例授权 |

默认每 1000ms 读取状态；创建通用客户端时可配置 pollIntervalMs=0，由宿主事件触发 refresh。状态读取与 token 刷新不同：token 过期判断、refresh token 轮换与安全存储均属于宿主。

同一用户/租户/会话快照不变时不通知。会话变化或状态读取失败时，SDK 取消旧请求信号；宿主 transport 必须同时验证会话代次，并在请求、响应头和响应体读取阶段检查权限，撤销时取消流。轮询是展示状态同步机制，不替代即时请求鉴权。

request 使用当前缓存中的 sessionVersion。若它落后于宿主，将被宿主拒绝；调用方可以 refresh 更新展示，但不要自动重放有副作用的业务操作。业务返回 401/403 不等于必须重新登录，可能是接口权限或业务拒绝，应先展示实际错误。

## 错误与恢复

| 情况 | 处理 |
| --- | --- |
| authorization_denied | 未绑定、插件被撤销或授权失效；保留企业账号入口，交由宿主确认授权 |
| session_changed | 账号/租户/会话代次变化；清除旧用户数据，等待可信加载器重新授权 |
| not_connected | 当前宿主无可用企业会话；提示从企业账号入口登录 |
| request_failed / request_timeout | 展示可重试错误；不主动弹登录页或重放业务请求 |
| invalid_request | 检查相对路径、请求头、body 与调用参数 |
| HTTP 401/403 等 Response | 属于业务响应；SDK 不擅自兑换身份、不自动重试写操作 |

无论状态查询或刷新失败，都不记录完整响应、票据、token、Cookie 或 capability。退出登录和卸载不删除用户文件、历史会话及插件安装记录。

## 验证与验收

行为回归覆盖通用客户端、Cordis 上下文隔离、真实 loopback broker、Web adapter 和真实 index.apply 接线；外部服务通过测试 fixture 替代。

~~~bash
npm run verify:boundary
npx --no-install vitest run test/enterprise-auth-client.test.mjs test/enterprise-auth-sdk.test.mjs test/enterprise-auth-concurrency.test.mjs test/enterprise-web-auth.test.mjs test/enterprise-v131-service.test.ts
npm run typecheck
npm run build
npm run web:pack
npm test
git diff --check
~~~

测试文件：[通用客户端](../test/enterprise-auth-client.test.mjs)、[SDK 与加载生命周期](../test/enterprise-auth-sdk.test.mjs)、[broker 并发](../test/enterprise-auth-concurrency.test.mjs)、[Web 身份代理与集成](../test/enterprise-web-auth.test.mjs)、[Desktop 企业服务](../test/enterprise-v131-service.test.ts)。

上述命令是验收步骤，不代表在任意环境均已通过。Web 打包要求脚本指定的原生 Node 版本；生产 SSO、服务端插件权限执行、跨客户端 xpie 兑换、macOS/Windows 安装后登录与真实 UI 仍需在相应环境联调。模拟服务测试及编译成功不能替代这些验收。
