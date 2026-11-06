# PPT Web 独立插件试验

## 目标与构建

以 dsh-ppt-composer 为唯一可安装 bundle，核心代码与模板随同一包交付，免于安装未发布的 dsh-ppt。需要 Node/Harness 后端；不是纯浏览器库。Desktop 原组合、Profile 修复和保护逻辑保持不变，独立包不得与内置 composer 重复启用。

在仓库根目录执行：

```bash
npm run ppt:web:pack
```

构建先从权威源码与模板生成 staging，再离线 npm pack（禁用生命周期脚本），输出到 .build/ppt-web。会刷新本仓库 staging 和 node_modules 投影，不修改目标 Harness、Profile 或运行服务。生成包不能作为第二份源码维护。

核心位于 vendor/dsh-ppt，通过相对 import 激活；合并私有依赖，宿主 peer 不打包。移除核心发现元数据和 adapter inline，避免重复发现；校验双语 seed、页数、设计和预览哈希，失败时保留旧产物。Web 入口显式声明 workingDirectory 注入，激活核心后安装会话策略。

## 行为

旧版保留原 hero 入口及 fixed 布局；新版将按钮放在 hero.options 并与 Word/Excel 同行。宿主应用 [输入区插槽补丁](upstream-patches/ui-conversation-input-slots.patch) 后，选中模板在 input.inside，面板在 input.after；缺少新插槽时回退原 input.dock。需要先有空白标准会话。面板采用正常文档流、最大高度 50dvh，不继承旧版绝对定位；slots.inject 管理延迟声明与回退，避免重复面板。

Web 会话策略在每次模型 step 前重读模式、cwd 和技能正文，只将当前 scope 中 office-pptx 的模型调用设为不可用，保留其原用户调用权限。关闭后的下一 step、scope/插件销毁时撤销；普通 Office 缺失允许继续。策略控制工作流，不是文件或进程安全沙箱。

内置模板创建从维护 catalog 定位随包源；个人模板继续使用个人库复制校验。两者保留工作区约束、暂存发布、工程检查和来源审计。

## 验证

相关 12 个测试文件的 132 项回归已分批通过。目标 Harness 0.2.2-alpha.3 的真实插槽注册器另有 7 项渲染与交互测试通过。项目类型检查、构建和差异检查通过。全量测试在 desktop-modes-ui 的 CloudHistoryRow 未定义组件循环中停止，不能声称全量通过。

实际 Web 单包快照在临时目录连接目标真实 Cordis/核心服务后，11 工具注册、内存 RPC 选模板、创建 12 页工程、PPTD 校验及导出均成功，导出含 365 个原生对象。真实 pre-step 验证模式进入/退出和权限恢复。路由/认证和普通 Office 来源为 fixture，不代表真实 HTTP、完整 Office、Profile 安装或浏览器端到端通过。后续重打产物需重新核对快照。

```bash
DSH_PPT_HARNESS_ROOT="$HARNESS_ROOT" npm exec -- vitest run test/ppt-harness-slots.test.mjs
npm exec -- vitest run test/pack-ppt-web.test.mjs test/ppt-web-mode-policy.test.mjs test/ppt-office-pptx-scope-policy.test.mjs
```

分发脚本保留源 peer 范围。目标 Harness 的真实兼容检查使用 includePrerelease，现有范围接受 0.2.2-alpha.3，无需豁免或改写范围；不能按 npm 默认预发布语义推断检查结果。真实 Profile 安装、认证 RPC、浏览器和文件交付须单独验收。

## 实际 Profile 试验与 Office 组合更新

初次通过实际 3080 Web 插件管理页以 file: 本地目录安装；随后按宿主支持的卸载重装流程改从 tgz 安装并启用，保留 autoInstallPeers:false。旧代码已本地快照，个人模板及工程数据保留，真实 Profile 配置未纳入源码。完整 Office 组合更新后，真实客户端模块图包含 composer、Office 和新增引用接缝，三个模式控件已实际挂载。本轮布局更新后的安装目录与构建目录客户端 SHA256 相同（2d0c4882ff13a29ef03e6fc926eab3bba4dbcb7eefdc008ac6b036531c297d39）。Office 真实浏览器验收与宿主前置条件见 [Office Web 迁移](office-web-plugin.md)。

首次加载暴露了宿主 profile-resolution 对 punycode/ 的解析缺陷：jsdom → whatwg-url → tr46 请求用户态包，宿主按内置模块同名根查询搜索路径得到 null。目标宿主三处路径查询已改为包目录形式，补充 profile、linked、native 三种 importer 回归；完整解析矩阵 236/236 通过，编译与文档检查通过，真实 Profile 安装目录的无 shim 导入成功。修复后重启原服务，保留原 Node、参数、环境和 Profile，完成实际加载复验。此宿主修复是当前 alpha 版本的部署前置条件，不能仅靠插件声明解决；可重放源码补丁保存在 [Profile 解析修复](upstream-patches/profile-resolution-directory-specifier.patch)，基于相同 Harness commit；不将宿主实现复制进插件。

实际浏览器已验证：空白标准会话中展开单个模板面板；16 套模板及所有封面加载成功；Blue Professional 选择状态写入，12 页预览弹层的首页正常加载；刷新后所选模板恢复。官方停用/重新启用均返回 application:applied、无 warnings，停用后输入区 PPT 控件撤销，重新启用保留为最终状态。入口位于标准会话；工作台 iframe 不消费此 Harness slot，使用标准工作区的新建会话入口。

首轮 PPT Web 包的集成、个人模板 UI、打包、目标兼容、目标 slots、真实 HTTP、模式和 scope 策略共 8 个测试文件、99 项通过；本轮完整 Office 组合的补充结果以 [Office Web 验证记录](office-web-plugin.md) 为准。真实浏览器测量 flow 面板与 PPT 按钮无重叠，按钮中心 elementFromPoint 命中按钮；普通点击关闭/重开、选择模板、预览及 Esc 关闭均通过，模板列表原生滚轮滚动正常（scrollHeight 1283、clientHeight 485）。生成客户端 119600 bytes，保持 120000 bytes 预算。认证回归覆盖 401/200、跨站 403、坏 JSON 400、预览 200/404、卸载清理及缺依赖恢复，保持既有传输路径。目标真实服务的隔离集成另已完成创建工程 → 校验 → 导出，生成 12 页、365 个原生对象的可编辑 PPTX；这不等同于在 3080 中完成一次真实模型生成对话。

本仓库 typecheck、build 和相关 PPT 回归已通过；全量测试受无关 desktop-modes-ui 的 CloudHistoryRow 组件循环告警影响，未通过，不能据此声称全仓测试成功。

## 发布版 Kit 与完整 Office 收尾验收

正常安装的 LibreOffice Kit 0.1.5 不提供开发环境实现中的逐页回调，但会返回完整图片 manifest。原预览代码误将无回调判为页数不符。本轮最小修复在无回调时严格验证 manifest 的总页数、图片数和页序后发布；已发生部分回调、空结果、损坏或倒序 manifest 继续拒绝，保留原有逐页性能、取消和释放路径。

[预览回归](../test/ppt-office-preview-progress.test.mjs) 13 项通过。使用真实 Profile Kit（入口 SHA256 5583ce1754084cb63be913e67821282f484a14b43744f777fd10731af67e3c60）只读运行完整隔离导入 worker，原 12 页输入成功生成全部预览，见 [原生导入记录](../.build/ppt-personal-native-fixed.log)。同一 Kit 也重新完成了 Word 编辑、版式校验、交付登记、PDF 转换，以及 Excel Python 编辑、缓存重算值 5、区域图片渲染，见 [运行收据](../.build/office-web-target-receipt/receipt.json)。这些本机运行证据位于忽略的构建目录，不作为维护源码提交。

修复包已通过官方卸载、安装、启用流程部署到同一 3080 服务，并在页面刷新后复验。原先失败的同一 12 页 PPTX 成功进入含 12 个版式的编辑器，保存为本会话唯一命名的临时个人模板，再经悬停删除入口和名称确认正常删除，原 16 套内置模板保留。最终 Office 与 PPT 均 enabled=true、fiberPhase=active；Word 公文案例可以直接选用。未发送付费模型请求。

预览兼容修复包的历史 tgz SHA256 为 9d0e21f3c0e9da0a42e54a5d9f8e46d5a08f47f79b9722f8bb2e0c708eaa49d4；后续布局更新后的当前 tgz SHA256 为 eb44fa11dd66cf3680327017dee5fa1e75ce16d8bc4cab89552aa39e6443f6dd。预览实现与维护源码 SHA256 均为 92b764fcfb7e0c14b09c86ad2e9c7d70034fa0ab2460455c7405fe643069ea19；当前客户端哈希见上文。修复后标准 build 与 typecheck 再次通过。

## 回退

独立安装失败时使用 Harness 插件管理停用/移除 composer，保留 kimi-ppt 数据、个人模板和产物。改用 A 时由 Web 服务部署加载一次相同 composer，并移除独立 bundle 声明。不迁入 Desktop 的启动或 Profile 修复逻辑。
