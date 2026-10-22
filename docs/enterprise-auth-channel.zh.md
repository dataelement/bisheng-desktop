# 通用企业认证请求通道

## 职责与授权

Electron 主进程持有企业 token，复用企业登录模块的安全存储、刷新、退出及会话管理。Harness 的企业宿主适配器只持有本地 Broker 管理凭证；市场 Loader 为每个通过企业签名授权并启用的执行实例申请独立、可撤销的通道凭证。业务插件不获取 token、本地地址或代理凭证。

当前授权粒度是企业市场的启用实例，不是逐业务 API 许可。**后端若只校验用户 token，则获准使用此通道的插件可以调用该用户有权访问的企业 API。**宿主不维护业务路径列表，不解析业务 JSON。后端需要细粒度插件权限时，校验宿主覆盖的 `x-dsh-plugin-id` 与 `x-dsh-plugin-instance-id` 身份头；后端必须拒绝来自不可信客户端的同名身份声明，不能把单独一个 HTTP 头当作签名。

## 插件 SDK

服务名是 `enterpriseAuth`，插件声明对该服务的注入依赖。未登录不会导致服务消失；已获准的实例可以激活，认证调用返回明确的 `not_connected` 错误。普通非企业市场上下文不自动获准使用通道。

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

`request(path, init)` 接受根相对路径、可选 method、headers、string / Uint8Array body 和 AbortSignal，返回标准 Response。查询参数、原始响应字节、业务状态码与允许的响应头透传；插件自行选择 json()、arrayBuffer() 或 body reader。HTTP 4xx/5xx 不抛 SDK 认证错误，不重放业务请求。

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

不提供 enterpriseSearch 服务或本地 /v1/search 接口。搜索插件使用同一 SDK 构造业务请求，并自行负责 provider 注册、自动选择及停用恢复。原来注入搜索专属服务的插件 ZIP 必须修改后重新发布。

## 验证边界

行为测试覆盖通用传输、实例授权、撤销、会话隔离及真实 Cordis Loader 组合。本次最终定向回归 11 个测试文件、162 个用例通过；typecheck、build 和 git diff --check 通过。全量回归 1954 通过、8 失败、2 跳过，失败集中于 Electron Node 探测、宿主禁用插件启动、启动失败诊断和 ASAR 原生布局/清理测试；未将其表述为全量通过。

源码测试不等于已安装应用升级完成；真实企业后端、完整 Electron UI、安装包和 Windows 原生环境须另行验收。
