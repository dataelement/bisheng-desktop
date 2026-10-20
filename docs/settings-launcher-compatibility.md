# 设置入口与账号兼容

Desktop 当前基于 Harness `0.2.0-rc.2`，普通模式和 Safe Mode 均禁用上游 `@deepseek-ai/dsh-client-ui-settings-account`（`ui-settings-account`）。这同时停用该插件的侧栏账号菜单、模型 onboarding 登录入口及账号设置页；不删除账号凭据或用户 Profile。

设置按钮、快捷键和外框继续由 `settings-general` 提供。普通模式由 `dsh-desktop-settings` 通过导航、行布局和插件页布局 slot 呈现员工常用设置，并把模型、Agent、执行偏好和技术插件清单收进高级区域。企业认证继续由主进程和 `dsh-desktop-enterprise` 提供；网页账号资料、用量及审批只以内容模式嵌入。Safe Mode 保留原有核心设置，不加载这项可选整合。

`settings.launcher` 的声明、出口和其他插件贡献保持原样。将来恢复上游账号功能时，需先解决单一账号入口与企业身份归属，再撤销组合层覆盖，避免同时出现两套账号设置。

整合边界及验收范围见 [统一设置](settings-integration.zh.md)。`test/settings-account-launcher.test.js` 验证两套组合层的禁用结果；`test/desktop-settings-view.test.mjs` 和 `test/desktop-settings-runtime.test.ts` 覆盖布局贡献及真实 Harness 脚本发现。上述测试不能替代已安装客户端、企业认证后的原生网页视图和 Windows 验收。
