# 企业市场社区插件包导入

用户于 2026-10-16 确认移除专用 manifest 的导入要求。桌面目标为 `dataelement/bisheng-work:V1.2.0@7edfd09170c23b005c81a78b65a42360377fc87d`，安装 Harness 为 `0.2.0-rc.2`。后台配套目标为 `dataelement/bisheng:feat/bisheng-work-103@5beb3bc90b2728dbdee3ae373eda50a01583f1a2`。

## 验收范围

- ZIP 和 npm tgz 包提供 package.json 与运行代码，即可预览和导入。
- 插件名称、版本和依赖使用社区声明；系统保存派生元数据。
- 较旧版本、同版本内容冲突、目录越界、平台和依赖解析问题保留明确诊断。
- 安装在 enterprise generation 中准备依赖，真实 Loader 加载标准单入口和 dsh.bundle。
- 旧包、账号隔离、完整性检查和失败更新恢复继续可用。

## 实现边界

后台静态读取压缩包并保存原始制品。客户端在隔离 staging 中复用现有 pnpm generation 安装器，完成依赖准备、宿主解析与完整性校验后发布。企业 generation 使用独立目录和账号生命周期。

本次影响企业插件的安装与后端激活阶段。运行入口来自 generation 内的 package.json，宿主 peer 使用当前安装的 DSH entry。预发布版本按标准 SemVer 排序。宿主版本声明采用当前社区链路的兼容提示策略。失败保留原诊断和旧运行版本。

所需依赖通过客户端配置的 npm 源获取；内网使用可达企业源或 npm bundledDependencies。

## 验证

实际执行结果记录于本工作树 docs/STATUS.md 和主工作区交付证据。目标环境部署、真实企业账号、安装包与 Windows 验收分别记录。
