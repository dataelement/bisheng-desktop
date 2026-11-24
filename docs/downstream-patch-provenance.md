# 下游补丁来源清单

基准由 `ops/ci/upstream-baseline.json` 固定为已同步、已评审的上游提交。CI 获取该 SHA 并投影到 `upstream/V0.14.1`，再逐个比较最终字节；不使用远端分支持续移动的 HEAD。后续同步上游时，必须在同一 PR 更新该提交号并通过门禁，不能通过放宽白名单消除差异。

| 补丁 | 来源 | 当前状态 |
| --- | --- | --- |
| `@deepseek-ai+cordis-plugin-loader+1.1.0.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-agent-loop+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-api-remotes+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-api-session-controller+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-app-boot+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-file-upload+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-modules+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-shortcuts+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-agent-preset+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-attachment+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-chat+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-conversation+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-deliverables+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-input-trigger+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-layout+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-primitives+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-settings+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-settings-general+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-settings-models+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-sidebar+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-sidebar-browser+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-skill+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-trajectory+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-client-ui-workspace+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-credentials-local+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-host-open-in-app+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-llm+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-llm-deepseek+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-llm-pi-ai+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-mcp-client+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-office-kit+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-plugin-manager+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-session-persistence+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-session-persistence-jsonl+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-settings+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-skill+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-system-prompt+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-web-frontend+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-workspace+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+libreoffice-kit+0.2.3.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+node-addon-system+0.1.2.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@earendil-works+pi-ai+1.3.0.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `node-pty+1.2.0-beta.15.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `pnpm+10.34.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `sherpa-onnx-node+1.13.8.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `undici+8.11.2.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-http-proxy+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |
| `@deepseek-ai+dsh-subprocess-local+0.2.2-rc.5.patch` | `upstream/V0.14.1` | 字节一致，按同步补丁处理 |

共 49 个 patch，当前相对 `upstream/V0.14.1` 的 patch 文件差异为 0。

本地开发功能不依赖修改这些 patch 文件。公共源码覆盖登记在 `scripts/downstream-public-overrides.mjs`，门禁按 blob hash 精确校验，未登记的底座改动仍会失败。


## Windows CI 平台归属修正

`test/packaged-layout.test.mjs` 中下游新增的两个 BISHENG Linux SUID 安装脚本测试迁至 `test/enterprise-linux-installer.test.mjs`。断言保持不变，Linux CI 明确执行；Windows 不执行 POSIX shell/权限用例，其余打包布局测试继续运行。原文件的精确 blob 记录随此搬迁更新，未扩大路径白名单。Windows CI 使用 PowerShell 和系统原生 tar，公共 generation 构建审批测试保持原样。本次未修改 upstream。
