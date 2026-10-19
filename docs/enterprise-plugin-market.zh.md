# 企业插件市场：在线席位访问

2026-10-19：持有有效席位的员工连接企业服务，在设置的插件页查看“来自企业”，安装和使用本企业插件。退出账号后收起入口，切换企业后读取对应目录。页面支持中英文、失败重试及每个插件独立的操作状态。

## 实现

Electron 主进程持有企业凭据，经限定的 `/v1/market` Broker 请求已确认的同一企业服务。BISHENG 员工目录、能力查询、下载和同步复用 Desktop 身份与在线席位校验；后台导入继续使用平台租户管理员认证。

市场采用 `contract_version=2`。capabilities 返回企业与同步参数；sync 返回包含 tenant_id、user_id、device_id、synced_at 和插件发布状态的普通 JSON。客户端校验当前账号、企业、设备、版本和摘要，将响应保持在内存。部署复用既有企业服务配置。旧 public_key 和 lease 缓存在升级加载时清理，已安装插件及用户配置按账号保留。

入口显示前在线确认席位，设置按既有 5 秒间隔刷新；后台按 60 秒同步。席位回收、会话过期或连接失败时收起入口并停用运行实例，重新确认成功后按用户启用状态恢复。会话到期使在途操作失效。服务端 API 在每次员工分发请求中校验席位。

插件包保留 ZIP 摘要、文件清单、解压路径、平台兼容、宿主 peer 依赖及安装后文件完整性检查。插件 generation 保存在 `profiles/.enterprise-generations`，由真实 Cordis Loader 加载；更新失败恢复旧版本。安装、更新和启用均在线复核。安装版本、缓存、配置及异步响应按账号与企业隔离。

## 制包

准备生产依赖目录，在 JSON 中定义 plugin 元数据和 targets（平台到准备目录的映射），执行：

```sh
node scripts/pack-enterprise-plugin.mjs release.json plugin.zip
```

plugin.desktop_min 按实际宿主能力声明。客户端以 Electron app.getVersion() 提供的版本执行标准 SemVer 检查，界面与安装器共用兼容性判断。管理员导入 ZIP 并发布后，本企业持有有效席位的员工可安装。

## 协同升级与验证

本次基线为 `dataelement/bisheng-work:V1.2.0@e9f206331d9ff5a1e36ffdb29ab7403881dc6bb2`，Harness `0.2.0-rc.2`。BISHENG 对应基线为 `feat/bisheng-work-120@ea1a3a6bfae06b4037b6f0720abe0c5ed7d0bf2c`。两端一起合入并发布协议 2；版本不匹配时提示协同升级，待协议匹配后开放入口与安装。

自动验证覆盖有效席位安装、席位回收、断线停用、会话到期、账号切换、旧缓存清理、页面入口和插件操作、包完整性、真实 Cordis Loader 及更新回退。`test/helpers/enterprise-backend-smoke.mjs` 可与真实 BISHENG ASGI 路由、SQLite 事务和测试对象存储联调，身份使用显式测试注入。实际执行结果见 docs/STATUS.md。

真实企业 Gateway、发布后的 Desktop 安装包、Windows 原生路径及文件占用验收分别执行。卸载和更新修改账号安装记录；冷启动时由现有清理流程按全部账号引用回收 generation。停用版本、其他账号仍安装的版本、tombstone 和审计日志保留。
