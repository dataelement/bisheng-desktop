# Work 企业工具与 Skill：本地开发交接

2026-10-22。用户确认“登录毕昇一次，Work 自动以当前账号调用企业工具”，并授权本地开发。代码保存在两个隔离工作树的 `codex/local-enterprise-capabilities` 分支，目标毕昇分支由用户另行指定。

## 当前实现

1. 桌面宿主复用现有登录刷新及 `/api/v1/dsh/web-session` 交换，向固定 `/api/v1/dsh/work/mcp` 地址发送标准 MCP 请求。平台凭据留在宿主，Agent 接收工具数据与 Skill 内容。
2. 后端使用当前用户身份，把管理员发布集与现有工具 use 权限求交。调用时重新检查权限和发布状态，复用 `ToolExecutor`，以 `DSH_DESKTOP` 类型保留真实执行错误。
3. 桌面通过 MCP SDK 注册原生 Harness 工具；执行经过策略、逐次审批及结果处理。第一版支持主 Work 任务，子任务的企业工具调用由运行时拒绝。
4. 企业 Skill 通过原生 provider 发现和加载。完整包包含正文、脚本、模板及其他附件；客户端下载前后核对身份、版本、文件哈希、总大小及路径。稳定名称包含租户和 Skill ID，同名个人 Skill 保持独立。
5. Skill 显式工具依赖在加载时校验并映射到桌面运行名。账号变化清理目录与本地缓存；远端停用影响后续加载和调用。
6. 发布、工具执行及 Skill 加载写入现有结构化审计。工具执行先写 STARTED，再写 SUCCEEDED 或 INCOMPLETE，审计字段保留用户、租户、资源及关联 ID。审计存储不可用时，工具保持未执行。

## 发布与依赖合同

租户管理员通过当前平台登录态调用：

- `GET /api/v1/dsh/work/publications`：当前租户已发布的工具、Skill ID。
- `PUT /api/v1/dsh/work/publications/tool/<tool_id>`，JSON `{"enabled": true}`。
- `PUT /api/v1/dsh/work/publications/skill/<skill_id>`，JSON `{"enabled": true}`。
- 撤回发布使用同一地址和 `{"enabled": false}`。

默认发布集为空；原有工具权限和 Skill 启用状态继续生效。本轮提供管理接口，后台发布按钮随目标分支页面接入。

Skill 的 SKILL.md 可声明依赖：

```yaml
---
name: customer-report
description: 查询客户并生成报告
metadata:
  bisheng-work:
    tool_ids: [7]
---
先调用工具 7 查询客户，再使用 templates/report.csv 生成结果。
```

客户端向正文补充 `7 → mcp__bisheng__bisheng_tool_7` 的运行名称映射。脚本与文件操作继续走 Work 原生受控工具。单包上限 512 文件、16 MiB；工具执行期限 60 秒，网络请求保持单次发送。

## 验证证据

- 桌面完整回归：232 文件、1975 项通过、1 项既有条件跳过；包含本次跨语言集成。最终日志见主工作区 `outputs/enterprise-work-local-20261022/desktop-tests.log`。
- 桌面类型检查和生产构建通过，见 `typecheck.log`、`build.log`。
- 后端本次定向测试：13 项通过，包括真实 SQLite 迁移/回滚与租户过滤、发布撤回、实时权限复查、Skill 版本变化、MCP 协议和审计失败阻止执行。
- 跨语言测试：真实 Python MCP Server → 宿主固定代理 → JavaScript MCP Client → Harness ToolRuntime/SkillRegistry/skill 工具。验证审批、工具结果、二进制附件/模板读取、子任务拒绝、撤回发布和依赖失效。
- 一次登录测试使用本地登录服务，验证自动刷新、宿主持有 cookie、退出后旧身份被拒绝。

测试的业务资源、账号、执行器和存储采用受控夹具；协议库、宿主代理、Harness 运行时以及发布库隔离测试使用实际实现。真实企业 API、上游 MCP 服务、对象存储、完整后台启动、真实模型任务、原生窗口及 Windows 安装包进入下一阶段验收。项目 G1–G4 验收状态继续沿用原记录。

## 基线和合入准备

- 桌面：`dataelement/bisheng-work:V1.2.0@a1ce7bf83c1d3f98dda0802f197e906669de167f`，Harness `0.2.0-rc.2`。
- 后端：`06dfe76d6ff83778ed7df1a38f540431057a80af`，从原工作树已提交状态创建；原工作树的其他未提交改动保持原位。
- 上游 `dsh-desktop:v0.9.0` 核验结果为标签 `7a9ed7f94257ff82daf76f2ec5e9defe16bb8661`；本轮沿用企业桌面 V1.2.0 的依赖与运行合同。
- 新迁移 `dsh_work_publication` 当前父版本为 `f077_subject_id_search_indexes`。用户指定后端分支后，先检查迁移头、登录合同、Skill 存储和 ToolExecutor，再迁移本地改动并重跑集成。
- 本轮保持本地代码与证据；共享分支、3006 服务、现有开发 Profile 和正式安装包沿用原状态。

## 复跑

桌面工作树运行 `npm test`、`npm run typecheck`、`npm run build`。
跨语言测试在上述命令前设置 `BISHENG_WORK_BACKEND_ROOT` 为后端 `src/backend` 绝对路径、`BISHENG_WORK_PYTHON` 为包含后端测试依赖的解释器。该环境变量同时打开默认条件跳过的跨语言用例。
后端在 `src/backend` 运行：

```sh
python -m pytest --confcutdir=test/dsh test/dsh/test_work_capabilities.py test/dsh/test_work_publication.py -q
```

本地验证使用 MCP Python `1.30.0` 与 MCP JS Client `2.0.0`；Python 独立测试环境的实际依赖清单随证据保存。完整后端测试需在目标分支锁定环境继续执行。
