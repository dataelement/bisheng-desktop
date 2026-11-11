# 下游候选分支 CI 验证

最终候选分支为 `codex/bisheng-unified`，合入目标为 `main`。以下三个工作流支持针对这两个分支的 push、以其为目标的 PR，以及手动 dispatch。使用前先核对远端对应 commit 的工作流，旧分支的 release 表单和副作用可能不同。

| 工作流 | 执行范围 | 外部写入 |
| --- | --- | --- |
| [verify-boundary](../.github/workflows/verify-boundary.yml) | Ubuntu，显式拉取上游 bisheng-adaptor，执行边界门禁 | 无发布 |
| [bisheng-ci](../.github/workflows/bisheng-ci.yml) | Linux x64 仅边界、类型检查与纯 Web JS 回归；Windows x64、macOS arm64/x64 执行构建、普通 Node 全量测试、原生 loader 和 unsigned package/afterPack 校验 | 无发布或 artifact 上传 |
| [build-web-runtime](../.github/workflows/build-web-runtime.yml) | Windows x64 原生组装、ZIP 完整性、解压后启动及 bootstrap 检查 | 仅 Actions artifact，保留 7 天 |

三个工作流均使用 `contents: read`，checkout 不保留凭据，固定 Node 24.15.0；构建依赖中的 pnpm 必须为 10.34.5。上游抓取失败会使门禁失败，不会回退到其他分支或吞掉错误。工作流不读取签名、发布或生产服务凭据，不创建 draft release，不调用 ModelScope、飞书通知或 rollout。Web 工作流不再以 tag push 触发正式发布。

## Windows Web 输入与验收

在干净 runner 执行完整 `npm ci`（包括 postinstall），然后准备独立的生产依赖树以及完整 Office/PPT Web 包。准备步骤不得依赖开发机 Downloads、离线基座或已有 node_modules；具体生产依赖和包生成契约由仓库维护的准备脚本负责。缺少 Office/PPT 入口、资源或原生依赖必须失败，不允许跳过。

[portable assembler](../ops/ci/build-web-portable.mjs) 接受五个显式绝对目录：

```text
--node-directory     含 node.exe 的目录
--modules-directory  已物化、无 symlink/junction 的 Windows 生产 node_modules
--office-directory   完整的 dsh-desktop-office Web 包
--ppt-directory      完整的 dsh-ppt-composer Web 包
--output-directory   尚不存在的产物目录
```

内置 node.exe 固定为 Windows x64 Node 24.15.0，下载后及组装时均校验 SHA-256。摘要来源为 [Node 官方 SHASUMS256](https://nodejs.org/dist/v24.15.0/SHASUMS256.txt)。不得通过运行时现查摘要来替代代码内固定摘要。

assembler 调用受控 staging 接口，生成仅含声明配置的 Profile 模板，产物不会覆盖旧目录。随后创建 ZIP、执行 `7z t`，再解压到带中文和空格的独立临时目录。实际验收从解压目录调用内置 node.exe：

1. 使用交付的 offline launcher 初始化独立 Profile。
2. 导入 Office、PPT 和三个企业共享插件，入口解析不得逃逸出产物目录。
3. 以 loopback 与 OS 分配端口启动真实 Web 服务。
4. 在内存交换启动凭据，检查认证 HTML、同源 bootstrap 响应及其实际模块注册。
5. 关闭运行时进程树，生成 ZIP 摘要与不含凭据的 verification JSON。

只有上述步骤成功后才上传 ZIP、摘要和 verification JSON。启动 URL、cookie 和 child 原始输出不写入日志或 artifact。打包阶段可以下载依赖；该验收保证交付 launcher 不执行在线安装，并不等于通过操作系统防火墙证明整个运行时无网络请求。

## 原生 Desktop 与剩余验收

保留 darwin arm64、darwin x64、win32 x64 三个原生 Desktop 目标，不以跨平台打包或源码 import 替代实际 target 检查。Office 原生输入仅支持 macOS arm64/x64 与 Windows x64。Linux 仅运行边界、类型检查及明确选择的纯 Web JS 回归，不调用会准备 Office 的 build 或 npm test pretest，也不声称 Linux 已运行全量测试或交付 Desktop。原生 payload 仍需通过现有 afterPack 的 Harness、依赖闭包、Office/PPT 和 native loader 门禁。

bootstrap 注册只证明客户端引导阶段。verification JSON 明确标记浏览器 UI 与模型请求验收尚未完成。发布候选仍需单独验收实际浏览器 UI 挂载、工作区/会话、企业登录、真实 Office/PPT 生成与打开，以及 Windows 安装/更新/恢复界面；签名、公证、正式发布和部署须遵循独立授权与发布流程。

本地行为测试使用独立 fixture 验证输入拒绝、字节摘要、插件导入失败、认证握手和 bootstrap 注册失败，不能据此声称 Windows 真实产物或远端 Actions 已通过。测试命令：

```bash
node node_modules/vitest/vitest.mjs run test/web-runtime-ci.test.mjs --maxWorkers=2
actionlint .github/workflows/verify-boundary.yml .github/workflows/build-web-runtime.yml .github/workflows/bisheng-ci.yml
```
