# V1.3.1 新架构切换记录

## 切换方式

旧版基准：`8015b3f3b46960d869e702701c1ee35624f5dc90`。
新架构候选：`238ca04b`，源于 `codex/bisheng-unified`。

在独立工作区从新架构候选建立迁移分支，使用 `git merge -s ours --no-ff origin/V1.3.1` 记录旧版历史已被新架构替代。该合并的代码树必须与新架构候选完全一致；不逐文件解决冲突以免恢复旧的运行时。合并提交同时保留双方父提交，未强推、重置或删除旧版历史。

复用 PR #145，以普通 merge commit 合入 `V1.3.1`，不 squash、不 rebase merge，以保留迁移祖先关系。合入前重新确认目标仍是上述基准；若目标前进，先核对新增功能，不自动覆盖。合入后获取远端并验证旧版基准与新架构候选均为 `V1.3.1` 的祖先。

三条候选流水线均新增 `V1.3.1` 的 push / pull_request 触发。发布仍按现有 release workflow，合并代码不创建版本标签、不触发正式发布。

## 本地验证

新架构候选通过全量 4833 项测试（11 项跳过）、typecheck、边界检查、桌面构建及 macOS arm64 Web 打包。插件授权通道通过真实本地 HTTP broker 验证同一插件 12 个同时在途请求及正常完成、退出登录、撤销授权的清理。Chat/Responses 另有 16 并发回归。

CI 已固定评审后的上游 SHA，并在 checkout 前关闭 CRLF 转换；Windows portable 的边界步骤已实际通过。完整 Windows portable / 多平台构建以本次提交的 Actions 结果为准，不能把本机结果替代远端验收。

## 已知限制与排除项

- V1.3.1 手机分页与置顶排序已迁入；公共桥 `workspace/follow` 的 `pinned/replace` 实时更新帧修复暂缓，用户要求不动 upstream。详细范围见 `downstream-v130-v131-unified-migration.md`。
- 原工作区仍未提交的模型工具执行、提示词与身份处理实验未纳入切换；保留原工作区，不使用 `git add .` 打包这些内容。
- 企业生产 SSO、授权撤销、云票据以及 Windows 安装后流程尚不能宣称全部验收；代码合并、安装产物和正式发布是不同状态。

## 回退

保留旧版基准 SHA。若切换后必须回退，基于实际合入 `V1.3.1` 的 PR merge commit 创建 revert PR（以目标分支父提交为 mainline），通过检查后普通合入。禁止用 force push 将远端历史重写回旧版。
