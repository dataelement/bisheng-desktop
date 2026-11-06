<h1 align="center">
  <img src="docs/images/readme-logo-black-v020.png" width="274" alt="BISHENG" valign="middle" />
</h1>

<p align="center">
  <strong>BISHENG 客户端是连接本地办公与企业 AI 的桌面 Agent。</strong><br />
  员工使用企业账号调用获准的模型、知识库、工具和技能，在 Chat 中进行云端问答与多步任务，在 Work 中处理授权目录里的本地材料；企业统一管理资源、权限、积分与用量。<br />
  <a href="https://dshdesktop.com/zh/enterprise/">下载 BISHENG 客户端</a> · <a href="https://github.com/dataelement/bisheng">BISHENG 服务端仓库</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.es.md">Español</a> · <a href="README.pt.md">Português</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

## BISHENG 客户端能做什么

- **Chat：把任务交给企业云端**。进行资料问答，或进入任务模式完成多步处理、调用技能、生成文件，查看任务进度与结果。
- **Work：围绕本地材料持续工作**。选择授权目录，整理材料、分析数据，生成可编辑的 Word、Excel 和 PPT，并根据反馈继续修改、保存到获准目录。
- **按权限使用企业资源**。使用企业账号调用获准的模型、知识空间、API/MCP 工具和技能，也可从应用中心打开企业已发布的应用、助手和工作流。
- **企业统一管理**。管理员集中配置资源与权限，分发插件和工作台，管理月度积分和调用用量；Chat 与 Work 的企业模型调用共用当前用户的积分账本。
- **网页与桌面协作**。同一企业账号在网页与桌面 Chat 中打开同一个服务端任务时，可同步查看任务事件与完成状态。本地 Work 的任务与产物按独立记录管理。

![BISHENG 网页端、桌面端与手机端展示](docs/images/bisheng-platform-overview.png)

> 手机 App 即将推出，具体功能与上线安排以版本说明为准。企业接入能力、部署要求及开源与企业版范围，以对应版本说明为准。

## BISHENG 平台与关联项目

**BISHENG 是开源的企业级一站式 Agent 平台**，专注办公效率与企业 AI 应用落地，为客户端提供模型、知识、工具、技能、应用及统一管理能力。

- [BISHENG 企业平台](https://github.com/dataelement/bisheng)：部署企业 AI 服务，集中管理组织的资源、权限与用量。
- [DSH Desktop](https://github.com/dataelement/dsh-desktop)：基于 DeepSeek Harness 的开源桌面 Agent 基础，BISHENG 客户端在此之上连接企业 AI 服务。

## 下载安装

从[BISHENG 客户端官网](https://dshdesktop.com/zh/enterprise/)获取安装包，配合企业部署的 BISHENG 平台使用。登录企业账号后，使用管理员已配置并授权的资源。

如需独立使用个人版，可访问 [DSH Desktop 官网](https://dshdesktop.com/zh/)。

## 办公文件与桌面能力

- **办公文件交付**：通过内置 PPT 模式选择模板、描述内容，生成可继续编辑的 PPTX；桌面运行环境携带 Python 与 Office 库，支持 DOCX、PPTX、XLSX 的生成和检查。模板与校验方式见 [PPT 说明](packages/ppt-runtime/README.md)。
- **本地工作区与配置**：通过系统目录选择器管理工作区；Profile、插件、会话和模型配置保存在安装目录之外，升级时保留。自定义配置的导入与导出见 [Preset 包格式](docs/preset-packages.md)。
- **更新与恢复**：当前安装版在线更新尚未启用，可从[官网](https://dshdesktop.com/zh/enterprise/)获取新版安装包；在线更新的开放以对应版本说明为准。插件异常时可通过 `Harness` 菜单的“以安全模式重启…”暂时屏蔽第三方插件，保留正常 Profile 的数据；诊断信息写入 `harness.log`。详细流程见[运行架构：插件恢复](docs/architecture.md#profiles-and-plugin-recovery)与[更新机制](docs/architecture.md#updates)。

## 手机连接与数据边界

桌面运行时保留扫码连接手机的方式：从 `Harness` 菜单选择“连接手机…”，WiFi 下扫码配对；使用互联网隧道时，还需输入电脑显示的连接密码。默认密码 5 分钟有效；只有明确勾选同意后才生成长效密码。桌面端断开连接后，手机会话随即失效。连接异常时可用“扫码打不开？换一条线路”切换线路。

这项浏览器配对能力与即将推出的手机 App 分开。Harness 运行在本机随机回环端口，手机访问通过独立的配对 Bridge；它不代表本地 Work 与企业云端任务自动同步。详见[运行架构：移动访问边界](docs/architecture.md#mobile-access-boundary)。

Renderer 不具备 Node.js 权限，并启用 Context Isolation 与 Sandbox；外部网页在系统浏览器中打开。Profile 与会话保存在用户级应用数据目录。详见[运行架构：窗口与 IPC 安全](docs/architecture.md#window-and-ipc-security)。

## 平台支持

| 平台 | 分发形式 | 状态 |
| --- | --- | --- |
| macOS Apple Silicon | 已签名并通过公证的 DMG/ZIP | 支持 |
| macOS Intel | 已签名并通过公证的 DMG/ZIP | 支持 |
| Windows x64 | 已完成代码签名的 NSIS 安装包 | 支持 |
| Windows ARM64 | — | 当前不支持 |
| Linux | — | 当前不支持 |

Harness 包含目标平台原生依赖，因此每一种正式安装包都在对应操作系统与架构上构建。

## 开发与架构

欢迎参与贡献。工程说明已拆分为独立文档：

- [开发指南](docs/development.md) — 本地环境、验证、补丁维护与原生平台打包
- [运行架构](docs/architecture.md) — 启动流程、持久化数据、安全边界、故障恢复、手机连接与更新
- [发布手册](docs/release-runbook.md) — 签名与正式发布控制
- [Preset 包格式](docs/preset-packages.md) — 可移植 Agent Preset 契约

提交修改前请运行 `npm test`、`npm run typecheck` 和 `npm run build`，并实际操作受影响的应用流程。请勿在 Issue、日志、截图或测试数据中提交真实 API Key。

## 社区

共享桌面基础能力的使用交流，可加入 [DSH Desktop Discord 社区](https://discord.gg/7Xgf3qe3Qp)，或扫描下方微信群二维码。

<img src="docs/images/wechat-group-20260815.png" width="220" alt="DSH Desktop 社区微信群二维码" />

## 许可证

DSH Desktop 采用 [MIT License](LICENSE) 开源。

DeepSeek Harness 及其依赖仍遵循各自的上游许可证与商标规则。DSH Desktop 是独立的社区桌面应用。

## 服务企业

BISHENG 已服务众多行业头部企业，以下为部分客户。

![汇丰银行、博世、屈臣氏、中国移动、中粮集团、首钢集团](docs/images/bisheng-customer-logos-row-1.png)

![中国宝武、中金公司、中国出口信用保险公司、中国石油、中国工商银行、重庆银行](docs/images/bisheng-customer-logos-row-2.png)

![中国电建、华泰证券、华夏银行、辽宁金控、中国民生银行、龙华资本](docs/images/bisheng-customer-logos-row-3.png)

![苏交科、中信银行、中英人寿、北汽集团、中债资信、中国气象局](docs/images/bisheng-customer-logos-row-4.png)

## 企业咨询

如需了解 BISHENG 企业部署、桌面客户端接入、产品演示或商务合作，欢迎联系我们。

[填写飞书表单，联系 BISHENG 团队](https://dataelem.feishu.cn/share/base/form/shrcnVow7GQwwKYEBCD41Bu5qoh)
