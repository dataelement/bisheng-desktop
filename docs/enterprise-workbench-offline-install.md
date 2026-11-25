# 企业工作台离线安装：现状与修复契约

## 结论

当前企业工作台 TGZ 导入不是离线安装。企业市场下载/校验成功后，Plugin Manager 仍通过 pnpm 安装本地归档；普通依赖和自动 peer 解析可以访问 npm registry。内网市场可达不代表 npm 外网可达。`EAI_AGAIN` / `ENOTFOUND` 是该阶段的 DNS 错误，不能靠重试保证离线可用。

本次未提供实际故障 TGZ，因此不能断言其中所有依赖已带齐，也不能只凭报错断言 schemastery 是 dependencies 还是 peerDependencies。

## 已核对链路

- 企业入口：`packages/dsh-desktop-enterprise/workbench-install.js` 将校验后的路径、包名、版本及替换状态传给 `manager.installBundle`。
- 当前安装的 Plugin Manager：`node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js` 的 backend.install 请求透传 registry，但没有离线策略字段。node_modules 只作为诊断证据，不是修复维护入口。
- Web：`packages/dsh-desktop-workbenches/web-package-backend.mjs` 使用 pnpm add file:，禁用脚本，但未禁用联网与自动 peer 安装。
- Desktop：`packages/dsh-desktop-market-installer/generations/installer.mjs` 支持显式 autoInstallPeers，但缺少强制离线策略；缺失普通私有 peer 时还会执行第二阶段 install。

## 隔离复现（本地 macOS，pnpm 10.34.5）

使用新建空 store、仅声明 `@deepseek-ai/schemastery@3.19.0` peer 的本地 TGZ，以及返回 404 的本地 HTTP registry，不访问真实 npm：

| 参数 | registry 请求 | 退出码 |
| --- | --- | --- |
| 当前默认安装语义 | `/@deepseek-ai%2Fschemastery` | 1 |
| 增加 `--config.auto-install-peers=false --offline` | 0 | 0 |

第二项只证明无普通依赖样例可离线解包安装；仍有 missing peer 警告，未证明宿主 peer 投影、模块加载、激活与 UI 成功。不能作为完整产品验收。

## 必须落实的修复

### 底座层（先在上游修复并合入）

1. Plugin Manager 提供显式离线安装策略契约，校验后透传给 Desktop/Web package backend；不依赖机器 npm 配置或继承环境变量碰巧生效。没有该契约时拒绝宣称离线安装，禁止静默回退在线安装。
2. 两端所有安装阶段一致执行离线策略：禁止 registry 元数据请求、自动 peer 下载及缺少私有 peer 的在线补装；不能只处理第一次 pnpm add。
3. 宿主 peer 从当前安装的宿主闭包校验并连接；保留现有共享单例、版本检查及 Profile 解析边界，不把 React、Cordis、Harness 复制进插件。
4. 普通依赖必须由工作台离线产物携带完整闭包，不能借开发仓库 node_modules 或 pnpm 缓存。缺失依赖立即报告包名和阶段，保留原 generation，不启动在线补救。
5. 拒绝会联网的 git/URL 依赖和未受控安装脚本；仅设置 --offline 不能证明任意生命周期脚本不联网。原生依赖按目标 OS/架构提供，不能把 macOS 成功视为 Windows 成功。
6. 沿用 Manager 的 staging、身份校验、原子 publication、失败回滚与 application 状态语义。不要在企业层直接解压覆盖 Profile、替换 backend 或修改 node_modules。

### 企业层

- 上游契约可用后，企业安装入口强制请求离线策略，并验证 Manager/backend 能力版本。
- 发布侧输出自包含 TGZ（bundleDependencies/构建内联或正式支持的离线产物协议），包含普通依赖完整传递闭包、目标平台资源与完整性元数据；宿主依赖保留 peer，不随包重复分发。
- 已上架的缺闭包历史包必须重新构建并发布新版本，保留旧版本恢复入口；只改客户端无法补出归档内不存在的普通依赖。
- 显式传入受控内网 registry 可作为改源方案，但它仍需要网络，不能称为离线修复。

## 验收门槛

- 清洁临时 Profile、全新空 pnpm store、不可访问外部网络，TGZ 下载准备完成后安装阶段网络请求数为 0。
- 覆盖宿主 peer 已具备/缺失/版本不兼容、普通依赖齐全/缺失、私有 peer 齐全/缺失、git/URL 依赖、脚本、更新失败回滚。
- 分别验证 Desktop 与 Web：安装、Profile 投影、真实 Host import/apply/activate、客户端发现、bootstrap 和 UI 挂载。
- Windows 原生验证 junction、文件占用、平台依赖；安装包重建后再验证，不能用源码测试替代已发布版本验收。

## 当前交付状态

完成代码链路诊断及空缓存最小复现，尚未修改生产安装行为。公共安装器与 Manager 属于底座，依据下游边界必须先走上游修复/合入再同步；没有绕过边界给企业入口增加伪离线开关。未执行正式应用安装、Windows 或实际故障包验收。
