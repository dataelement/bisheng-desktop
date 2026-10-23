# Patch 与 Plugin 规范

适用于 DSH Desktop 对 Harness 的宿主定制，以及为这些定制维护的第三方补丁。本文是跨目录规则的唯一维护位置；包加载和补丁重放的具体要求分别见 `packages/AGENTS.md`、`patches/AGENTS.md`。preload 能否直接改页面 DOM 的判定见 `src/preload/AGENTS.md`，不在本文重复。

### 输入候选菜单的滚动归属（2026-10-21）

Harness 0.2.0-rc.2 的 `dsh-client-ui-input-trigger` 将 pointer hover 与 keyboard move 归入同一个 highlight，原视图对每次变化调用 `scrollIntoView`。鼠标悬停底部部分可见的候选时会推动列表，调用还可能滚动外层会话容器。修复直接在 reducer 的 highlight 上记录可选的 `origin`，悬停更新高亮，键盘导航按候选与列表的可见边界调整该列表的 `scrollTop`。初始候选仍按边界检查，菜单的原有高度计算、主题、溢出渐隐和滚轮行为保持。

变更在依赖安装时由 patch-package 重放，类型声明同步；行为回归见 `test/input-trigger-scroll.test.mjs`，覆盖部分可见行悬停、手动滚动后的结果刷新、键盘循环及鼠标转键盘操作。上游提供同等输入来源区分与列表内滚动后删除本地兼容变更，并保留行为回归。此修复只影响原生 Work 候选菜单，网页 Chat 使用自己的菜单实现。

### 原生语言同步（Harness 0.2.0-rc.2，2026-10-20）

直接消费上游 `dsh-client-locale` 的 `__DSH_LOCALE__.read()/onChange(active)` 接口，不新增补丁、插件或语言偏好副本。preload 只暴露读取系统语言与上报活动语言两项能力；main 复用可信主窗口与主 frame 校验，并仅接受 `zh` / `en`。初始化返回系统语言顺序与 `preference: null`，持久偏好由 Harness 已有 configForms 从当前 Profile 提供；Client 初始化后立即上报解析值，后续通过上游 locale/change 上报。main 在内存保留该值供手机桥及原生文案使用，尚未激活 Client 的启动/恢复页面保留现有回退。此改动不参与 Profile 组合、包解析或客户端加载图。

手机桌面配对页的已认证 `/desktop/status` 响应携带当前语言，页面沿用现有轮询检测变化并重新请求 HTML；连接模式切换期间延后刷新，不重建手机桥、隧道、配对 token 或 PIN。旧客户端忽略新增响应字段。原账号菜单继续由官方 slot 和 Harness locale 控制；preload 仅同步未加载账号插件时的既有手机按钮，不新增 DOM 入口。网页自身语言机制不受影响。

## 1. 按能力选扩展方式

产品能力和长期维护的桌面表现优先放在宿主代码或插件中；patch 用于修复上游缺陷或补足必要的扩展接缝。插件不能通过隐藏的 DOM 改写、内部方法替换，把实际的上游耦合伪装成无补丁扩展。

| 需求 | 首选位置 | 允许使用 patch 的边界 |
| --- | --- | --- |
| 品牌、颜色、间距等视觉调整 | 宿主 UI 插件的样式，使用公开主题变量或稳定标记 | 上游缺少稳定标记/变量时补最小接缝 |
| 新增面板、按钮或功能入口 | 现有 slot 注册项与宿主服务；不默认走 preload DOM 注入 | 缺少合适挂载位置时补扩展点，不能偷偷借用不相干 slot |
| 改变一个现有操作的位置 | 已有位置配置或可选择注册项的布局能力 | 缺少能力时做最小结构调整，并检查其他注册项是否受影响 |
| 调整上游内部组件布局 | 上游提供的布局配置/扩展 API | 无扩展点时允许局部 React 渲染树补丁，需明确兼容范围 |
| 上游错误、缺失 Remote/API 行为 | 对应上游包的局部缺陷补丁 | 不复制整套组件或 runtime；保留跟随上游修复的退出路径 |
| 文件、进程、窗口和更新能力 | Electron main 的服务及窄 IPC | 不能通过放宽 renderer 权限实现 |

- 先检查目标版本实际发布的 API、slot 和加载产物，不能凭名称猜测可用能力。
- 不为很小的定制创造通用框架，也不为追求“零 patch”复制上游组件或在 preload 中移动 React 管理的 DOM。
- 接缝允许独立存在时，卸载定制插件后保留上游默认行为。若 patch 与插件必须同时加载，应声明依赖，并在缺失时给出可诊断的降级或错误。
- 可复用的扩展点优先设计成可向上游提交的能力；是否提交上游 issue/PR 由用户授权，不自动发送。

## 2. Slot 契约包含布局与生命周期

下列任一变化都应在评审中明确，不能仅以“slot 名称未变”判断兼容：

| 契约维度 | 要保持或解释的内容 |
| --- | --- |
| 声明 | 名称、`kind`（single/list 等）、scope、由谁声明 |
| 数据与上下文 | Props、注入服务、locale、会话及状态来源 |
| 贡献项 | ID、排序、替换/竞争规则，是否允许多个插件共同贡献 |
| 渲染 | 出现条件、挂载次数、所在位置及父容器布局 |
| 可用空间 | 宽度、换行、溢出、定位、层级和键盘焦点顺序 |
| 生命周期 | 会话切换、卸载、重载后的订阅、局部状态和清理 |

- 移动 `renderSlot(...)` 会移动该出口渲染的贡献项集合。只想移动一个按钮时，不得无说明地移动整个 list slot。
- 不删除、重命名、缩窄或改变既有 slot 的用途来容纳 Desktop 私有需求。确需改变公共契约，记录受影响插件、迁移方式和兼容限制；局部能力优先新增语义明确的扩展点。
- 新 slot 要定义用途、kind/scope、Props、容器约束和默认行为，并同步目标包适用的运行时声明与类型声明。声明存在、出口可达、贡献项可见必须分别验证。
- 禁止为了保留旧位置再额外渲染同一份有状态贡献项，造成双挂载、重复订阅或重复副作用。
- 替换既有贡献项仅使用目标版本明确支持的机制；不要猜测 ID 覆盖、优先级或过滤参数的行为。
- `data-dsh-*` 只是样式/定位接缝，不是 slot，也不能代替 slot 的上下文或生命周期契约。自有标记需有明确归属和用途，避免与上游及其他插件冲突。

## 3. Plugin 的职责与可卸载性

- 展示、文案、交互和桌面特有业务留在自有模块；与第三方内部实现的兼容逻辑集中在小范围适配层，不散布到多个插件。
- 工作台类第三方插件属于可选贡献项。单个工作台插件导入、激活或渲染失败时，只隔离该插件并保留可诊断信息；不得阻断核心运行时、插件/工作台市场和其他插件。宿主核心项及未声明为工作台的插件仍按各自启动策略处理。
- 注册项、事件订阅、timer、observer、注入样式及异步任务需有明确所有者。遵循 Cordis 的 effect/disposer 机制；不能假设插件只会加载一次。
- 卸载或切换会话后，旧异步结果不得更新新实例；重载后不得重复注册或残留样式。共享资源按引用/所有权处理，不能删除其他插件的资源。
- CSS 限定到自有根节点或明确的宿主接缝；不依赖压缩类名、翻译文字或宽泛的全局选择器。覆盖主题时保留 hover、disabled、focus 等状态。
- 不能为一个插件更改全局 slot registry 的竞争规则、屏蔽其他贡献项或绕过依赖校验。

## 4. Patch 的最小范围与退出路径

- 对样式定制，patch 尽量只补标记/变量；CSS 放自有文件。对结构缺口，patch 只补必要的出口、配置或局部结构；不要把后续业务功能不断堆进编译 bundle。
- 直接修复上游缺陷时允许改其实现；“最小”指职责和影响范围，不按 diff 行数评判。
- 现有补丁无需一次性重写；修改某项定制时评估能否把自有逻辑移出，避免继续扩大耦合。
- 每项新增或实质修改的补丁在 PR 中说明：目标包/版本、解决的问题、现有扩展点为何不足、受影响的 slot/插件、已执行验证、何时可删除。不能只写“优化 UI”。
- 同一版本包的多项修改可以保留在同一个 patch-package 文件中，但评审和测试需能区分各项行为；不要为了文件数量强拆补丁。
- 上游提供等价修复或扩展点后，切换自有实现并移除对应补丁；确认没有重复注入、重复渲染或遗留样式。

## 5. 按影响做组合验证

| 改动 | 最小验证范围 |
| --- | --- |
| 纯 CSS | 实际页面、深浅主题、相关交互状态及窄窗口；检查样式不外溢 |
| Slot 出口、容器或渲染条件 | 无贡献项、单贡献项、多贡献项；已有与测试贡献项并存；尺寸/焦点/重复挂载 |
| 插件注册或副作用 | 加载、卸载、重载，以及相关会话切换/异步过期场景 |
| Patch 与插件共同实现能力 | 干净安装重放、实际加载路径；缺少可选插件时的预期行为 |
| 原生能力或分发行为 | 对应平台及实际安装包流程，按根规范执行 |

测试贡献项应包含长文案或占满容器宽度等情况，以暴露仅有内置按钮时看不到的布局问题。涉及 slot 的变更，应验证数量、位置及事件行为；只检查 patch 字符串或只截图内置组件，不构成兼容验证。

## 6. 示例：设置操作与输入框仪表

PR #357 展示了两种应区别处理的变化：

- “+”背景和间距属于视觉定制，可由最小标记补丁加宿主样式承载。
- 将 `settings.action` 从标题区移到侧栏，会影响整个操作列表。若意图仅移动 `open-document`，应保留其他贡献项的语义，评估独立 footer 出口或目标版本支持的定向布局机制。
- ContextMeter 原本直接渲染；把它挪到 dock 旁边并不自动让它成为 slot。若采用新的位置配置/独立贡献机制，需要先实现相应契约；同时验证原 dock 贡献项的空间和挂载条件。

这些是设计选择示例，不表示所提新扩展 API 已存在。本文是开发与评审约束；当前尚无自动 slot 契约门禁。

## Chat / Work 接缝（Harness 0.2.0-rc.2）

`dsh-client-ui-layout` 声明 root/single 的 `desktop.mode.content`，owner 为 `work: ReactNode`、`columns: string`、`resizeHandle: ReactNode`。位置只覆盖第二、三列；贡献项占据这两列并保持 Work 挂载一次。默认 fallback 使用原内容和 frame 坐标的拖拽柄；桌面贡献项使用内容区域坐标的拖拽柄。左侧原生 SidebarRoot 始终挂载。

`dsh-client-ui-workspace` 声明 root/single 的 `sidebar.workspaces.collection`，由 WorkspaceBrowser 内的 SessionTree、FlatList 和 SearchResults 呈现。owner 提供 `mode: projects | flat | search`、`query`、`archivedOnly`、`projects(active): ReactNode` 和只读 `items`。每项包含 id、updatedAt、pinned、blank、`render(active): ReactNode`。项目视图的 items 来自原生 deriveFlat 对未分组 sessionIds 的投影，项目成员与归档过滤继续由 Harness 拥有；原生 renderer 保持行菜单、状态及选择行为。默认 fallback 保持原项目树、单列表或搜索结果。

桌面贡献项将云端历史与上述本地 items 按来源命名空间和更新时间组合，项目节点独立呈现在最近之前。Chat 模式通过 active=false 清除本地选中态；会话行直接呈现标题与时间，来源继续由数据与导航控制。云端搜索匹配已加载的标题；归档专用视图仅呈现有归档元数据的本地记录。`sidebar.history` 已由这个集合接缝替代，SidebarRoot 持续呈现唯一 workspace browser。

`uiWorkspace.registerNavigationHandler(handler)` 为多订阅者的导航接缝，handler 接收 `open | new` 和可选 workspaceId。`new` 返回 true 表示全局新建已由 Chat 接管；`open` 只通知呈现模式，原 Work 导航和工作台 starter/opener 继续处理。本地任务查询、持久化和执行由原 Harness 服务负责。解绑按 Cordis/React 生命周期执行。

`dsh-client-ui-settings-general` 接收 `dsh-desktop:open-settings-section`（detail.id 对应已注册页）及 `dsh-desktop:close-settings`，绑定现有 store actions；发送 `dsh-desktop:settings-visibility`（detail.open 布尔值），设置打开时暂停原生 Chat view 展示，关闭后恢复。事件只控制本地呈现，认证由主进程执行。

主进程仅向可信宿主主 frame 暴露 Chat history(page) 与 open(id)，固定 API 路径、校验页码和标识。使用内存隔离 cookie session；会话打开按本次身份查询到的路径映射执行。身份 generation 改变后丢弃异步响应并清理云端列表、路径和网页存储。远程网页使用独立的展示状态 preload，仅暴露 reportLanding(boolean)，由主进程校验当前视图、主 frame、企业来源、路径和身份代际。

毕昇 `/workspace/?embed=dsh` 在路由跳转前记录本浏览会话的嵌入布局标识，嵌入布局由 React 直接呈现内容。独立网页继续显示自己的聊天导航。该标识参与布局与主题呈现；语言覆盖另要求原生展示桥，见下文“桌面与独立网页的语言隔离”。

上游提供等价内容/历史 slot、导航订阅和设置可见状态 API 后迁移并移除对应兼容扩展。每次变更执行全新 npm ci 重放、模式/导航/身份回归和原生布局检查。

### Chat 文档生命周期与页面内导航（2026-10-16）

企业身份拥有一个远程 Chat 文档；Work/设置切换只改变展示状态，隐藏时保留网页尺寸与背景。贡献项卸载时清理展示，身份代际变化时由主进程清理文档和凭据。首次加载的 dshTheme 查询参数仅携带 dark/light 呈现值。

主进程 open(id) 先从该身份已读取的历史路由映射得到路径，再发送可取消的 dsh:navigate 事件；网页 Root 校验 c、linsight、chat 三种明确路由结构后确认并调用 React Router。宿主以 defaultPrevented 作为页面内导航确认，旧网页沿用完整加载。异步返回检查身份 epoch 和视图所有权。路由事件携带页面路径。网页专用 preload 仅上报欢迎页状态，企业凭据和本地执行 API 由宿主独立持有。

### 首次发送的即时模式收起（2026-10-16）

Work 从 sessions.binding(id).session 订阅当前主视图的 pendingSubmissions、blank、running、awaitingFirstTurn，发送回显到达后立即收起模式选择；会话切换和卸载释放旧订阅。ChatView 使用自己的乐观消息状态在 layout effect 上报欢迎页状态，KeepAlive 页面只在路由匹配时上报。主进程经受限 preload 接收布尔值，向可信宿主推送快照，旧轮询响应按 revision 丢弃。轮询继续刷新历史及连接兜底，首次发送的模式收起由实时状态驱动。新会话恢复选择；发送拒绝后的可见状态与实际消息列表一致。

### 统一桌面导航（2026-10-19）

基于 bisheng-work/V1.2.0 e9f2063 与 Harness 0.2.0-rc.2。sidebar.primaryNavigation single/root 接缝位于原生新会话、quickSwitcher 之后，传递 wide、startSession、panels、selectPanel、renderPanelIcon、expandSidebar 与 renderAction。新会话及快捷键由 Harness 持续渲染一次；无贡献项时使用原生面板列表。renderAction 复用 PanelRow 的展示组件、Tooltip、主题、焦点及展开状态。桌面贡献项将全部企业入口和本地面板收进 Harness Menu，折叠状态打开菜单时展开原生侧栏。嵌入网页边界取内容区域与侧栏右边界的交集，并订阅两者尺寸变化，保留原生侧栏操作区域。sidebar.workspaces.title single/root 仅提供 flat 状态，默认仍使用 Harness 文案；桌面使用项目/所有会话标题。上游提供同等接缝后迁移。

企业网页在 MainLayout 中上报实际可见菜单（权限、预览开关、名称、顺序和选中项均由网页决定）。远程 preload 仅上报展示数据；主进程校验视图、主 frame、企业来源、当前路径和身份代际，逐项校验菜单 ID 与固定路由。宿主 openPage 只接受当前账号已上报的菜单 ID。身份切换清空菜单及页面状态。网页的路由和主题桥接覆盖整个 MainLayout，功能页复用现有页面。Work 本地项目与会话继续由 Harness 管理。

### 收起侧栏后的原生操作区（2026-10-23）

macOS 收起侧栏后，Harness 将展开与新会话控件挂载到既有 `[data-shell-leading]` 操作区。普通 Chat 的模式选择器在进入会话后释放顶部空间，原生 WebContentsView 若仍占据该区域，会盖住 DOM 控件，CSS z-index 无法修复。桌面内容贡献项因此在操作区与 Chat 顶部重叠时，按实际操作区右边界为 Chat 留出左侧空间，保持原有顶部坐标与内容高度，避免标题另起一行；展开侧栏、操作区卸载后恢复完整内容宽度。WebContentsView 为矩形边界，此留白作用于整个嵌入视图，而非仅标题文字。沿用原有按钮、slot 和快捷键，不新增上游补丁或另一份操作控件。

仅观察内容贡献项的直接 frame 子节点/收起属性及操作区尺寸变化，不观察流式正文；卸载时释放 observer。设置页的独立 bounds 不受影响。行为回归在 `test/desktop-modes-ui.test.mjs`，覆盖活动会话收起、展开后恢复和卸载清理；真实 Electron 的点击与视图遮挡仍需独立验收。

### 模块页深浅色与加载超时（2026-10-19）

毕昇客户端的 ThemeProvider 把 `<html>` 固定为 `light`，而 `@bisheng/ui` 的 tokens.css 已定义完整 `.dark` 变量块。宿主因此接管模块页的深色：`src/main/enterprise/chat-module-theme.ts` 的 `moduleThemeScript` 在每次呈现、完整加载和页面内路由变化后向嵌入文档执行，写 `dshHostTheme` 与 `data-dsh-page`、派发 `dsh:appearance`，并且仅当路径匹配 `MODULE_ROUTE_PATTERN`（knowledge / channel / apps / skills / square，与宿主导航可达的模块一致）且宿主为深色时给 `<html>` 加 `dark` 与 `dsh-module-dark`。脚本在页内安装一次性 MutationObserver 守卫，在 ThemeProvider 挂载后重写 `light` 时重新断言；守卫只撤销宿主自己加过的 `dark`（`owned` 标记），不碰网页在聊天路由上自行维护的 `html.dark`，否则两边互相覆盖会把网页主线程卡死。聊天路由不加 `dark`，继续使用网页的 `data-dsh-chat-theme`。

脚本同时在宿主为深色时给任意路由的 `<html>` 加 `dsh-host-dark`：这是工具类覆盖的作用域，聊天路由也适用（参考来源面板、引用标签、来源头像等硬编码白底在网页自行维护的 `html.dark` 下同样需要）；`dsh-module-dark` 仍只标记宿主接管 `html.dark` 的模块页。替换值全部指向 token 变量，若网页未按 `dshTheme` 进入深色，变量解析为浅色值，覆盖不改变观感。

`MODULE_THEME_CSS` 在每次完整加载后由 `insertCSS` 注入：模块页固定规则（`color-scheme`、body/#root 底色、表头、知识空间首页文件夹磁贴反色）以 `html.dsh-module-dark` 为前缀，工具类覆盖以 `html.dsh-host-dark` 为前缀，只覆盖硬编码的浅色工具类。类名清单取自 3006 bundle 与毕昇源码的并集，hex 同时生成大小写两种写法；替换值不手工指定，而是按颜色明度与色度由 `darkDeclaration` 推导到 token 变量（深字→text-1/2、中灰→text-3/4、浅底→bg-page/arco-gray-1..3、浅边→border-base），有彩度的品牌与状态色、本来就深的底色保持不变，带透明度修饰的工具类保留原透明度；每个工具类同时生成 `hover: / focus: / active: / fine-pointer:hover: / group-hover: / data-[state=open]: / has-[[data-state=open]]:` 变体（`VARIANTS`），基础类与各变体分别放入 `:is()` 列表后按变体的选择器形状包裹，背景类的交互变体比静态替换高一级表面 token（`liftSurface`），否则深色下 hover 不可见；`from-* / via-* / to-*` 渐变停色按 Tailwind 3 的自定义属性语义替换（`from-*` 同时重置透明的 `--tw-gradient-to`，`via-*` 保留两端），用于列表底部淡入提问栏的白色蒙版。代码块的 highlight.js token 颜色由 `HLJS_DARK` 提供 GitHub Dark 配色（网页只带浅色调色）；组件以内联 `style` 写死的颜色（灵思执行流调色板与结果卡片）按序列化后的属性值匹配并以 `!important` 覆盖，清单在 `INLINE_STYLE_COLORS`，同样走明度推导；该清单跟随网页源码维护，网页改用 token 后应删除对应项。表头的浅色底来自组件样式而非工具类，按 `thead` / `th` / `[role=columnheader]` 统一给深色底。写死 `#FFF` 停色的任意值渐变（知识广场卡片 `bg-[linear-gradient(...,#FFF_50%,...)]`）按类名子串匹配，替换为 token 渐变；知识空间首页的文件夹磁贴是内联 SVG 配固定粉彩填充，名称用 token 白字压在上面，宿主对该 SVG 做 `invert + hue-rotate` 反色而不改文字。订阅文章阅读区是同源 srcdoc iframe，内部 `background:#fff !important` 且正文带来源站内联颜色，token 覆盖无法到达：脚本对每个可访问的 `iframe[srcdoc]` 文档注入 `FRAME_DARK_CSS`（整页反色、媒体再反色一次、html 底色选在反色后落到页面深色），并在 iframe `load`（切换文章会重建文档）和新 iframe 挂载时重新处理；带 `sandbox` 且无 `allow-same-origin` 的产物预览 frame 不可访问，保持原样。宿主转回浅色时移除 frame 样式。网页为模块页补齐自身深色样式后，应删除本层而不是继续扩充。

嵌入文档的首次加载与页面内导航都经 `loadWithin` 限时 45 秒。平台重新部署期间 `loadURL` 可能永不返回，超时前会把会话钉在 connecting 且不出现重连入口；超时后抛出 `status: 'timeout'`，进入错误态并记 `session_failed status=timeout`，重连可用。

### 桌面与独立网页的语言隔离（2026-10-19）

宿主插件从 Harness locale 服务读取并订阅当前语言，通过 presentation 的可选 `locale: zh | en` 字段交给主进程；缺省时兼容旧调用方。主进程严格校验，在首次/完整加载的 URL 携带 `dshLocale`，并在文档就绪、呈现和页面内路由变化后设置 `data-dsh-host-locale`、派发 `dsh:locale`。设置页隐藏嵌入文档期间仍投递语言，避免导航保留旧文案；投递失败记录 `locale_delivery_failed`。该接缝只影响当前身份的隔离文档，不改变插件/依赖加载链路，也不写用户语言配置。

配套网页只在嵌入状态且存在原生 `dshChatPresentation` 时采用覆盖，映射到既有 `zh-Hans` / `en` 词典。初始化时禁用嵌入实例的 i18next 偏好缓存；运行中更新文档语言和当前实例，保留网页 lang cookie、持久化 lang atom 与独立网页偏好。宿主覆盖可在当前 sessionStorage 保留以支持硬刷新，身份 session 清理时一并释放。网页默认菜单文案切换后沿用现有导航上报；管理员自定义名称保留原文。两端必须配套更新，旧网页不会消费新增语言事件。

### 工作台欢迎区配置与模式过渡（2026-10-20）

`conversation.hero.brand.title` 为 root/single、空 owner 的标题接缝，位于原生 titleGroup 内；无贡献项沿用原生标题和徽标。桌面贡献项读取当前企业文档上报的公开 branding，与现有 mark 接缝共同呈现工作台欢迎语和图标；本地无企业配置时使用毕昇默认欢迎区。branding 只携带欢迎语及图标 enabled/HTTP URL，由导航报告的同源、主 frame、路径、身份代际校验保护，参数有长度和协议边界；身份变化沿用 navigation 清空流程。后台管理仍为构建→工作台既有配置。

`data-dsh-hero-controls` 标记原生 Work 首页控件行，样式由桌面插件拥有。鼠标切入 Work 采用 180ms 从左向右揭示，结束后清除裁切；键盘切换与 reduced-motion 即时呈现。标记不改变控件 slot、布局或挂载次数。上游提供等价标题 slot 和控件标记后迁移并移除本地接缝。

## 账号与用量组合（2026-10-22）

`dsh-desktop-enterprise` 的 `enterprise-account` 设置贡献项声明 `desktop.account.usage`（single/root）。仅登录时在账号资料与安全操作之间渲染一次，owner 提供 `credits`、`creditsLabel`、`creditsHelp` 展示字符串及 `models` ReactNode；用量贡献项将模型区挂载一次，位于热力图之后、存储之前（用量加载/失败时仍呈现模型区），无贡献项时 fallback 同样保留模型列表。容器宽度跟随设置内容区；用量贡献项不得另建弹窗或改变登录流程。`dsh-desktop-settings` 将原用量组件注册到该出口，不再注册独立的用量导航项。无贡献项时账号页仍显示剩余积分；卸载企业插件时用量贡献项随 slot 注入生命周期释放。统计请求、身份代际隔离与取消过期响应继续由原组件管理。

概览 Token/消息数来自用量接口的统计期汇总（不是全生命周期统计），界面显式标注每日桶起止日期。月份、每日用量、Token/消息切换及存储均复用原数据；账号安全与模型授权仍由企业插件拥有。此组合仅使用宿主插件自有出口，不新增第三方 patch，也不改变启动和认证协议。

## V1.2.0 模型授权与积分组合

`conversation/input-before-submit` 保留知识空间引用快照及取消信号；随后模型目录完成撤权恢复和可路由检查，再提交消息。目录恢复与模型名称补丁共同适用于 Harness 0.2.0-rc.2。目录不可用时返回可恢复错误并保留草稿；配置模型名称只用于展示，调用仍使用原稳定路由 ID。上游支持这些行为后删除相应补丁并迁入正式 API。

本次检查同时覆盖知识空间引用、撤权后的默认模型恢复、历史用量名称及企业插件；patch-package 重放、完整测试和构建通过。实际安装版与新后端的联合验收单列在 STATUS 中。

### Model authorization changes (Harness 0.2.0-rc.2, 2026-10-21)

The shared `ModelDirectory` reconciles its durable session selection with each successfully loaded catalog. It retains an available selection; a withdrawn selection switches through `session.selectModel` to the available configured default, then a model from the same provider, then the first available provider. The replacement uses its own reasoning default. Provider discovery failures preserve the saved selection for recovery. Attempts are shared per catalog and selection, and the existing selection generation protects later manual choices and session disposal.

`conversation.input.model` keeps its existing ownership and layout. Its caption uses the advertised name, an actionable selection label, or “暂无可用模型”. The ordinary composer awaits directory recovery before sending; empty and unresolved catalogs return a localized failure through the existing draft/attachment restoration path. Addressed subagents retain their own transport. Cancellation is checked after recovery.

The official DeepSeek catalog uses the request path's credential resolver, so automatic selection considers configured official providers. This reuses the credential discovery fix from PR #60 for V1.1.0.

These changes belong to `dsh-client-ui-model-selection`, `dsh-client-ui-conversation`, and `dsh-llm-deepseek-api-key` at `0.2.0-rc.2`. Existing slots expose rendering contributions; shared selection reconciliation and the composer send boundary live inside the upstream implementations, so these corrections are recorded as replayable dependency changes. Remove the corresponding hunks when Harness supplies equivalent behavior. Regressions: `test/model-revocation.test.mjs`, `test/deepseek-model-credentials.test.mjs`, and `test/deepseek-model-credentials-runtime.test.ts`.

The conversation model trigger, menu/search labels, tooltips, and `/model` rows share an enterprise display-name formatter. A missing, blank, or internal-ID display name becomes localized “企业模型 {index}” / “Enterprise model {index}”; configured names remain intact. The catalog and selection requests retain their original IDs. Model-label regression cases cover both locales and distinguish multiple unnamed models.

### Turn usage model labels (Harness 0.2.0-rc.2, 2026-10-21)

`TurnUsagePanel` resolves each recorded provider/model route through the same model catalog that supplies the composer selector. The catalog retains advertised names for the current Host generation, allowing completed turns to keep their labels after authorization changes. Connection reset clears those names and rejects late catalog responses from the previous generation. Missing names use localized copy. Route attribution and token accounting retain their existing values.

The chat package explicitly declares its model-selection client dependency and receives the shared catalog through the existing turn-tail registration. The rendering slot keeps its ownership and layout. The bundled `dsh-client-ui-chat` renderer owns the usage row and exposes no label formatter slot; `dsh-client-ui-model-selection` owns the catalog. Both dependency changes are replayable against `0.2.0-rc.2`, with matching type declarations. Remove these changes when Harness supplies the same label resolution and lifecycle contract.

`test/turn-usage-model-names.test.mjs` renders the actual usage component with React and exercises catalog arrival, authorization withdrawal, multiple routes, localized missing/empty names, connection reset, late responses, and dialog closing. Geometry hooks are fixture stubs. Saved logs that predate this change and reference a model absent from the current connection have no recoverable name; they show the localized fallback.


### 目标指令的知识空间提交（Harness 0.2.1-rc.2，2026-10-23）

Work 知识空间引用在原生输入的 `plain` 和 `claimed` 两个可编辑阶段更新，提交阶段冻结选择。目标属于原生 command claim，复用编辑器提供的引用节点和插入坐标，知识空间选择与目标文本共用同一草稿。

原生 `SessionInputShell.beginSubmit` 通过可选 `beforeCommandSubmit` 在执行 claim 前等待宿主校验；InputHub 把提交时捕获的引用快照、命令名称/参数和取消信号发送到现有 `conversation/input-before-submit` 串行事件。普通消息继续沿用该事件，旧贡献项可忽略新增的可选 command 元数据。失败沿用原生命令错误处理，保留草稿和附件。

宿主知识空间贡献项只对目标创建和编辑提交范围；目标查看、暂停、恢复、清除、缺少编辑内容及其他指令保留已有范围。范围通过企业账号和空间权限校验后才允许目标执行；后续目标轮次复用 session 选择，输入框发送后的清空保持该选择。普通新消息沿用现有明确替换范围的规则。

扩展点放在已有 conversation 兼容文件中，由 patch-package 在安装时重放，运行时声明与事件类型同步。该文件承载原生输入语义，现有 slots 只提供渲染入口，无法覆盖 command 提交边界。上游提供同等 command 提交前扩展点后迁移并移除对应变更。行为验证见 `test/work-knowledge-composer.test.mjs`，包括命令原生提交方法、权限撤销、取消、范围快照和真实工具注册的检索请求。


### 技能菜单的复用图标（Harness 0.2.1-rc.2，2026-10-23）

原生 popupSelect 的 `SelectOption.badgeIcon` 接收 option owner 的装饰图标组件，与既有文字 badge 共用名称旁的标记位置。技能 owner 复用菜单 `NavigationIcon(id=skills)` 的 SVG 路径，尺寸 12px、颜色继承原生次级文字 token；其他调用方保持既有文字 badge 和可访问名称。此接缝仅扩展原生候选行的渲染数据，不改变列表、搜索、选择或序列化。实现与类型由 commands 兼容文件重放，上游支持等价图标字段后切换并移除该变更。
