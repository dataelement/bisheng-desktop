# BISHENG dsh-desktop/main 同步（2026-10-23）

合并基线：BISHENG `4abe042e`，上游 DSH Desktop `a170609b`。Harness 从 `0.2.0-rc.2` 升级到 `0.2.1-rc.2`（Cordis / schemastery 随上游升级）。应用版本继续为 `1.0.1`，本次同步不触发发布。

## 产品边界

保留 BISHENG 的 `appId` `io.bisheng`、产品名 `BISHENG`、协议 `bisheng`、数据目录 `bisheng` / `bisheng-dev`、手机与 Harness 端口，以及更新地址 `https://dshdesktop.com/work/updates/latest/`。不采用上游 `0.12.1`、`io.dsh.desktop` 或公开更新目录。

不导入其他 Harness 产品的数据目录。企业插件与工作台策略、社区插件禁用、在线更新走 BISHENG 通用源。桌面更新不再恢复已删除的版本目录，也不恢复公开 DSH 的指定版本回滚。发布继续使用 Intel runner、keychain lease、draft Release 和 ModelScope 渠道；制品名保持 `bisheng-*`。

工作台默认关闭，只有本地存储恰好为 `true` 时启用。通用设置里不注册工作台开关。企业工作台目录、本地安装和企业市场安装授权保留。

宿主依赖回退只处理模块缺失：ESM 的 `ERR_MODULE_NOT_FOUND` 和 CommonJS 的 `MODULE_NOT_FOUND`。包导出边界 `ERR_PACKAGE_PATH_NOT_EXPORTED` 仍不回退到宿主副本。

## 补丁生命周期

删除全部 `0.2.0-rc.2` 与 `cordis-plugin-loader@1.0.5` 补丁，以上游 `0.2.1-rc.2` 补丁为底，另保留 libreoffice-kit、pi-ai、node-pty、dsh-settings 和 `cordis-plugin-loader@1.0.6`。官方已经提供的文案和入口不再机械重放。

在 0.2.1 上重新补上的企业差异：Harness 宿主依赖里的企业包、模型显示名与失效恢复、对话发送前的模型空态、企业失败文案、欢迎页文案、侧栏品牌、插件策略文案、插件开关授权与 schedule 回滚、会话运行态证据、文件夹打开候选路径，以及旧 Dispatcher 的对象响应头。

## 验证

在独立 worktree `codex/sync-dsh-main-20261023` 上执行，未改动原工作副本。

- `npm ci`：34 个补丁全部应用成功
- `npx tsc --noEmit` 通过
- `npm run build` 通过
- `npm test`：275 个文件通过、2 个跳过；2671 个测试通过、3 个跳过
- `git diff --check` 通过

未验证：Windows 安装与进程行为、Intel macOS、正式签名与公证、真实企业登录、安装包内的企业市场安装，以及认证后的真实浏览器 UI 挂载。
