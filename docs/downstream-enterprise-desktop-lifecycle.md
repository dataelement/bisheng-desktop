# 企业插件的 Desktop / Web 接入

## 归属

公共底座提供产品初始化、Host 环境传递、明确主窗口及设置操作的扩展接缝；企业登录、凭据 broker、企业页面与账户状态全部位于 `packages/dsh-desktop-enterprise`。Web 使用现有服务器认证和代理，不需要导入 Electron 模块。

公共接缝经上游 PR https://github.com/dataelement/dsh-desktop/pull/875 与独立兼容修复 PR https://github.com/dataelement/dsh-desktop/pull/876 合入后同步到下游。企业入口通过 register 模块注册产品工厂，再加载公共 shell，不改公共启动流程或复制底座实现。

## Desktop 启动与桥

产品注册模块先注册 createEnterpriseProductRuntime，再加载公共 shell 入口。核心配置产品身份并取得单实例锁后，在启动 Host 前等待企业 broker 初始化；按本次初始化返回 hostEnvironment，不异步覆盖全局 process.env。企业 vault 目录使用上下文的 userDataPath，因此独立开发 Profile 不会误读正式版账号。

应用窗口由底座显式 attach，企业 IPC 拒绝其他窗口、子 frame、非 dsh-app://app authority。preload 对恢复页、导入页、远端页面和 Safe Mode 不暴露账户桥。settingsInfo/settingsAction 是具名桥，动作仅限检查更新、查看日志与安全模式，不暴露通用 invoke。

设置 launcher 复用核心 openSettings/openSettingsSection，settingsOpen 驱动原生页面显示边界。远端 Esc/焦点消息经白名单桥转给当前挂载的 close/focusShell 回调；审批对话框使用自己的导航和关闭按钮 refs。Web 按真实能力隐藏 Desktop 专属入口，不注册无功能的版本/更新页，不靠 DOM 查询模拟核心导航。

## 验证

企业行为回归：enterprise-client-bridge、enterprise-desktop-runtime、enterprise-desktop-preload、enterprise-product-patch。公共生命周期、设置与布局契约在上游单独验证，企业真实 UI 回归位于 enterprise-desktop-ui-runtime。

真实 UI 测试构建四个入口并创建临时独立 Profile，验证企业状态接口、桥、版本、账号菜单精确导航及原生 Esc；必须有显式成功标记，进程 exit 0 不足以通过。测试不使用真实企业账号，不调用付费模型，不修改正式 Profile。该用例证明未登录状态的加载与设置链路；真实企业登录后的平台服务、Windows 原生验收仍需单独进行。

执行项目规定的 npm ci（检查补丁重放）、verify:boundary、typecheck、build、web:pack、npm test 与 git diff --check。不要用 Harness 的 Electron Node shim 运行需要普通 Node 身份的测试；应选择环境中真实的 Node。
