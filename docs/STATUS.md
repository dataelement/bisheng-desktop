## 2026-10-16 — Chat / Work 侧栏行与上下文展示对齐

- 基线实时核验：bisheng-work/V1.2.0@e0359f330bceb95d41d0defa849adeec300895d1；工作目录 bisheng-work-chat-work，分支 codex/chat-work-integration，Harness 0.2.0-rc.2。
- 云端最近记录与 Work 标题采用相同 28px 行内左距、32px 行高和 10px 时间字号。长标题在悬停/键盘聚焦时按 Harness 速度展示，离开后复位，支持减少动态效果偏好。项目归属、历史导航和本地执行继续由原控制器管理。
- 类型检查、构建通过。完整 219 文件回归中 218 文件通过；PPT 个人模板界面一项保存按钮等待偶发失败，随后该套件和客户端 UI 套件重跑 2 文件 / 17 项全部通过。其余 1871 项通过、1 项跳过。
- 企业测试窗口已加载更新，实际观察云端与项目标题对齐。3006 配套网页将知识空间与文件统一为横向资源卡片，工具和深度研究回到输入框内，并修复明暗切换。已完成浅深色、弹窗、文件与空间并存和独立移除验证，外观恢复跟随系统。正式安装包和 Windows 验收另行执行。

## 2026-10-16 — 设置入口提示位置

- 基线：远端 bisheng-work/V1.2.0@859c9b33a146d9c2fea35aa6ff93de4ad141af57，工作目录 bisheng-work-chat-work，Harness 0.2.0-rc.2。
- 根因：设置提示默认向右展开，跨入原生 WebContentsView 的区域后被遮挡。沿用 Harness Tooltip，方向改为 top，让提示位于侧栏内。现有 settings.launcher slot 用于替换整个入口；此处保留原入口、快捷键、状态与无障碍逻辑，仅通过锁定依赖的可重放修正调整 Tooltip 参数。
- 验证：干净离线 npm ci 与全部依赖修正重放通过；类型检查、构建、完整 219 文件 / 1872 项测试通过、1 项跳过。企业测试桌面已启动更新版本；运行时提示浮层的视觉复验待完成，用户正在操作窗口。本次尚未生成安装包。

## 2026-10-16 — 首次发送即时收起 Chat / Work

- 基线：本次核对远端 bisheng-work/V1.2.0 为 5b14db873105d2b3d937e7512619e20e4914507f，工作目录为 bisheng-work-chat-work，开发分支 codex/chat-work-integration，已安装 Harness 0.2.0-rc.2。
- 根因：Work 读取持久化会话摘要，Chat 等待服务器返回会话 ID 后通过 1500ms 轮询更新。修复后 Work 订阅原生 Session 的乐观发送状态；Chat 用自身消息/流式状态上报 landing，再由主进程推送给桌面。当前视图、主 frame、企业来源、路径和身份代际校验覆盖远程上报。
- 验证：定向 23 项通过；完整回归 219 文件、1872 项通过、1 项跳过；类型检查和生产构建通过。真实 Electron 隔离 fixture 使用沙箱 WebContentsView，在 URL 保持 new 时完成 true/false/true 状态推送（本机测量 0–1ms）；远程页仅有 reportLanding，Node 与企业账号接口均不可见。
- 交付边界：源码与原生展示桥验证完成。本次需要桌面与网页同时更新；3006 当前 beta4 发布、正在运行的企业测试窗口及安装包尚未更新，实际企业登录后发送复验待执行。网页改动随 PR #2495 交付到 feat/bisheng-work-103。

## 2026-10-16 — 聊天侧栏统一为标题与时间

- 桌面基线：bisheng-work/V1.2.0@61dfddf7376aaa09e6a2d335dcaec245e513f578，GitHub API 实时复核，Harness 0.2.0-rc.2。移除最近标题栏的刷新按钮、云端气泡图标及本地电脑图标贡献项；自动刷新、按来源导航及项目归属继续由原控制器管理。
- 毕昇网页聊天侧栏采用 280px 宽度、32px 桌面行高、8px 行圆角与标题缩进；历史统一为按更新时间排序的最近列表，右侧显示日期，重命名时让出日期空间。保留平台导航、会话菜单及分页加载。
- 自动验证：桌面 219 文件 / 1869 项通过、1 项跳过，类型检查与构建通过；网页变更文件 ESLint、严格类型检查（1276 strict files）与生产构建通过。原有 slot 断言同步移除已退役图标贡献项。
- 发布：3006 的 chat-sidebar-clean-20261016-r1 基于 model-config-compact-20261016，436 文件哈希验证、前后端健康 200，其余容器身份保持。数据库迁移 none。
- 原生验收：桌面显示标题与时间，原生本地任务可打开；网页最近列表、尺寸、当前消息、会话菜单、重命名入口/取消及桌面尺寸收起展开已验证。640px 页面无水平溢出、行高 40px；窄屏顶部入口使用既有移动菜单，完整抽屉打开未通过本轮验证，列入后续移动端专项。当前实际主题为深色，浅色本轮未完成实测。
- 证据与协作说明：主工作区 outputs/bisheng-sidebar-clean-20261016/；Web 源码在 .worktrees/bisheng-dsh-chat-3006，桌面在 .worktrees/bisheng-work-chat-work。

## 2026-10-16 — 新建会话页专属模式选择

- 基线：bisheng-work/V1.2.0@322843d87155235c4113b1e5ec8a4b18d2255997，工作树 .worktrees/bisheng-work-chat-work，Harness 0.2.0-rc.2；本轮 GitHub API 实时复核一致。
- 产品行为：聊天／工作选择器仅在新建 Chat 与空白 Work 显示。已有云端聊天、本地任务、插件及其他全局面板收起整条选择栏。侧栏按记录来源导航；新建页选择另一模式时进入其空白会话。聊天容器跟随内容区实际高度，收起选择栏后填满顶部空间。
- 实现采用 Harness 的 sessions.list/mainView/blank 与 layout.panelInfo 公共状态；移除对固定顶部高度的依赖，补充模式可见性和容器布局回归。
- 自动验证：完整 219 文件 / 1869 项通过，1 项跳过；类型检查、桌面构建及 diff-check 通过。初次受限运行的本地端口测试受沙箱限制，已在允许本地测试服务器的环境完整重跑通过。
- 原生验证：同一企业测试窗口登录恢复；新建 Chat、新建 Work 显示选择器；已有 Chat、已有 Work、插件页收起选择器。已有消息正常呈现，云端容器顶部空隙已收起。截图位于主工作区 outputs/bisheng-mode-picker-20261016/。本轮覆盖桌面模式入口，正式安装包与 Windows 继续独立验收。

## 2026-10-16 — 企业分支研发交接

- 用户授权将桌面 Chat/Work 功能直接提交到 bisheng-work/V1.2.0，供同事继续开发。GitHub API 实时读取目标基线 dde330fb7f2ab61ef5baab214a959f3fb437c66e，与本地 HEAD 一致；Harness 0.2.0-rc.2。
- 交付范围：企业登录复用、隔离 Chat 容器、共享侧栏与项目/最近、模式和会话切换、页面保留、配套回归及开发交接文档。毕昇网页和后端由独立仓库维护，联调 3006 已具备所需接口。
- 当前代码已完成本日干净安装重放、类型检查、构建和完整 219 文件/1865 项通过（1 项跳过）；本次整理交接文档并检查提交差异。远端分支更新结果以本次交付回执为准。

## 2026-10-16 — 完整网页与桌面聊天嵌入分离

- 产品边界：3006 完整毕昇网页保留平台导航和基础功能，Chat 页面沿用 DSH 风格。桌面仅嵌入聊天内容、输入框和文件预览；导航/历史由桌面提供，Work 继续由本地 Harness 负责。
- 修复 MainLayout 以聊天路由隐藏平台导航的范围错误。平台导航及移动端系统菜单现在以桌面嵌入标识控制；普通网页的知识空间、订阅、应用、权限内管理入口恢复。移动端菜单回到平台功能菜单，聊天记录沿用对话列表入口。
- 自动验证：变更文件 ESLint、生产构建、3 文件/4 项嵌入与导航测试通过；完整 Web 类型检查沿用已有存量诊断记录，本轮未重新执行。
- 发布 chat-platform-nav-20261016-r1，以当前 model-config-parameters-20261016 为基础；先核对其 Chat 构建与 r5 一致，保留同期模型配置更新。420 文件哈希、前后端健康 200、其他容器身份保持；数据库迁移 none。
- 网页实测：完整页平台菜单可见，知识空间及应用可进入；640px 窄窗口菜单能展开平台入口。桌面嵌入页继续只呈现聊天内容。当前验证涵盖入口与页面加载，其他基础功能的业务操作沿用既有实现与验收范围。
- 证据：outputs/bisheng-chat-platform-nav-20261016；用户正在使用的桌面窗口保持当前操作。本轮更新网页显示范围，桌面程序保持上一轮构建。

## 2026-10-16 — Chat 会话布局与页面保留

- 基线实时核验：bisheng-work/V1.2.0@dde330fb7f2ab61ef5baab214a959f3fb437c66e，工作树 .worktrees/bisheng-work-chat-work，分支 codex/chat-work-integration；Harness 0.2.0-rc.2。
- 主进程保留隐藏 Chat 页面的文档、尺寸与背景；模式切换只更新可见性。打开云端记录使用获授权路径映射与页面内路由，旧版网页继续走兼容加载；身份变化时丢弃旧导航完成结果。首屏 HTML 和原生视图直接采用宿主主题背景。
- Chat 正文列补齐内边距占用的 32px，标题行、气泡、输入文字及工具栏按 Work 尺度对齐。隐藏上传控件的空容器原先产生额外 12px flex 间距，现按控件可见状态正确隐藏；工具栏使用 42px 高度。Chat 保留知识空间、工具、深度研究功能，Work 保留轨迹页签。
- 自动验证：桌面定向 16 项、完整 219 文件/1865 项通过，1 项跳过；类型检查及构建通过。完整回归首次遇 Node socket setTypeOfService EINVAL，重跑干净通过。网页定向 4 项、变更文件 lint、生产构建及两仓 diff-check 通过；完整 Web 类型检查仍有存量诊断。
- 实际验收：原生客户端打开云端记录使用同一页面，Work→Chat 返回保留未发送验收草稿。最终 r5 网页实测正文内宽 920px、输入框高 98px、输入文字距卡片顶部 12px、工具栏高 42px；Markdown 右侧预览显示 DSH-CHAT-20261015。浅色 640px 窗口文档宽 640px，输入框宽 616px，控件完整可见。
- 3006 发布 chat-work-beta4-20261016-r5，425 个文件哈希校验、前后端健康 200；其余容器保持，数据库迁移为 none。最终网页样式已验证；用户正在使用的原生窗口保留当前操作，最后一轮样式在 Chat 文档刷新后加载，尚未完成该窗口 r5 最终截图验收。
- 证据：主工作区 outputs/bisheng-chat-polish-20261016/delivery.md。当前运行企业版开发窗口；安装包、Windows、跨端即时推送与全文件格式重验各自保留既有验收边界。

## 2026-10-16 — 项目与最近统一分组、输入框对齐

- 基线实时核验：bisheng-work/V1.2.0@dde330fb7f2ab61ef5baab214a959f3fb437c66e；工作目录 .worktrees/bisheng-work-chat-work，分支 codex/chat-work-integration，Harness 0.2.0-rc.2。
- WorkspaceBrowser 使用同一滚动区呈现项目与最近。项目会话归属由原 Harness sessionIds 决定；未分组 Work 与云端 Chat 按置顶和更新时间混排，电脑/对话图标标识来源，点击记录切换右侧模式。原生项目菜单、归档过滤和搜索保留。
- 当前默认工作区是实际项目，已有会话继续在其中。云端搜索匹配已加载的标题；归档专用视图呈现具有归档状态的本地记录。最近采用更新时间排序，项目原生手动排序保持。
- Chat 首页和会话输入框采用 Work 的响应宽度、114px 首页高度及边距尺度；知识空间、工具、深度研究保留。
- 自动验证：全新 npm ci 重放、typecheck、桌面与网页构建通过；219 个测试文件、1862 项通过、1 项跳过。真实 projection 回归覆盖未分组过滤、项目成员变化、归档过滤、模式选中状态及原生 fallback。
- 原生窗口验证：企业身份自动恢复、项目/最近显示、两种模式切换、云端标题搜索及单列表混排通过；点击历史记录自动进入 Chat 并读到原消息，Markdown 附件右侧预览显示原验收标记。项目成员迁移由自动回归验证，当前真人数据均属于默认工作区。
- 3006 发布 chat-work-beta4-20261016-r3；以 model-config-dialog-20261016-r2 为基础保留同期后台更新。418 个文件哈希、前后端健康 200、其余容器 ID 保持。上次发布的前端版本变化触发保护中止，校验 client 完全相同后再继续发布。
- 证据：主工作区 outputs/bisheng-recent-sidebar-20261016。当前为企业版开发窗口；安装包与跨平台验收另行执行。本轮变更集中于会话组织与布局，文件预览能力沿用上一轮验收记录。

## 2026-10-16 — 共享原生侧栏，右侧切换 Chat / Work

- 延续 bisheng-work/V1.2.0@dde330fb7f2ab61ef5baab214a959f3fb437c66e，codex/chat-work-integration，Harness 0.2.0-rc.2。远端 SHA 重查遇 GitHub TLS 连接失败；本地 origin 引用与昨日已验证基线一致。
- 实现：原生侧栏持续挂载，云端 Chat 列表与本机 Work 工作区共存；顶部切换只改变右侧。新会话按当前模式创建，点击本地记录沿原导航打开 Work。设置弹窗打开时暂停 native view 展示，关闭后恢复。
- Chat 历史由主进程固定接口读取，分页、选中、错误重试、定时刷新；账号 generation 隔离和过期响应丢弃。消息与附件继续复用毕昇页面和权限。独立网页保留聊天导航，嵌入网页直接呈现内容。
- 3006 前端发布 chat-work-beta4-20261016-r1，417 个构建文件哈希核验，前端与后端健康 200，后端及其余容器保持。昨日 r5 保留回退。
- 验证完成：重放安装、类型检查、生产构建通过；218 个测试文件、1856 项通过、1 项跳过。首次认证 connected 状态以已取得访问凭据为准，受控回归覆盖 token 提交前的刷新状态。
- 最终构建重启自动进入 Chat；云端/本地记录切换、新会话、Work 草稿保留、侧栏折叠及设置弹窗通过。网页与桌面双向续聊通过刷新/重开验证。Markdown、PDF、DOCX、XLSX 基础预览通过；PPTX 提供下载，Excel 无缓存公式仍待支持。
- 桌面为开发窗口验收；跨账号真实切换、跨端消息即时推送、Windows 和安装包验收待专项执行。
- 证据：主工作区 outputs/bisheng-shared-sidebar-20261016。此条替代昨日整页切换的侧栏设计。

## 2026-10-15 — Chat 侧栏收敛为 DSH 风格聊天历史

- Chat / 深度研究路由仅呈现聊天历史；平台导航在布局层停止挂载。历史栏沿用 DSH 的 280px 宽度、38px 居中新会话按钮、紧凑圆角行、选中底色和顶部折叠入口。窄屏菜单直接展开聊天历史。企业账号继续使用客户端既有设置入口。
- 3006 前端发布 chat-work-beta4-20261015-r5，上一版 r4 可回退。427 个源码/构建文件哈希验证通过，前后端健康 200，其他容器 ID 保持。
- 定向 ESLint、生产构建和 diff-check 通过；ESLint 工具清理已消除的抑制项。完整 TypeScript 检查仍有项目存量问题；本次修改的导航/布局文件没有诊断，Convo 的五项类型诊断与此前基线一致。
- 原生企业客户端复用原账号目录启动，自动进入新版 Chat；历史会话与 Markdown 预览实测通过。网页新会话、历史切换、侧栏收起/展开及 390px 窄屏菜单通过。现有聊天数据保留。
- 证据：主工作区 outputs/bisheng-chat-sidebar-20261015/desktop-chat-sidebar.png、deployment.json、build.log。当前代码位于 codex/dsh-chat-3006，PR 尚未创建。

## 2026-10-15 — 企业账号登录后真实验收

- 用户完成现有企业账号授权后，Chat 直接加载同一账号的毕昇会话；服务重启后重连复用企业身份，持续使用超过 20 分钟保持认证。
- 桌面发送、网页续聊、桌面重新打开会话均通过。网页上传五类附件后桌面可见；桌面上传 Markdown 后网页刷新可见附件与 NATIVE-UPLOAD-OK。同步通过刷新/重开验证，即时推送待验证。
- Markdown、PDF、DOCX、XLSX 基础内容在两端可预览。Markdown 全屏、退出全屏及模式切换后预览保留通过。PPTX 提供下载；原生下载与 fixture SHA-256 一致。
- Work 使用企业 qwen-max 完成计数验收：运行中切换 Chat，返回显示 WORK-SWITCH-OK；Chat 会话和预览保持。默认 DeepSeek 直连模型缺少密钥，验收会话已改用企业模型。
- 根因修复：历史知识空间 auth_type=review 与 beta4 隐式枚举不兼容，导致知识空间接口 500。显式字符串存储兼容历史值并统一写入 review，保留审批权限语义；未知值继续拒绝。2 项存储回归和 8 项会话回归通过；模型 Ruff 存量诊断数量和类型保持一致。
- 3006 当前发布 chat-work-beta4-20261015-r4，后端/前端健康 200，数据库仍为 beta4_merge_3006_history，r3 保留回退。客户端基线 bisheng-work/V1.2.0@dde330fb7f2ab61ef5baab214a959f3fb437c66e，Harness 0.2.0-rc.2。
- 当前能力缺口：PPT 在线预览、qwen 应用图片上传、Excel 无缓存公式计算。PDF 工具栏和网页导航等视觉细节仍待对齐。普通用户/跨租户切换、真实退出撤销、主题切换、Windows、浏览器下载待专项验收。代码在工作分支，PR 尚未创建。
- 证据：主工作区 outputs/bisheng-chat-work-enterprise-20261015/delivery.md、desktop-authenticated-acceptance.png、work-switch-completed.png、download-verification.json。本条更新此前等待企业认证的状态。

## 2026-10-15 — Unified enterprise login entry

- Login uses the existing Settings → Enterprise account section. Unauthenticated startup renders the Work shell; selecting Chat opens that same settings section. A restored enterprise session or successful sign-in selects Chat. Account refresh preserves the selected mode; sign-out returns to Work. The Work component remains mounted throughout.
- Removed the separate Chat login landing and its central account button.
- Verification: 10 targeted tests passed across desktop mode behavior, slot registration and native Chat view lifecycle. The existing native development window was reloaded: startup showed Work, and selecting Chat opened Enterprise account settings. Screenshot: root `outputs/bisheng-chat-work-enterprise-20261015/unified-enterprise-entry.png`.
- Baseline remains V1.2.0 at `dde330fb7f2ab61ef5baab214a959f3fb437c66e`, Harness `0.2.0-rc.2`. Remote SHA refresh hit a GitHub TLS connection failure; the previously verified baseline and local origin reference match.
- Authenticated conversation sync and file preview acceptance remain pending enterprise authentication.

## 2026-10-15 — Enterprise Chat / Work integration

- Baseline verified: `dataelement/bisheng-work`, `V1.2.0@dde330fb7f2ab61ef5baab214a959f3fb437c66e`; feature branch `codex/chat-work-integration`; installed Harness `0.2.0-rc.2`; package `1.0.1`.
- Implemented: root Chat / Work tabs; Work stays mounted; Chat uses a separate in-memory WebContentsView with host-only enterprise cookie exchange, tenant/account cleanup, refresh, narrow validated IPC and remote renderer isolation. Enterprise account navigation now reaches the registered settings section, and successful first authentication selects Chat.
- Automated: full `npm test` 217 files / 1849 passed / 1 skipped; typecheck and production build passed. Fresh temporary-directory `npm ci` applied all patches. Targeted host handoff includes one 401 refresh, credential exclusion from public state, logout and stale completion rejection.
- Platform: BISHENG beta4 candidate `chat-work-beta4-20261015-r3` deployed to 3006; health and frontend 200, unauthenticated exchange 401 with no-store. Backend 29 session/middleware tests passed. Markdown dark preview and native appearance event are deployed.
- Native observation: Work draft survives a Chat / Work round trip; top tabs and enterprise-account navigation work in an isolated developer profile. Initial enterprise authorization is awaiting the user's HTTP trust confirmation and credentials. Authenticated session sync, uploads, previews, account switching, and active Work task continuation remain pending real acceptance.
- Details: [integration plan](chat-work-integration.zh.md); root output `outputs/bisheng-chat-work-enterprise-20261015/`. Existing production profiles remain separate.

## Enterprise account label — 2026-09-22

- The identity label now reads “当前账号 / Current account”, matching the existing display-name, username, and ID fallback order.
- PR #527 review follow-up; account selection and authentication behavior stay as implemented. Full regression: 149 files / 1,249 tests PASS; diff-check PASS. New package: NOT_RUN.

## Enterprise account layout — 2026-09-22

- Based on `V0.9.2@dfeb83b31b9755aeccd119cc3c813d67ecd2f7dc`, with installed Harness `0.1.5-rc.2`.
- The account row groups a fixed account icon, identity and sign-out action. The enterprise website link sits beside the page title; refresh stays beside the model section heading.
- Model rows use spacing to separate entries. Provider and vision metadata sit below model names; green indicators identify models with available routing and quota. Provider extraction preserves model paths such as `kimi/kimi-k3`. Existing quota values and hover percentages remain available.
- Verification on the updated baseline: offline `npm ci` and root postinstall, typecheck, production build, 149 test files / 1,249 tests and diff-check passed. Actual React component checks with fixture APIs covered light/dark themes, narrow layouts, refresh, website and sign-out actions.
- The r4 macOS ARM64 development package was built and signature/archive-verified on the earlier `294e9290` baseline. A new package and authenticated enterprise end-to-end acceptance on `dfeb83b3`: `NOT_RUN`.

# Model switch display names

## 2026-09-22 — Signed test-build compatibility

- PR #519 acceptance plugin fixture now declares `desktop_min: "0.9.1"`. Catalog and installation regression checks use Desktop `0.9.2-test.1`, and the physical isolated Profile Loader smoke uses that same prerelease version for installation and failed-update rollback.
- Standard SemVer comparison remains in effect: `0.9.2-test.1` satisfies `0.9.1` and falls below `0.9.2`. Packaging guidance records the minimum for this feature's acceptance plugins. This change updates repository fixtures and guidance; deployed enterprise catalog artifacts are unchanged.
- Verification: full `npm test` PASS (149 files / 1,247 tests, 30.67s), `npm run typecheck`, `npm run build`, `git diff --check` PASS. Existing real-enterprise/native acceptance limitations remain.

## 2026-09-22 — PR #519 review corrections

- Market compatibility now receives Electron `app.getVersion()` through the authenticated enterprise Broker; catalog UI and install enforce the same SemVer verdict. Missing/invalid versions fail compatibility checks.
- Signing keys are persisted on first use and held across sync/restart; a changed advertised key blocks online installation. Administrator-provided `DSH_DESKTOP_MARKET_PUBLIC_KEY` supplies an independent pin. Default TOFU trust starts at the confirmed enterprise service; see the documented trust boundary.
- Stop and expiry invalidate in-flight/queued operations immediately and serialize document/Loader cleanup with installation. Catalog traversal is bounded to 100 pages and validates totals. Enterprise runtime dependencies are explicitly declared.
- Baseline remains `upstream/V0.9.2@294e9290262dd68f402fa526cfb6aeacd571f627`; Harness `0.1.5-rc.2`. Fresh `npm ci` / repository postinstall, `npm run typecheck`, `npm run build`, and `git diff --check`: PASS. Full `npm test`: 149 files / 1,247 tests PASS (30.83s). npm reports skipped dependency lifecycle scripts under the local npm policy; repository postinstall completed.
- A physical dependency closure outside the repository passes child-process import, real Loader installation, disable/enable, failed-update rollback and stop tests. This uses locally signed test fixtures, not a production enterprise service.
- Real Harness startup using bundled Node `24.9.0`, fresh DSH_HOME, fresh launch directory and the production patch configuration: PASS on `darwin-arm64`; authenticated `/api/enterprise.market.state` responds successfully. Electron Broker is absent in this headless probe, so desktop version is empty and enterprise is disconnected.
- Real enterprise login/install, current distributable/native UI, Windows native path/file-lock/generation acceptance: `NOT_RUN` (no acceptance environment). Windows invalid-path validation tests ran on macOS. PR remains pending these acceptance gates. Old generation-directory reclamation is follow-up work.

## 2026-09-22 — Enterprise plugin market on V0.9.2

- Baseline: remote `upstream/V0.9.2@294e9290262dd68f402fa526cfb6aeacd571f627`; worktree `.worktrees/dsh-desktop-v092-enterprise-market`, branch `codex/v092-enterprise-plugin-market`; installed Harness `0.1.5-rc.2`.
- Added the authenticated “From enterprise / 来自企业” plugins tab with catalog pagination, install/update, enable/disable and uninstall actions. Locale registration follows the current product language.
- Added the main-process market Broker boundary with restricted endpoints, account binding, bounded downloads and one 401 refresh retry. Enterprise credentials remain in Electron main.
- Ported signed policy enforcement, offline artifact validation, generation isolation, real Cordis Loader activation, update rollback and the offline bundle packaging tool from the local enterprise trial.
- Verification: `npm ci` and postinstall completed; `npm run typecheck`, `npm run build`, `git diff --check` passed; full `npm test`: 149 files / 1,240 tests passed. Behavioral coverage includes account changes, late UI responses, per-plugin actions, English localization, Broker requests, signed leases, real Loader and rollback.
- Current-branch native UI, real enterprise backend login/plugin installation, new distributable package and Windows native acceptance: `NOT_RUN`. The previously demonstrated r2 trial package remains a separate artifact.
- Feature and backend requirements: [enterprise-plugin-market.zh.md](enterprise-plugin-market.zh.md).


2026-09-20: implemented and verified with focused automated checks.

- Baseline: `dataelement/dsh-desktop:V0.9.1` at `9b2d2cf17e8f25f3c3cc1af297a25760cb0731f0`, Harness `0.1.5-rc.2`. The remote `v0.9.0` branch was absent when verified.
- The model-switch producer resolves adapter model names and commits them into the notice content and summary. Request configuration continues to use provider/model IDs. Saved notices retain the names recorded at the switch.
- The conversation row shows “已切换模型” / “Model changed” and the saved name transition. Its expanded explanation uses the selected UI language. Other context producers retain their existing rendering.
- Cross-provider switches use provider display names. Equal labels include route IDs for disambiguation. Missing metadata falls back to stable route IDs so an unavailable old catalog entry can still lead to a usable new model. Existing notices retain their saved summaries.
- The runtime correction is shipped through the repository's pinned Harness dependency distribution in `patches/`, updating both the package entry and standalone module. The chat bundle contains the corresponding localized renderer.

Verification:

- `npm ci --ignore-scripts --offline --no-audit --no-fund` followed by `npx --no-install patch-package`: PASS from a fresh dependency tree.
- `npx vitest run test/model-switch-display.test.ts test/model-selection-search-patch.test.ts test/model-reasoning-efforts-patch.test.ts test/local-path-links.test.ts`: 29 tests passed, including 8 new runtime/browser-bundle cases.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Native Desktop login, real provider calls, and installed-app UI acceptance: `NOT_RUN`.

- 3006 backend is now `feat/3.0.0-beta4@db2381113` with deployed migration head `beta4_merge_3006_history`; API healthy and r4 frontend retained. Beta4 renewed the JWT signing secret; web-session handoff from enterprise identity remains to be implemented.
