# 通用企业认证请求通道

## 职责与授权

Electron 主进程持有企业 token，复用企业登录模块的安全存储、刷新、退出及会话管理。Harness 的企业宿主适配器只持有本地 Broker 管理凭证；市场 Loader 为每个通过企业签名授权并启用的执行实例申请独立、可撤销的通道凭证。业务插件不获取 token、本地地址或代理凭证。

当前授权粒度是企业市场的启用实例，不是逐业务 API 许可。**后端若只校验用户 token，则获准使用此通道的插件可以调用该用户有权访问的企业 API。**主进程的原始请求 Broker 不维护业务路径列表，不解析或改写业务 JSON；SDK 的工具辅助方法只处理通用工具协议。后端需要细粒度插件权限时，校验宿主覆盖的 `x-dsh-plugin-id` 与 `x-dsh-plugin-instance-id` 身份头；后端必须拒绝来自不可信客户端的同名身份声明，不能把单独一个 HTTP 头当作签名。

## 插件 SDK

实现位于 `packages/dsh-desktop-enterprise`，服务名是 `enterpriseAuth`，插件声明对该服务的注入依赖。未登录不会导致服务消失；已获准的实例可以激活，认证调用返回明确的 `not_connected` 错误。普通非企业市场上下文不自动获准使用通道。

```js
export const inject = ['enterpriseAuth']
export function apply(ctx) {
  // Business request construction and response parsing belong to the plugin.
  return ctx.enterpriseAuth.request('/api/v1/new-feature/action?mode=full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'example' }),
  }).then(response => response.json())
}
```

`getState()` 返回同步的只读公开快照：`connected`、可选 `enterpriseId` / `userId`，以及不含凭据的 `sessionVersion`。快照用于状态显示，真正授权与登录状态由主进程逐请求检查；会话版本不是 token，也不作为授权凭证。

`request(path, init)` 接受任意合法的同源根相对 API 路径、可选 method、headers、string / ArrayBuffer / ArrayBufferView body 和 AbortSignal，返回标准 Response。查询参数、请求体、原始响应字节、业务状态码与允许的响应头透传；插件自行选择 json()、arrayBuffer() 或 body reader。HTTP 4xx/5xx 不抛 SDK 认证错误，不重放业务请求。原始通道不限于工具 API，也不是搜索接口；主进程 Broker 不得解包、补写或重写业务 payload。

## 统一工具调用客户端

`ctx.enterpriseAuth.invokeTool(toolName, args, options)` 是 SDK 的通用工具辅助方法，与 `request()`、`getState()` 使用相同的插件执行实例授权；不存在另一个匿名或可绕过实例绑定的工具客户端。未获准、已撤销和未登录的实例不能凭此方法取得额外权限。

`options` 支持 `signal`，以及默认值为 `timeoutMs: 60000`、`maxInputBytes: 65536`、`maxResponseBytes: 4194304` 的限制。统一客户端负责校验工具名并构造 `POST /api/v1/dsh/tools/{toolName}/invoke`，JSON 请求体只包含 `{ arguments: args }`。响应按通用工具信封解析，成功返回 `envelope.result` 的通用 JSON 值，不返回搜索专属结果，也不替业务插件解释其字段。

```js
export const inject = ['enterpriseAuth']
export async function apply(ctx) {
  const result = await ctx.enterpriseAuth.invokeTool('example_tool', { query: 'example' }, {
    timeoutMs: 60000,
    maxInputBytes: 65536,
    maxResponseBytes: 4194304,
  })
  // Interpret the tool-specific result in this plugin.
  return result
}
```

统一客户端对输入序列化、响应读取和 JSON 解析施加大小限制，并处理超时、取消、无效信封与 HTTP 失败。工具调用失败使用 `EnterpriseToolError` 的 `errorCode`、`status` 及可选的、经校验的 `backendCode` / `requestId` 提供有界诊断；不把后端任意错误消息、原始响应体或敏感字段带入错误文案。底层认证和实例授权错误仍遵循认证通道契约。工具客户端不自动重试，不因 401 刷新后重放，不降级到其他端点或绕过 SDK 直连后端。

工具调用继承实例生命周期与主进程会话校验，并在异步结果交付前校验当前会话；退出、切换企业、重新登录、取消或实例撤销后，旧调用不能把结果交给新会话。限制和取消是客户端资源与生命周期约束，不代替后端的参数校验、工具权限、额度或执行超时控制。

### 职责归属

- **Electron 主进程**：持有和刷新企业凭据，绑定并撤销执行实例身份，执行同源原始请求传输、会话隔离及传输资源限制；不识别搜索参数，不改写业务请求或响应。
- **企业宿主 SDK（`packages/dsh-desktop-enterprise`）**：提供统一 `enterpriseAuth` 客户端，集中维护通用工具名/路径、`arguments` 信封、受限 JSON 解析、安全错误诊断、取消和会话安全。
- **业务插件**：声明实际工具及业务参数，保留业务 UUID、模型选择、provider 与命令注册、业务结果转换和卸载恢复。搜索插件不再复制通用工具传输、信封解析和错误处理。

增加新的工具名或合法相对 API 路径不需要在宿主添加业务白名单。新增工具的返回结构、权限和兼容性仍需由插件与企业后端共同约定。

## 安全与生命周期

- 请求仅发送到当前企业配置的服务源。拒绝绝对 URL、协议相对 URL、反斜线、控制字符及跨源解析；不跟随重定向。
- 拒绝覆盖 Authorization、Host、Cookie、代理、连接控制及宿主插件身份等敏感头；上游请求使用 credentials: omit，凭据只由主进程附加。
- 允许的响应头包括内容类型、语言、文件名、缓存元数据、重试时间与请求 ID；不透传 Set-Cookie、Authorization、Location 等敏感头。
- 退出、切换企业、重新登录和宿主停止会取消在途请求。发送和每次流读取后重新检查会话版本，丢弃晚到数据。实例停用、卸载、激活失败先撤销通道，再清理执行实例。
- 请求体上限 1 MiB，响应上限 32 MiB；全局最多 8 个请求，每实例最多 4 个。响应头等待 15 秒，流空闲 60 秒，整个请求最多 5 分钟。流逐块读取并遵循下游背压，不先缓存为 JSON。
- 审计记录插件、去掉查询参数的路径、状态和耗时；不记录 token、完整请求或响应体。
- SDK 错误通过 errorCode 区分 not_connected、authorization_denied、session_changed、invalid_request、request_failed、request_aborted、request_timeout、too_many_requests 及大小限制等；业务 401 不触发自动重试。

## 信任边界

当前 Harness 市场插件是共享 Node 进程中的代码，不是恶意代码沙箱。实例绑定、隐藏代理凭证和清理环境变量可以防止正常 SDK 使用中的身份冒用与凭据误传，但无法抵御同进程恶意插件篡改全局 fetch、读取其他进程数据或调用调试能力。不能把 Cordis 作用域授权宣称为对任意恶意 Node 插件的强安全隔离；需要这种保证时，必须把第三方执行实例迁入独立受限进程并由宿主绑定 IPC 身份。

通道信任当前企业后端不在业务响应中返回宿主持有的 token。透明二进制/流式代理不能同时保证识别任意业务内容中主动回显的凭据；后端应关闭凭据回显、限制会签发凭据的接口，并对插件实施必要权限控制。宿主不会为了解析这些业务内容引入 API 白名单。

## 搜索迁移

不提供 `enterpriseSearch` 服务或本地 `/v1/search` 接口。搜索插件通过 `ctx.enterpriseAuth.invokeTool()` 调用企业工具，保留搜索业务 UUID、模型与参数选择、provider/命令注册、结果转换、自动选择及停用恢复；不在搜索插件内维护另一份通用工具客户端。原来注入搜索专属服务或复制原始工具调用逻辑的插件 ZIP 需要迁移并重新发布，宿主与插件版本须共同验证。

## 验证边界

相关行为回归入口包括 `test/enterprise-auth-transport.test.ts`、`test/enterprise-auth-sdk.test.mjs`、`test/enterprise-search-bridge.test.ts` 和 `test/enterprise-search-market.test.ts`，用于检查通用传输、实例授权与撤销、会话隔离及 Loader 组合。`test/enterprise-tools.test.mjs` 覆盖统一工具客户端的路径/信封、通用 JSON 结果、输入与响应限制、取消/超时、安全诊断和不重试，以及真实 Cordis 授权与本地 HTTP 组合。测试命令见 [企业插件市场](enterprise-plugin-market.zh.md)。

本文描述接口、职责与验收边界，不沿用旧版测试数字作为当前分支或本次 SDK 变更的验证结论。具体通过项、失败项和未运行项以对应变更实际执行记录为准；纯文档检查不代表上述行为回归已执行。

源码测试不等于已安装应用升级完成；真实企业后端、完整 Electron UI、安装包和 Windows 原生环境须另行验收。
