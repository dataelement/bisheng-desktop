# Work 完成通知独立于会话目录投递 — 2026-11-02

## 测试反馈与本轮范围

Windows 新包验收反馈：通知已允许、请勿打扰关闭，普通后台、最小化和连续采样三轮纯文本任务均正常完成，原生通知均未观察到。连续采样 32 次覆盖运行至完成。TC-120-NOTICE-001 失败，NOTICE-002/003 继续受阻。

本轮从源码复现并修复一处通知消费缺陷。测试记录提供端到端失败现象，现场通知阶段日志与精确构建提交继续待核对；本轮源码复现与现场故障的因果对应仍需 Windows 新包确认。

## 基线

- 远端在线核对 `dataelement/bisheng-desktop:V1.2.0@09c22fe34e5c89193c15387685810fbaa45e73fc`，包含原通知修复 PR #99。
- 独立工作目录：`.worktrees/bisheng-work-notification-retest-20261102`，分支 `codex/v120-work-notification-retest`。
- Harness `0.2.1-rc.2`，Electron `43.0.0`，本机 macOS arm64。`dataelement/dsh-desktop:v0.9.0` 远端查询返回空引用；本轮沿测试对应 BISHENG V1.2.0 版本线。
- 复用相同基线的依赖副本和经构建脚本校验摘要的 Office 下载缓存；依赖与锁文件保持当前版本。

## 已复现的代码缺陷

完成投影由认证 control stream 独立送到公开 `sessions.list.projectionsBySession`。原消费者先要求 `list.phase === ready`，再遍历目录 `ids`、从 `byId` 取完成投影。目录 RPC 初次加载失败时，实际 Harness 保留 `phase=pending`；收到有效控制投影的会话也可以暂时没有目录行。因此内容已完成、完成投影已到客户端，通知仍会被这两项目录条件截断。

原回归手工构造 ready 状态和完整目录行，把目录存在作为通知触发的前提，漏掉了这一状态组合。

## 修复与契约

- 直接遍历公开 `projectionsBySession` 的完成事实。目录加载状态与目录行负责导航展示，完成投影负责通知。
- 继续使用既有成功轮次、历史基线、子任务/继承事件过滤、序列去重、主进程前后台判定与通知点击路由。
- 修改自有插件，沿用公开 Harness API、窄 IPC 和 Windows 应用身份；发布需要包含本轮改动的 Desktop 安装包。
- 将通知生产与主进程通知回归加入现有 Windows 测试入口。

## 验证

- 原代码对照：新增 5 项回归失败、既有 11 项通过；修复后通知相关 2 文件 / 31 项通过。
- 定向验证：实际 SessionProjectionRegistry 和 AgentLoop；实际安装版 ClientSessions / SessionManager / projection store 接收 control 帧，覆盖目录加载中、目录 RPC 失败和空目录。目录 RPC 与浏览器 store 外部边界采用夹具，控制帧由测试驱动，认证 socket 传输单列。
- 原生验证：macOS 真实 Electron、sandbox/contextIsolation、preload/main IPC；隐藏、普通后台及最小化窗口分别投递通知；点击恢复窗口并打开对应 Work 会话；图标解码、重复消费、失败日志及清理通过。系统 toast 对象采用测试替身。
- 类型检查、生产构建、JS 语法及差异检查通过。完整串行回归 325 文件 / 3220 项通过，4 文件 / 5 项按环境条件跳过（329 文件 / 3225 项）。
- 证据：本工作目录 `artifacts/work-notification-retest-20261102/`。

## 验收边界

本轮完成本地源码修复与验证。Windows 25H2 安装版、真实系统通知、通知发送者/图标及 NOTICE-001/002/003 实机验收继续待执行。既有 Windows 失败状态保持，后续以新包和现场结果更新。
