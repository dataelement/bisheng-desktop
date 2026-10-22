## 2026-10-22 — Work 使用毕昇企业技能

- 基线：`dataelement/bisheng-work:V1.2.0@b8bfd4e`，Harness `0.2.0-rc.2`；独立工作树 `bisheng-work-enterprise-skills`。
- 企业插件通过宿主认证代理读取当前租户已启用的技能目录与版本化完整技能包，注册到 Harness 公共 Skill provider。Work 在本地运行；平台 Chat 任务继续在服务器运行。
- 企业技能按服务地址、租户、用户及记录 ID 隔离，版本缓存校验完整内容与二进制资产；每次使用重新验证目录权限。账号变化使在途操作失效。企业凭据保留在主进程。
- 加号菜单合并本地、插件和企业技能。仅平台下发的技能标注“来自 BISHENG”；本地和插件技能展示原有名称与描述。同名技能保留各自身份。选择使用原生行内引用及编辑器删除/撤销，发送前验证企业技能。
- 权限沿用平台 Chat 的当前规则：已登录用户可使用所在租户启用的技能。细粒度逐技能用户授权仍由平台后续治理能力定义。技能提供指令与资产，执行继续通过 Work 已有工具和审批策略。
- 自动化：237 文件，2035 项通过、1 项跳过；类型检查和构建通过；真实 Harness SkillRegistry 测试覆盖本地/企业同名共存、完整内容加载；覆盖禁用撤销、版本变化、账户切换及包路径校验。
- 3006 后端接口已部署，健康检查通过。本地开发应用已启动，原登录与会话保留；实际 Work 菜单已显示企业 Office 技能和本地技能。完整企业 Office 文件产出仍由用户验收；列表展示与自动化加载验证分别记录。
- 本次本地应用采用 macOS ad-hoc 开发签名。发布安装包签名与跨平台验收单独执行。

## 2026-10-22 — 最新账号与用量整合体验包

- 已核对并快进到 `dataelement/bisheng-work:V1.2.0@b8bfd4e98504d00fa1dfd82186c047a009939c3a`，包含同事的账号信息、企业模型、积分与用量整合，以及此前的 Chat 背景、文件主题和知识空间修复。本地实现与远端一致。
- 工作树为 `bisheng-work-v120-credits`，Harness `0.2.0-rc.2`，Electron `43.0.0`。构建及包内 Office 检查通过，已生成 macOS arm64 开发 DMG/ZIP，产物目录 `outputs/bisheng-dev-3006-account-20261022`（主工作区）。
- 桌面连接 3006，Chat 字体更新由网页端加载；应用重新打开供用户手动验收账号、模型及用量页面。

## 2026-10-22 — 用户可选模型显示名称联动

- 交付方式按用户确认调整为直接合入 `V1.2.0`；推送前核对远端基线为 `f97e158`，Harness 为 `0.2.0-rc.2`。

- 初始基线 `V1.2.0@e4a27e0`，交付前合入最新 `f97e158`，Harness `0.2.0-rc.2`。桌面现有适配器使用后台 `display_name` 展示，目录刷新包含名称变化并更新版本；模型调用 ID 保持稳定。
- 新增回归覆盖管理员修改名称后“服务提供方 / 显示名称”的透传、目录刷新和适配器解析，相关 3 文件 / 65 项测试通过。本次桌面代码为回归测试，运行时沿用现有逻辑。
- 后台配套已发布 3006。实际 BISHENG Dev 的账号模型目录和 Work 选择器均验证新显示名称及服务提供方；测试后恢复原名称并再次刷新确认。合入 f97e158 后的 53 项相关回归及类型检查通过。

## 2026-10-22 — Chat 页面底色层级修正

- 根据用户手动验收反馈，Chat 页面背景被宿主面板色覆盖，导致输入框与页面失去层级。将布局内的整套面板配色限定在模块页面，Chat 使用自身页面底色与已采样的输入框颜色；根节点继续为门户控件提供主题色。
- 文档画布、文件预览和菜单深色修复继续保留。`9163c20` 已推送 `V1.2.0`；类型检查及 28 项相关回归通过，DMG/ZIP 已重新构建，桌面端已打开，由用户手动验收。

## 2026-10-22 — 企业 Chat 文件预览深色模式

- 基线：`dataelement/bisheng-work:V1.2.0@ccd9a09`，工作树 `bisheng-work-v120-credits`，安装的 Harness `0.2.0-rc.2`，Electron `43.0.0`。本轮拉取远端后与本地基线一致。
- 宿主深色转换遵循 `data-document-canvas` 内容边界，覆盖普通/交互色彩、行内色彩、表头、代码高亮和 iframe。文档内容使用自身配色，外围界面使用宿主主题。
- 宿主配色传递到 Chat 根节点及门户菜单/弹窗，补齐背景、文字、填充、灰色按钮、禁用控件和 popover 色彩。
- 类型检查通过；主题与企业 Chat 相关回归 28 项通过。源码 `e4a27e0` 已推送 `V1.2.0`，配套 BISHENG `b3fbbd166` 已发布到 3006。使用本机 Electron 43.0.0 生成 macOS arm64 DMG/ZIP，Office 打包检查通过，桌面端已打开，由用户手动验收。

## 2026-10-22 — Work 知识空间弹窗与 Chat 对齐

- 基线：`origin/V1.2.0@2867a36`，工作区 `bisheng-work-v120-credits` / `codex/v120-unified-credits`，Harness `0.2.0-rc.2`；包含同事最新企业模型卡片更新。
- Work 使用宿主 Modal 的焦点、Esc、遮罩退出能力，按 Chat 的设计统一标题、搜索、分组、复选框、书本图标、修改时间、计数和按钮。列表固定为 `min(440px, 48vh)`，加载及搜索结果变化时保持高度。平台目录透传真实 `update_time`，原生引用与发送前权限校验沿用现有链路。
- 自动检查：初版相关 40 项测试、类型检查、构建与打包 Office 检查通过；本轮 `6a90646` 合入最新代码后构建、DMG/ZIP 打包及包内 Office 检查通过；已推送 `dataelement/bisheng-work:V1.2.0` 并打开 `dist-dev/mac-arm64/BISHENG Dev.app`。产物位于主工作区 `outputs/bisheng-dev-3006-knowledge-20261022`。按照用户要求，界面交互由用户在本地包手动验收。

## 2026-10-22 — 3006 联合验收桌面包

- 基线：远端 `V1.2.0` 与本地 `b510182576c29cb0c48d8b48a943a6f77d0c491d` 一致，Harness `0.2.0-rc.2`。使用 `package:dev:mac:arm64` 生成本地 BISHENG Dev DMG。
- 构建及打包内 Office 检查通过；新包已真实启动，加载 `127.0.0.1:43230`，企业 Chat 已连接 `192.168.106.119:3006` 并恢复现有草稿。
- 3006 同时包含 Chat 输入提示修复与 `cb4b18018` 消息操作按钮更新；用户继续验收。产物为本地开发签名测试包，macOS 公证跳过。

## 2026-10-22 — 统一积分与原生登录迁移到 V1.2.0

- 基线：`origin/V1.2.0@a1ce7bf83c1d3f98dda0802f197e906669de167f`；独立分支 `codex/v120-unified-credits`；安装依赖 Harness `0.2.0-rc.2`。
- 本地积分分支 `d9a2cc0` 的功能已移入：Chat/Work 共用个人余额、余额在账号与安全显示、一位小数、企业模型紧凑排列、独立环境 cookie 名称。同步 V1.1.0 已发布的原生授权/换证/退出接口、模型撤权后恢复选择和可读模型名称。
- 保留 V1.2.0 的知识空间内联引用与发送前权限检查；合并同版本 conversation/model-selection/chat 补丁。新增模型目录恢复在模型真正可用且选中后才继续发送，历史用量采用目录公布的显示名称。所有补丁仍对应 Harness `0.2.0-rc.2`，上游提供相同行为后迁回正式接口。
- 自动验证：完整测试 233 文件，2011 通过、1 跳过；类型检查、构建、patch-package 重放通过。测试包含原生登录 mock HTTP、共享余额、知识空间引用、模型撤权恢复和历史用量名称。
- 交付边界：本次迁移源码并建立评审入口；3006/3007 部署和已安装客户端保持现状。真实原生登录、Chat/Work 扣分、模型撤权与知识检索留待目标后端部署后整体联调。

## 2026-10-22 — Work 知识库使用原生内联引用

- 基线：`bisheng-work-chat-work` / `codex/chat-work-integration`，整合 `origin/V1.2.0@adaa781`，Harness / conversation `0.2.0-rc.2`；远端 `dsh-desktop` 的 `v0.9.0` 标签为 `7a9ed7f94257ff82daf76f2ec5e9defe16bb8661`。延续企业集成工作区与原 `bisheng-dev` Profile。
- 知识空间选择直接调用原生 `insertReference`，以蓝色 `@名称` 和正文共用编辑器。引用通过稳定空间 ID 关联检索范围，点击保持当前输入位置，原生退格、选区删除与撤销直接更新选择。移除输入区左侧独立知识空间标签，选择弹窗读取编辑器当前引用。
- 在原生提交边界增加 `conversation/input-before-submit` 串行事件，传入提交快照中的引用及取消信号；企业插件在模型发送前校验权限并提交知识库 ID。发送清空草稿后，当前任务保留其检索范围；后续发送依据新消息中的引用更新范围。前置校验失败交回原生草稿恢复逻辑。该窄事件扩展记录在 conversation `0.2.0-rc.2` patch 中；上游提供等价提交前引用钩子后迁移到正式接口并删除此扩展。
- 自动验证：3 文件 / 22 项通过，覆盖正文与文件引用保留、多引用删除坐标、同名空间 ID、去重、退格与撤销状态、发送清空、下轮取消范围、权限失败、命令态，以及原生提交前事件的顺序、附件单独发送和取消处理；typecheck、build、diff-check 通过。独立临时项目对官方同版本组件执行全新 npm ci，postinstall 重放成功，三项修改文件与运行目录逐字节一致。
- 实机验证：本地开发版中两项知识库显示为蓝色内联文字；点击保持当前页面，退格删除、撤销及重新打开选择弹窗的勾选状态一致；真实提交完成且输入框引用清空。此次模型仅进行输入引用确认，知识检索内容质量沿用独立验收。当前交付为本地开发实例，源码发布目标为共享分支 `V1.2.0`；安装包沿用原产物。

- 提交前完整回归：229 个测试文件、1964 项通过、1 项跳过；日志位于本机 `/tmp/work-knowledge-full-test.log`。

## 2026-10-21 — 原生输入菜单保持悬停前的滚动位置

- 基线：bisheng-work-chat-work / codex/chat-work-integration，源码与核验时远端 V1.2.0 均为 887bc825a91c72ec506139784f7f4df8b9db65db；Harness 与 input-trigger 0.2.0-rc.2，Electron 43 / macOS arm64。dsh-desktop/v0.9.0 远端查询无匹配引用，v090 integration 工作目录干净；本轮延续现有企业集成环境。
- 根因：输入菜单对每次高亮变化执行 scrollIntoView，鼠标经过半露出的底部行时触发自动滚动，顶部标题随之被裁切。reducer 现在记录鼠标与键盘来源；鼠标高亮保持滚动位置，键盘导航仅调整当前列表 viewport.scrollTop。菜单原有高度、锚点与渐隐样式继续使用原生实现。
- 验证：npm ci 完整重放依赖修正成功，typecheck、build、完整测试与 diff-check 通过；228 个测试文件、1954 项通过、1 项跳过。新增 4 项行为回归覆盖悬停底部行、手动滚动后的悬停与异步刷新、键盘循环导航和鼠标切回键盘，检查祖先滚动位置保持。
- 原 Profile 本地开发版已重新启动；实机鼠标经过底部知识空间行后，高亮更新，顶部“添加”、菜单边界与输入框位置保持。证据：主工作区 outputs/menu-hover-scroll-20261021 的 open.png、pointer-bottom.png、verified-menu.png 与验证日志。当前交付为开发实例；安装包保持原产物。

## 2026-10-20 — 恢复正确的桌面开发实例

- 本轮发现当前进程来自用户 Applications/BISHENG Dev.app，该安装版对应 10-19 的交付；其 app.asar 缺少 dsh-desktop-enterprise/work-resources.js，企业客户端 SHA256 为 3c49a877438ac0c0a2c113762bda0f0d4276867872a6262bb76d14a0a6be7caa。今天的开发源码已包含 Work 资源菜单与新版账号入口。远程 Chat 页面继续更新时，旧宿主会形成新网页与旧原生界面的组合。
- 已正常退出旧安装版，并从 bisheng-work-chat-work 启动 npm run dev，沿用 bisheng-dev Profile。选定源码与远端 V1.2.0 均为 887bc825a91c72ec506139784f7f4df8b9db65db，Harness 0.2.0-rc.2；远端 dsh-desktop/v0.9.0 查询无匹配引用，既有 v090 integration 工作目录干净。
- 实机确认 Chat 加载 3006；Work 加号恢复技能与知识空间，技能二级列表可加载，原生菜单底部轻量渐隐可见，账号入口恢复。仅恢复运行实例；安装包仍为原产物，模型执行与新安装包验收独立进行。
- 证据：主工作区 outputs/desktop-package-recovery-20261020/work-menu.png 与 dev.log。后续本轮界面迭代继续使用该开发实例。

## 2026-10-20 — 账号入口运行态恢复与 Chat 会话内技能验收

- 已核对远端 V1.2.0@232d860、本工作目录与 Harness 0.2.0-rc.2；共享分支已是最新版本。运行页面的账号按钮存在，但账号样式表数量为 0，computed display 为 block，呈现为原始按钮。完整退出开发实例并以原 Profile 启动后，头像、账号文字与展开图标恢复原生布局。样式丢失的具体触发条件仍待独立复现；本轮沿用同事的设置与字号实现。
- 3006 配套 c39c3dbb3 补齐已有 Chat 会话的技能入口，并把旧输入菜单接到可执行选择状态。桌面嵌入页刷新旧 SPA 后，会话内技能入口可见；当前首页技能卡实际挂载可见。网页已有会话选择后保持原地址，模型执行本轮另行验收。
- 当前使用本地开发版，安装包保持原产物。证据：主工作区 outputs/chat-skill-account-20261020。

## 2026-10-20 — Chat 输入框复用原生主题表面

- 基线 bisheng-work/V1.2.0@20e633c，Harness 0.2.0-rc.2。主窗口采样原生 dsw-specific-input-major，经窄呈现协议校验三通道颜色，向嵌入 Chat 的 dsh-composer-bg 提供当前原生输入框底色。旧呈现方仍可传原有调色板；字段缺省沿用网页默认主题。
- 修复输入框表面归属：网页移除通用 bg-white 背景类，主题变量直接决定输入框底色；页面和设置卡片继续使用各自调色板。
- typecheck、build、30 项定向测试通过，覆盖主题底色采样、CSS 传递、缺省兼容及非法颜色拒绝。3006 已发布网页配套 8e5e22a05，461 文件校验及健康检查通过。原 Profile 的本地开发版实测 Chat / Work 深色输入框多点颜色均为 RGB(44,44,46)；恢复原浅色设置，既有 Work 草稿保留。网页和桌面技能挂载、移除与原路由保持通过，模型执行本轮另行验收。证据：主工作区 outputs/skill-mount-dark-20261020；安装包本轮保持原产物。

## 2026-10-20 — 欢迎语保持静态呈现

- 按用户最新反馈移除欢迎语上下滑动：Work 标题直接显示，Chat 宿主呈现协议回归可见性、尺寸和主题字段，网页直接显示欢迎标题。共享欢迎语与 Logo 配置、既有输入框布局和 Work 控件行展开保持。
- 已整合远端 bisheng-work/V1.2.0@15a65b43831e601751d0697a78f19059d6aacf2b 的账号菜单、设置页与主题更新；冲突按保留新配置字段并删除 welcomeMotion 的逻辑解决。远端 dsh-desktop/v0.9.0 无匹配引用；Harness 0.2.0-rc.2。
- npm ci 重放当前补丁后，typecheck、build、7 文件 / 83 项定向测试和 diff-check 通过。依赖刷新前设置图标用例失败，刷新后通过。沿用原 Profile 启动本地开发版，Chat / Work 双向切换后欢迎语和控件显示正常；安装包本轮保持原产物。
- 3006 前端已发布 2c78fbfcf，460 文件哈希与健康检查通过，其他容器保持。证据：主工作区 outputs/welcome-static-20261020。

## 2026-10-20 — 欢迎语模式切换动效

- 在既有欢迎区位置与字号上增加 6px / 180ms 文字过渡：鼠标进入 Work 时向上滑入，返回 Chat 时向下滑入，Logo 保持稳定。键盘和 reduced-motion 保持即时呈现。
- Work 使用宿主自有标题标记与样式；Chat 由宿主在可见性切入边沿发出只含呈现意图的事件，网页标题自行播放并在重入或卸载时取消旧动画。尺寸、主题刷新沿用稳定显示。
- 基线为 bisheng-work/V1.2.0@4360c67，Harness 0.2.0-rc.2。定向 23 项、typecheck、build 通过；完整回归 226 文件 / 1937 项通过、1 项跳过，另 1 项运行时用例因 43129 端口占用失败，单独重跑通过。原开发 Profile 重新启动，鼠标与键盘双向切换后标题和控件位置正常；静态截图未捕获 180ms 中间帧。3006 已发布 d59254119，460 文件校验、健康检查通过，其他容器保持。证据：主工作区 outputs/welcome-title-motion-20261020；安装包与跨平台本轮单独验收。

## 2026-10-20 — 工作台统一欢迎区与模式过渡

- 基线核验：远端 bisheng-work/V1.2.0@e05766a；本工作目录 bisheng-work-chat-work 已整合同事设置与手机语言更新，延续共享集成分支。dsh-desktop/v0.9.0 远端无匹配引用；Harness、conversation 与 model-selection UI 均为 0.2.0-rc.2。
- Chat 上报构建→工作台既有欢迎语与图标设置，宿主只校验并透传公开呈现字段；Work 的原生欢迎区读取同一份配置，保留图标显示开关和自定义资源，后台继续统一管理。当前图片保持配置，由用户上传；默认欢迎语为“来一起创造”。Work 标题贡献项统一欢迎区并替代企业版徽标。
- 鼠标切入 Work 时，原生控件行以 180ms 从左向右展开；过渡结束清理裁切，键盘切换及系统减少动态效果偏好即时呈现。主内容、标题与输入框尺寸保持。
- 自动验证：整合同事 e05766a 后，npm ci、typecheck、build、完整 227 文件 / 1937 项通过、1 项跳过；官方干净包补丁重放及产物逐字节一致通过。初次受限环境完整回归因本机端口 EPERM 失败，允许回环端口后完整回归通过。原开发 Profile 实际重启，Chat 与 Work 显示相同现有图标和“来一起创造”，欢迎区位置一致；鼠标与键盘切换后控件完整可用。180ms 过渡实现已加载，截图采样未捕获中间帧。3006 发布 374bba73e、460 文件校验及健康检查通过，其它容器保持。证据：主工作区 outputs/welcome-branding-20261020。安装包与 Windows 本轮单独验收。

## 2026-10-20 — 手机配对页跟随当前桌面语言

- 根因：主进程仍从已退役的 `harness/settings.yaml` 读取语言；当前 Harness 将语言偏好放在 Profile 配置中，主界面中文时手机桥仍可能回退到系统英文。配对 HTML 原先也只在首次打开时固定文案。
- 接入 Harness 0.2.0-rc.2 已有的 `__DSH_LOCALE__` 原生桥。configForms 继续拥有持久偏好；preload 上报已解析的活动语言，主进程校验可信主窗口、主 frame 与 zh/en 后保留内存状态，手机桥和原生菜单采用该值。无需新补丁或额外偏好文件。补齐手机服务启动提示的中英文。
- 已打开的配对页通过原有已认证状态轮询检测语言变化并刷新 HTML，模式切换期间延后；保持已有配对链接、隧道与 PIN 状态。回归覆盖语言双向切换、非法值、未授权调用、传输失败和刷新延迟。
- 验证：typecheck、build、完整 npm test 与 diff-check 通过；226 文件、1931 项通过、1 项跳过。正常退出旧开发应用后使用原 userData 启动修复版本，实际原生菜单显示“连接手机…”，配对窗口的标题、WiFi/互联网按钮、说明及复制按钮均显示中文；未扫描二维码或切换互联网模式。实时双向刷新完成行为测试，未在用户窗口中切换语言。Windows 和正式安装包本轮未验收。

## 2026-10-20 — 深度研究（灵思）面板的内联样式深色覆盖

- 聊天里的灵思任务模式用组件内联 `style`（`execTokens.ts` 的 INK `#1D2129` / BODY `#5C5C5C` / MUTED `#8A8A8A` / FAINT `#BFBFBF`、NarrationTicker `#999999`，结果卡片与澄清卡片的白底加 `%23EAEEFF` 点阵纹理），类规则覆盖不到：深色下结果卡白底白字、步骤图标与“任务已完成”条几乎不可见。
- `chat-module-theme.ts` 新增 `INLINE_STYLE_COLORS`：按序列化后的 `style` 属性匹配（`[style^="color: rgb(…)"]` 与 `[style*="; color: rgb(…)"]` 两种形式，避免 `color:` 误配 `background-color:`），用同一套明度推导换成 token 并加 `!important`；点阵纹理换成深色点。近白色（`#fafbfc`）的 HSL 饱和度失真，中性判定补充色度阈值，`≥0.98` 明度归入 bg-page。
- 变体类：`hover:bg-[#f7f7f7]`、`has-[[data-state=open]]:…`、`fine-pointer:hover:`、`group-hover:`、`data-[state=open]:`、`focus:`、`active:` 是独立类名，之前只覆盖了基础类，结果卡文件行 hover 仍是白底。生成器改为每条声明一条规则：基础类放进 `:is()` 列表，每个变体按自身选择器形状包裹（`:is(…):hover`、`.group:hover :is(…)`、`:is(…)[data-state=open]`、`:is(…):has([data-state=open])`），`:is()` 保持类选择器特异性，仍压过 Tailwind 的 `.hover\:x:hover`；样式体积约 67KB。深色阶梯里页面底与 arco-gray-1 只差几个值，交互态按 1:1 映射看不出来，所以 hover/active/open 变体的底色比静态替换再抬一级（`liftSurface`：bg-page→gray-1→gray-2→gray-3→gray-4）。
- 聊天代码块：容器 `bg-[#F6F8FA]` 已转深，但网页只带 highlight.js 的 GitHub light 调色（`style.css` `.hljs-*`），token 在深底上几乎不可见；宿主补一组 GitHub Dark 配色（`HLJS_DARK`，分组与浅色调色一一对应）。
- 验证：定向测试 23 项、typecheck 通过；Chrome 注入复验两条灵思会话（交付物卡片、待办/执行步骤、任务完成条）均可读；另补 `bg-white/40|80|95`（回到底部按钮）。重启开发应用实机确认两条会话的结果卡片、步骤图标与任务完成条均为深色可读。全量 `npx vitest run` 与 `git diff --check` 结果见提交说明；Windows 与安装包未验证。

## 2026-10-20 — 深色模式全页走查与补齐

- 走查方式：桌面窗口在后台时 Chromium 不重绘且侧栏菜单的 AXPress 不触发，改在 Chrome 打开 3006 的 `?embed=dsh&dshTheme=dark` 页面并注入与宿主相同的 `MODULE_THEME_CSS` / `moduleThemeScript`，用脚本扫描视口内浅色底、浅色边框与低对比文字，再回到桌面应用复验。
- 发现并修复（`src/main/enterprise/chat-module-theme.ts`）：知识空间首页文件夹磁贴白字压在浅色 SVG 上（对 SVG 反色）；知识广场卡片写死 `#FFF` 的任意值渐变底白字不可读（类名子串匹配替换为 token 渐变）；订阅文章阅读区 srcdoc iframe 保持白底（注入 `FRAME_DARK_CSS` 整页反色、媒体复原，随 iframe 重载重新注入）；聊天路由的参考来源面板 `bg-[#FBFBFB]` / `bg-white`、引用标签 `bg-[#F7F7F7]`、来源头像 `bg-[#F4F5F8]` 白底白字——工具类覆盖作用域从模块页扩大到所有宿主深色路由（新增 `html.dsh-host-dark`，`dsh-module-dark` 仍只用于宿主接管 `html.dark` 的模块页），并补 `border-white`；知识空间详情提问栏底部的 `bg-gradient-to-b from-white/0 to-white` 蒙版在深底上发白，新增 Tailwind 3 渐变停色工具类（`from/via/to-white` 及灰阶、含透明度修饰）的 token 替换，`from-*` 同样重置透明的 `to` 端。
- 已核对为正常：知识空间详情/文件夹/文件列表、新增下拉、订阅首页与频道详情、技能中心、聊天落地页、`+` 菜单与对话正文。`/workspace/apps` 在 3006 当前构建上触发网页自身错误边界（与主题无关）；知识空间内点开文件走 `window.open`，桌面端按现有策略交给系统浏览器，未在本轮处理。
- 验证：定向测试 `test/chat-module-theme.test.ts`、`test/enterprise-chat-view.test.ts` 18 项通过，typecheck、build 通过；Chrome 注入复验四处修复生效。10-20 重启开发应用（`/tmp/bisheng-dev-modules`，设置切深色）后实机确认：知识空间首页文件夹磁贴反色且名称可读、知识广场卡片深底白字、订阅文章阅读区整页深色且配图正常、聊天参考来源面板与来源卡片深底。全量回归 `npx vitest run`：223 文件、1900 项通过、1 项跳过；`git diff --check` 无告警。Windows 与安装包未验证。

## 2026-10-20 — Work 技能选择与知识空间检索

- 2026-10-22 只读复核：前端任务选择、插件工具注册、宿主登录态代理与后端空间/文件权限过滤链路仍存在；重新执行 `test/work-resources.test.js`，8 项通过。企业登录服务联合测试首次受回环监听权限限制，放开执行环境后等待未结束，已停止；本轮完整联合测试结果为未完成。10-20 的真实检索截图保留为历史开发版证据；当前安装包及新一轮真实检索尚待验证。本轮业务源码与部署保持原状。
- 基线：bisheng-work/V1.2.0@a73f871725bc62eb0ff533ec99ad45d22db53749，工作目录 bisheng-work-chat-work；Harness 0.2.0-rc.2。延续已有 BISHENG 集成分支；远端 v0.9.0 查询无匹配引用。
- Work 加号复用 Harness commandUi：技能进入原生可搜索二级菜单，名称优先、描述单行省略，选择后通过原生输入事件插入技能调用。候选来自当前 Work 运行时已加载的技能；企业技能安装与授权继续使用企业市场流程。
- 知识空间使用原生 Modal，按当前企业身份列出可访问空间，确认后显示为当前任务资源；检索范围保存在主任务会话中。宿主持有凭据，经固定路径代理调用平台登录态检索接口，平台继续执行空间与文件权限过滤；子任务独立隔离，身份变化清理选择。
- 修正真实运行发现的 Cordis inject 回调返回值与工具输出 schema 契约；将插件激活纳入回归。
- 自动验证：222 文件、1893 项通过、1 项跳过；typecheck、build、diff-check 通过。
- 本机开发版已运行：真实窗口验证技能搜索/选择、知识空间加载/勾选/确认和资源显示。真实 Work 请求调用 bisheng_knowledge_search，一次检索返回 hdc-BISHENG.pdf 与摘要；平台接口与本地模型执行链路通过。安装包与 Windows 本轮单独验收。
- 3006 已发布知识空间接口；API 健康 200，匿名检索 401，原前端与其它容器保持。同事 desktop-settings-20261019-r1 为部署基础。证据见主工作区 outputs/work-resources-20261020。

## 2026-10-19 — a73f871 本机更新

- 源码与远端 V1.2.0 对齐至 a73f871725bc62eb0ff533ec99ad45d22db53749；Harness 0.2.0-rc.2，Electron 43.0.0，macOS arm64。目标仓库 v0.9.0 远端分支查询无匹配引用，延续用户指定的 BISHENG V1.2.0 集成分支。
- typecheck 与 4 套件 / 37 项桌面定向回归通过。打包首次因 Electron 下载等待 600 秒超时，使用本机同版本 electronDist 后完成；Apple Development 签名深度严格检查与 DMG 完整性验证通过。
- 已更新用户 Applications/BISHENG Dev.app 并实际启动，使用既有 bisheng-dev Profile，企业 Chat 连接正常。旧应用保留为 BISHENG Dev-feee3b5-backup.app。当前安装包为本地开发签名版本。
- 菜单最新前端 15f319c06 已推送 feat/bisheng-work-120 并发布 3006；桌面 Chat 加载该环境。证据见主工作区 outputs/composer-release-20261019。后续界面迭代优先直接本地运行。

## 2026-10-19 — V1.2.0 本机安装包

- 打包源码为共享分支 V1.2.0@feee3b5b14ced1cead6bcd09ca69b7d777e888c9，Harness 0.2.0-rc.2、Electron 43.0.0、macOS arm64。
- BISHENG Dev 已使用本机 Apple Development 证书签名并通过 codesign 深度严格校验，保持 Hardened Runtime；安装到用户 Applications，原企业测试 Profile 复制到持久 bisheng-dev 目录，原始数据保留。
- 包内侧栏与源码 SHA256 一致；Office 包内生成与转换检查、DMG 完整性、ZIP CRC 与签名清单一致性通过。安装版实际启动，Harness 就绪、企业连接恢复，原生插件/更多和会话列表可见。
- 安装文件与校验和见主工作区 artifacts/bisheng-feee3b5-mac-arm64；证据见 outputs/bisheng-feee3b5-package。本轮交付为本机开发签名包，Apple 公证、正式分发及 Windows 验收另行执行。

## 2026-10-19 — 本地拉取最新代码并保留语言同步

- `V1.2.0` 从 `e434ed9` 快进到远端 `feee3b5`，合入恢复 Harness 原生导航及插件/更多固定入口两条提交。保留本地语言、模块主题与加载超时 WIP；四个重叠文件先在临时目录三方合并，再更新分支，未使用 stash、提交或覆盖无关改动。
- Web 的 `feat/bisheng-work-120@5f601e7fd` 已是最新，全部本地改动逐文件指纹保持。
- 依次完成 `npm ci`（postinstall 所有补丁成功且无 offset）、typecheck、build、全量测试与 diff-check：221 文件、1885 项通过，1 项跳过。使用原开发 userData 恢复应用；本次只更新本地桌面，3006 部署保持语言同步版本。
- 真实窗口确认新会话、插件、更多采用更新后的原生侧栏；更多菜单仍列出账号授权的五类企业入口，可打开中文知识空间，标题、创建按钮和三个分组均已挂载。最终保留中文知识空间页面；Windows 与正式安装包本轮未验证。

## 2026-10-19 — 插件与更多固定入口

- 基线：bisheng-work/V1.2.0@eb9e07368ec0882193cab1ea55e85bebf5595470；工作目录 bisheng-work-chat-work，开发分支 codex/chat-work-integration，Harness 0.2.0-rc.2。
- 侧栏通过 DSH 原生 NavigationRow 固定展示插件与更多；插件直接打开原生管理页，更多收纳账号授权的企业页面及其他本地面板。选中态根据当前面板身份同步，新会话保持原生按钮。
- 实机：运行中的企业测试桌面端已加载改动，直接点击插件进入管理页；更多显示知识空间、订阅、应用、技能中心、发现广场。正式安装包另行构建。
- 自动验证：类型检查与生产构建通过；完整 219 个文件、1875 项测试通过，1 项跳过。首次全量执行遇到 Node socket setTypeOfService EINVAL，重跑完整回归通过。

## 2026-10-19 — 恢复 DSH 原生侧栏与网页技能中心

- 基线：远端 bisheng-work/V1.2.0 e434ed938b58e7dc3073ef26f566804c27407c50；工作目录 bisheng-work-chat-work，开发分支 codex/chat-work-integration，Harness 0.2.0-rc.2。
- 原生 SidebarRoot 持续呈现新会话按钮、快捷键与 Tooltip。更多使用原生 PanelRow 展示组件和 Menu，包含知识空间、订阅、应用、技能中心、发现广场及本地插件；展示内容和权限继续来自账号实际菜单。Chat/Work 共享同一侧栏，去掉欢迎文字与自定义平铺导航。
- 嵌入网页边界同步原生侧栏尺寸，折叠时保留原生操作区域；打开更多时展开侧栏。右侧沿用网页已有组件；网页技能中心以 usePrefersMobileLayout 统一结构判断，桌面嵌入使用原有标题和操作栏，H5 保持移动端标签。
- 3006 知识空间本轮实机已显示部门空间与个人空间，mine/department 接口返回 200。历史错误来自数据库 review 与 ORM 权限枚举不匹配；本轮复核时已恢复，本次桌面改动未修改数据库或后台配置。
- 自动验证：最终独立 npm ci/postinstall、typecheck/build 通过；完整 219 文件、1875 项通过、1 项跳过。回归覆盖新会话保留、企业入口收纳、账号切换、第三方面板及折叠内容边界。网页变更 lint、1450 strict 文件、构建和 3 项导航/布局测试通过。
- 网页交付：bisheng/feat/bisheng-work-120@5f601e7fdb3a4a7b9feb360703ae58cb34b89664 已推送并部署 3006，461 个前端文件哈希核验通过；前端以外容器身份保持一致。
- 实机验证与提交交付见主工作区 outputs/native-sidebar-20261019/；正式安装包及 Windows 实机另行验收。

## 2026-10-19 — 语言同步已部署并在当前桌面生效

- 用户授权更新 3006 与本地桌面。Web 先快进到线上已使用的 `feat/bisheng-work-120@5f601e7fd`，保留技能页修复；语言 WIP 差异在快进前后逐字一致。
- 3006 发布 `desktop-locale-20261019-r1`：克隆原 release 后覆盖 client 构建与对应源码，475 项 SHA-256 校验通过，原子切换 current 并仅重建 frontend。管理后台构建指纹与其他全部容器 ID 保持；网页、API 和实际语言脚本均返回 200，脚本类型与本地指纹一致。旧 release 保留可回退。
- 正常退出旧 Electron，使用原开发 userData 与原企业身份启动更新代码。真实窗口已观察应用页中文、知识空间中文、设置切英文后知识空间标题/创建按钮/三组列表/侧栏实时同步英文，再恢复中文。未发送测试消息或修改知识空间内容。
- 最终桌面停留在中文知识空间，不需要用户再次重开；后续在“设置 → 通用设置 → 语言”切换即可。证据与发布元数据位于 `outputs/desktop-locale-20261019/`。这是现有开发应用的更新，正式安装包及 Windows 未验收。

## 2026-10-19 — 桌面与独立网页语言隔离（源码验证）

- 桌面从 Harness locale 订阅中英文，通过现有 presentation IPC、entry 参数和文档事件同步当前身份的嵌入网页，设置隐藏期间仍更新。独立网页保留自身偏好；网页配套改动位于用户确认的 `feat/bisheng-work-120`。
- 桌面定向 4 文件 36 项、typecheck、build 通过。全量 221 文件中 220 文件通过，Office 测试一项超时（1883 项通过、1 项跳过、1 项失败）；该文件独立复跑 6 项全部通过，未据此将全量结果记为通过。
- 网页定向 7 文件 13 项、全仓 typecheck、变更文件 lint、check-i18n 与构建通过；全仓 lint 在未修改的 platform 文件报 95 项错误，未绕过门禁。Jest 使用进程级可选 canvas 禁用器，依赖与锁文件未改。
- 使用临时 userData 的真实 Electron 隔离窗口、正式展示 preload 与网页实际语言模块验证首次中文、实时中英文、重新挂载、刷新、偏好保留和普通网页忽略宿主覆盖。此为聚焦语言协议的测试页面，未代替完整企业登录与业务页面验收。
- 本阶段只完成源码验证；随后部署及真实桌面结果见上条。尚未提交或推送；Windows 与安装包未验收。

## 2026-10-19 — 模块页深浅色与嵌入文档加载超时

- 基于 V1.2.0 e434ed938b58e7dc3073ef26f566804c27407c50（统一桌面企业导航）。模块入口与导航由该提交提供，本条只补两项宿主行为。
- 深浅色：新增 `src/main/enterprise/chat-module-theme.ts`。宿主在模块路由（knowledge / channel / apps / skills / square）且自身为深色时给嵌入文档的 `<html>` 加 `dark`，驱动 `@bisheng/ui` 已有的 `.dark` 变量块；页内常驻 MutationObserver 守卫在 ThemeProvider 重写 `light` 后重新断言，且只撤销宿主自己加过的 `dark`。另按明度/色度推导注入宿主样式，覆盖网页硬编码的白底、灰字、浅边框与表头底色。聊天路由不受影响。
- 加载超时：嵌入文档首次加载与页面内导航限时 45 秒，超时进入错误态并记 `session_failed status=timeout`，避免平台抖动时 `loadURL` 永不返回把会话钉在 connecting（10-19 上午实际发生过）。
- 验证：`npm ci` 重放全部 28 个补丁、typecheck、build 通过；定向 4 文件 37 项通过，含路由匹配、守卫不与网页互斥、样式仅覆盖中性色、超时拒绝与会话失败。
- 实机：重装依赖并重启后，统一导航生效（新建对话 / Knowledge Space / Channel / Apps / 更多）。深色下知识空间首页的文件夹磁贴、频道首页的报刊式列表、知识空间详情页的文件列表与底部提问栏均为深色且文字可读；详情页由网页自带返回键与面包屑，无重复返回。知识空间接口此前的 500 已恢复。
- 未覆盖：Apps / 技能 / 广场三类模块页的深色观感未逐页核对；Windows 与安装包未验证。

## 2026-10-19 — 统一桌面企业导航

- 基线：V1.2.0 e9f206331d9ff5a1e36ffdb29ab7403881dc6bb2；实际 Harness 0.2.0-rc.2。网页以 3006 已部署的 feat/bisheng-work-120 4269304db 为基线。
- Chat/Work 共用新建对话、企业功能入口、更多、项目与对话列表；本地插件移入更多，保留桌面设置和项目能力。远程页面按企业实际可见入口接入，使用已有网页内容与设计。
- 验证：桌面 219 文件、1874 项通过、1 项跳过；typecheck/build 通过；两项 Harness 扩展从原始 npm 包重放通过。网页构建、1450 strict 文件、变更 lint 与导航回归通过。
- 实机：保留企业测试配置重启后，Chat/Work 共用导航，新建对话、云端历史、本地任务、订阅、应用、技能中心、本地插件及功能页隐藏模式选择均已观察。新建动作显式调用无参数 startSession，避免将点击事件误作工作区标识。
- 3006 已部署 bisheng/feat/bisheng-work-120@bc05600f147c2127095aed80c939d19d4125b0b2，461 个前端文件哈希校验通过；后台、后端与其他容器保持原状。嵌入功能页明确采用桌面布局，浏览器保留原有响应式规则。
- 独立问题：知识空间 mine/department 返回 500，后端日志显示历史 auth_type=review 与当前枚举不匹配；列表数据验收受阻。深色/系统主题与 Windows 实机、正式安装包本轮未验收。截图及部署记录见主工作区 outputs/desktop-navigation-20261019-r2/。

## 2026-10-16 — macOS 浅色侧栏与窗口主题同步

- 基线实时核验：bisheng-work/V1.2.0@7edfd09170c23b005c81a78b65a42360377fc87d；工作目录 bisheng-work-chat-work，分支 codex/chat-work-integration，Harness 0.2.0-rc.2。
- 根因：macOS 窗口持续使用半透明 sidebar 材质，浅色页面透出深色原生底层；页面主题的实时同步此前仅覆盖 Windows。浅色窗口改用稳定的 #f9fafb 底色，深色保持原生材质；macOS 订阅 Harness 已解析的主题标记，通过既有可信 IPC 更新窗口，并在隐藏、最小化和恢复时保留当前页面主题。
- 自动验证：窗口主题及隐藏/恢复回归通过，类型检查、生产构建和 diff-check 通过。企业测试客户端实际验证浅色 Chat、浅色 Work、浅色→深色→浅色切换，侧栏与正文主题同步；保留用户当前浅色偏好。截图：主工作区 outputs/sidebar-theme-20261016/light-chat.png。
- 交付范围为桌面源码与已重启的企业测试客户端；正式安装包、Windows 实机及系统外观自动切换另行验收。

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


## 2026-10-22 Chat knowledge dialog window presentation
- Desktop baseline: `V1.2.0@a2d2f43`, Harness `0.2.0-rc.2`, Electron `43.0.0`; working tree `bisheng-work-v120-credits`.
- Chat reports its knowledge dialog lifecycle through a presentation-only bridge. The native view expands to the window while the chat content retains its region geometry; close/navigation restores the region. The backdrop uses Work's sampled mask token including alpha.
- Type checking, production build and 29 targeted host/theme tests passed. macOS arm64 DMG/ZIP and packaged Office checks passed. 3006 client release `chat-window-dialog-20261022-1905` deployed; package stored in `outputs/bisheng-dev-3006-dialog-20261022`. Visual acceptance belongs to the user.


## 2026-10-22 Account settings display simplification
- Baseline: remote `V1.2.0@0b64190cf5c3c529acad3222c0eeb760d6e4a9c5`; worktree `bisheng-work-v120-credits`; installed Harness `0.2.0-rc.2`, Electron `43.0.0`. Includes the latest colleague enterprise skills integration.
- The connected account page ends with the logout action after usage, managed models and storage. Removed the redundant enterprise account heading and service address display, together with their unused copy/styles. The sign-in address field remains available for connection setup.
- JavaScript syntax check, production build and packaged Office authoring/conversion checks passed. User performs local visual acceptance.


## 2026-10-22 Combined desktop installer correction
- Verified remote `V1.2.0@3a56272`, which includes enterprise skills and source attribution from `0b64190`, plus the account footer simplification. Harness remains `0.2.0-rc.2`; worktree `bisheng-work-v120-credits`.
- Previous account-cleanup DMG was rebuilt with the containing directory as `--prepackaged`, producing a nested app. Rebuilt the complete application and DMG/ZIP through the standard packaging flow; documented the correct `.app` input for installer-only rebuilds.
- Production build and packaged Office checks passed. Read-only mounted DMG contains the executable, Info.plist and icon in the expected bundle layout. Mounted ASAR/executable hashes match the fresh build; packaged client and enterprise skill files match source. The app launched directly from the corrected image and reached the authenticated 3006 Chat home.
- Delivery: `outputs/bisheng-dev-3006-combined-20261022`, with checksums. User performs visual feature acceptance.


## 2026-10-22 Logout typography and spacing
- Baseline: `V1.2.0@3219187`; worktree `bisheng-work-v120-credits`; Harness `0.2.0-rc.2`.
- Logout uses the standard medium Button (14px text, matching personal storage) with 16px top spacing. Existing destructive styling and logout behavior remain.
- JavaScript syntax, diff checks and production build passed. Local visual acceptance belongs to the user.
