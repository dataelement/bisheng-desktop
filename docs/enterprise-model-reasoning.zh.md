# 企业模型思考深度与协议配置

本次修改同时涉及 Bisheng 后端和 Desktop 企业适配器。源码和隔离联调已实现；需要部署新版后端并更新客户端，已安装旧版不会自动具备这些能力。

## 管理员配置

在 Bisheng「模型管理」中编辑 OpenAI 提供方的模型，在现有「高级参数」JSON 中声明供应商实际支持的档位。例如：

```json
{
  "reasoning_efforts": [
    { "id": "low", "name": "Low" },
    { "id": "high", "name": "High" }
  ],
  "reasoning_effort": "high",
  "use_responses_api": true
}
```

高级参数存储于模型 `config.user_kwargs`。不需要新增配置页面或数据库字段。`reasoning_effort` 是默认档位，客户端显式选择优先；`reasoning_efforts` 是管理员声明的可选项，不传给 SDK。当前适配器接受 `none/minimal/low/medium/high/xhigh/max`，只应声明该供应商和模型真实支持的值。

档位 ID 必须唯一，默认值必须在声明内；错误配置的模型会从企业目录省略，直接调用也会拒绝。默认字段存在但缺少档位声明同样视为错误配置。OpenAI、Azure OpenAI 节点支持本次档位映射；其他节点需要先增加明确映射。`reasoning_content` 只表示思考文本能力，与档位控制独立。

## 协议选择

`GET /api/v1/dsh/models` 返回可选的 `reasoning: {efforts, defaultEffort?}`，Harness 原生选择器据此显示思考档位。Chat 请求使用顶层 `reasoning_effort`；原生 Responses 使用 `reasoning.effort`。

原生 Responses 必须由服务端明确返回 `capabilities.responses: true`。当前要求 OpenAI 节点、显式 `use_responses_api: true` 和合法模型配置。新版 Desktop 收到该能力后调用企业 `/api/v1/dsh/responses`；未声明则继续 `/api/v1/dsh/chat/completions`。只在旧后端配置 `use_responses_api` 不会让 Desktop 自动改用 Responses。

Chat 接口仍输出 Chat 格式，调用时以请求级 SDK 副本关闭 Responses，不修改持久配置。原生调用失败不会自动切回 Chat，避免重复调用和加密历史损坏。

原生协议首版支持文本、图片、function 工具和 reasoning。强制 `store:false` 与 `include:["reasoning.encrypted_content"]`，携带完整历史；拒绝远端会话 ID、托管工具和其他未开放字段。加密输出仅供同一企业账户和模型回放，不显示为思考文本，账户或可见内容变化时不回放旧密文。

## 会话与图片

Harness 的 `sessionId`、`purpose` 经受控头发送到 Bisheng。服务端结合可信租户、用户、模型和用途生成隔离摘要，再以供应商 `session_id` 发送；Responses 的 `prompt_cache_key` 使用同一摘要。原始对话 ID 不发送给供应商。

图片超限时通过 Harness 的 `IMAGE_OFFLOAD_REQUIRED` 和真实 Session 卸载流程重新派生、重试。缺失或无效图片明确失败。锁定 Harness 版本不能卸载的旧嵌套 tool-result 图片超限时直接失败，避免无限重试。

## 验证边界

回归覆盖目录、broker 白名单、默认和显式档位、真实 SDK 请求、工具续轮、加密历史持久化、取消/断流结算和 Session 图片恢复。跨仓库 HTTP 测试经过真实 Desktop broker、Bisheng API/schema/治理和 SDK，身份存储、额度存储及供应商 HTTP 使用隔离替身。

可在本仓库运行跨仓库测试（路径指向本机 Bisheng 后端）：

```bash
BISHENG_BACKEND_ROOT=/path/to/bisheng/src/backend npx vitest run test/enterprise-protocol-integration.test.mjs
```

真实供应商、Gateway/Sub2API 转发、实际安装包界面和生产环境仍需部署后验收。测试中的 SDK 请求正确不代表供应商实际采用了指定深度，也不保证缓存命中。
