# Office Web 插件迁移

## 范围与界面

Office 使用现有 dsh-desktop-office 维护源，PPT 继续使用 dsh-ppt-composer adapter；没有替换成另一套简化模板组件。原 Desktop 组合同时加载这两个包，上一轮独立 Web 试验只迁了 PPT。

现代 Harness 移除了旧 hero.modeActions、hero.dock、input.accessory 和 userMessageFooter。空白会话的 PPT、Word、Excel 模式按钮注册到 hero.options，同一行排列在输入框上方。新增 [ui-conversation 输入区插槽补丁](upstream-patches/ui-conversation-input-slots.patch) 后，已选模板缩略图通过 input.inside 位于输入卡内编辑器左侧；模板面板通过 input.after 位于输入卡下方，与 main 的排列一致。面板采用正常文档流并限制最大半屏高度，未复制 main 的绝对定位实现；无新接缝的现代宿主回退原 input.dock 上方面板，旧宿主保持原路径。

已在实际 3080 通过官方插件管理更新并刷新，实测 Word/PPT 选择缩略图在输入卡内、模板面板在输入卡下且宽度与卡一致；Excel 工作表预览、PPT 预览与焦点恢复、模式互斥及较窄窗口按钮命中正常。无会话时 hero.options 由宿主隐藏，需进入标准空白会话。当前 Office tgz SHA256 为 3d3ca75ab5bf831a0628ded4bf41d2e44b3a13bd7618326d89023e9168a18b99，PPT tgz 为 eb44fa11dd66cf3680327017dee5fa1e75ce16d8bc4cab89552aa39e6443f6dd。

| 模式 | 原有案例 |
| --- | --- |
| Word | 会议纪要 · 发布会筹备；中国现制咖啡市场调研报告；小米汽车研究报告；公文写作 · 通知 |
| Excel | 年度经营与客户分析；青岚港货物流向与作业效率；荧光酶活性筛选与批次质控 |

原有 7 个业务技能与 7 个官方 Office 技能、Word 双页预览、Excel 工作表导航、原生模板复制与编辑、PDF 导出、表格重算和图片渲染均在迁移范围内。Word/Excel 不新增原版没有的个人模板上传功能；PPT 继续保留原有个人模板管理。

## 构建与部署边界

```bash
npm run office:web:pack
npm run ppt:web:pack
```

构建从唯一维护源生成 .build 下的分发目录与 tgz，不提交生成包、Python 运行时、预览副本或来源哈希清单。Office 包内包含模板资源、官方及业务技能、与目标服务端平台相符的 Python 依赖；不依赖 Desktop 安装资源、开发 cwd 或全局 Python。独立 Web 入口使用原生 Node CLI 调用 LibreOffice Kit。官方能力代码按锁定来源在构建时编译为 vendor 模块，Cordis、Harness 工具/技能等宿主服务保持外部 peer，不打包第二份宿主单例。

浏览器平台与服务端平台是两回事。当前实际目标是 macOS arm64 的 3080 Node Web 服务；其他原生平台必须按已锁定的 runtime target 单独构建并验证，不能由本次 macOS 结果推断 Windows 或 Linux 已通过。

模式状态使用宿主 dshHomePath(office-web) 数据锚点。Office 自身保持独立；PPT 活动时通过私有小协议桥接其模式服务，停用 PPT 后继续使用 Office 持久状态，恢复时根据交接基线保留最新选择。不会在插件包、模板资源或用户工作区写模式快照。

## 宿主前置与现代消息引用接缝

目标 Harness 基线为 05b1cae8db6e674c5685101494d4eec24652424a。PPT 依赖的用户态 punycode/ 在该 alpha 宿主中需要 [Profile 解析修复](upstream-patches/profile-resolution-directory-specifier.patch)；完整现代历史引用需要 [ui-chat 引用出口补丁](upstream-patches/ui-chat-user-references.patch)。两份源码补丁分别维护并在当前 3080 已构建应用，不依赖忽略目录中的试验副本。引用出口的重放、构建和降级说明见 [消息引用迁移说明](office-web-message-references.md)。

首条真实用户消息的模板引用需要新的公开 conversation.chat.user.references 列表插槽，owner 携带 durable messageId。旧 user.before 是单选来源链，不能用于两个独立插件同时渲染模板引用，否则会互相遮挡。新增引用出口位于用户内容后，保持原来源链不变。

Office 与 PPT 通过公开会话模型定位首条真实用户消息，历史尚有未加载分页、pending/echo 或没有持久身份时不装饰；不能用重复或缺失的 rpcId 冒充消息身份。未部署这一宿主接缝时不得宣称现代历史模板引用已恢复。旧宿主继续保留旧 footer 适配。

## 验证记录

目标 0.2.2-alpha.3 的真实 Agent、Session、Tools、Skills、FsLocal、WorkingDirectory、Seatbelt Sandbox 与 LocalSubprocess 隔离服务栈已执行：

- load_workspace_dependencies 返回包内 Python 与完整科学/Office 库。
- office_template → office_template_write 修改原生 Word，通过嵌入字体、页眉页脚、页面几何、边框、样式与可编辑机关标题校验。
- 原生 Excel 模板复制，使用包内 openpyxl 修改并加入公式 =2+3。
- 原生 Node CLI 将 Word 导出 PDF，将 Excel 公式缓存重算为 5，并生成表格区域图片。
- 真实 present 工具执行管线完成交付登记；插件销毁后恢复原 agent 工具层。
- stock → Web 与 Web → stock 双向组合及分别销毁验证；真实 PPT 外部选择、停用、离线 Office 变更及恢复交接验证。

上述是隔离服务栈与真实文件处理结果，不等同于在 3080 发起过一次真实付费模型生成。

3080 已通过官方插件管理从本地 tgz 正常安装并启用 Office；Word 4 套与 Excel 3 套案例全部显示，4 张 Word 封面均加载，Word 双页预览与翻页、Excel 年度经营案例的 6 个工作表入口与 20 页预览导航、做同款、悬停取消与重新选择均已实测。刷新能恢复选择。

真实独立生命周期已双向验证：卸载 PPT 后 Office 的 Word 案例仍能独立改选并在刷新后保留；恢复新版 PPT 后，Office 离线期间的新选择没有回退。停用 Office 后仅 PPT 控件保留且仍可展开模板，重新启用恢复三个模式并保持互斥。PPT 的 16 套模板、已选缩略图预览与 Esc 关闭保持可用。

正常和窄屏下模式按钮中心命中正确，无横向溢出；系统深色媒体切换使 Office 前景 token 从 rgb(15,17,21) 变为 rgb(249,250,251)，测试后恢复原媒体和窗口尺寸。

当前认证页面的实际模块图与脚本响应包含 Office、PPT 和新增 ui-chat references 接缝；已刷新实际 3080 页面验收，不依赖另一台开发服务器。本轮布局更新后，Office 安装目录与生成目录的 client SHA256 均为 b70ef1212bcd4d4c7a9988f3315c4884c3f63b7ebf5005c56fe1631ad142e6cf。未设置 DSH_HOME 的当前服务，其 Office 数据实际保存在用户 DSH home 的 office-web 目录。

Office 后端和打包回归 47 项与额外 native-target guard 通过，Office/PPT 客户端 4 文件 78 项通过，PPT 集成/打包/兼容/真实 HTTP 补充 40 项通过；这些分批结果不合并计算成全仓总数。typecheck、标准 build、git diff --check 通过。全仓测试此前受已有 desktop-modes-ui 的 CloudHistoryRow 循环告警影响而停止，未声称全量通过。预览兼容修复后，再以真实 Profile 正常安装的 Kit 复验完整 Word/Excel 原生链路通过，[运行收据](../.build/office-web-target-receipt/receipt.json) 记录了实际 Kit 入口与 SHA256。PPT 的同一 12 页文件在 3080 成功导入、保存和确认删除临时模板，额外 13 项预览回归通过。最终 PPT 产物和兼容结果见 [PPT Web 记录](ppt-web-plugin.md)。

主要变更回归入口包括 [Office 模式桥](../test/office-web-modes.test.mjs)、[Office 状态交接](../test/office-web-handoff.test.mjs)、[真实 SlotRegistry](../test/office-harness-slots.test.mjs)、[Word/Excel UI](../test/office-templates-ui.test.mjs)、[PPT 集成](../test/ppt-integration.test.ts)、[PPT 个人模板 UI](../test/ppt-personal-template-ui.test.mjs) 和 [PPT 原生预览](../test/ppt-office-preview-progress.test.mjs)。[真实目标服务探针](../test/office-web-target-probe.mjs) 支持通过 DSH_OFFICE_KIT_ROOT 指定只读 Kit 物理根，并将实际入口哈希写入本机收据。

## 回退

使用官方插件管理停用或移除独立 Office 包，保留模板选择数据、个人模板和产物。更新前保留 Profile 依赖配置快照，但不能用旧完整配置盲目覆盖用户后续变更。若改为随服务部署，使用同一维护源生成资源，确保独立 bundle 与服务内置组合只启用一份。
