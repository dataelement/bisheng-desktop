# 企业插件 generation 存储与恢复

## 修复背景

旧版企业市场对 npm 包复用公共 installGeneration，直接将结果保存在 profiles/.generations/live；安装引用却只写入 enterprise-market 的账号记录，不进入公共 desired.json / Profile 投影。冷启动公共 sweepRegistry 看不到企业引用，可能删除仍被企业市场使用的 generation。后续校验和恢复加载出现 ENOENT。

本次修改只位于企业插件及企业回归文件，没有在下游改公共 installer、公共回收器或壳启动顺序。

## 新安装流程

1. 创建 profiles/.enterprise-staging 下独占的安装工作目录。
2. 在工作目录中的隔离 installer-home 复用公共 pnpm installer，避免向真实公共 live 发布临时 generation。
3. 从真实 Profile 传递构建脚本授权策略；保持 strict dependency builds 和禁止自动安装宿主 peer 的规则，不隐式批准脚本。
4. 将安装结果移入 profiles/.enterprise-generations 下未发布的 staging 目录。
5. 在真实 profiles 祖先目录下重新验证宿主 peer、普通依赖闭包和文件完整性，保存原包与 inventory 摘要，更新 generation 元数据。
6. 原子 rename 为独占的最终 generation，再写入企业安装记录并激活。

最终存储仍以 profiles/node_modules 为正常解析祖先，不复制宿主单例，不引入全局 NODE_PATH、额外 loader fallback 或仓库目录解析。

旧版离线 ZIP 和新版 npm 包统一使用 profiles/.enterprise-generations，由企业安装记录管理；公共 generation 回收器不扫描这个目录。

## 已有安装与缺失目录

每次启用前先检查当前企业账号和精确版本授权：

- 已有企业专属目录且完整性有效：按原路径加载。
- 旧公共 live 目录仍在：先校验原安装树，再用其保存的原始包在企业专属存储重新安装；切换安装记录，不改插件配置，不就地移动或删除正在使用的原目录。
- generation 根目录已不存在：仅重新下载安装记录中的 plugin_id / version_id 对应原包，校验原 digest，再恢复到企业专属存储。不自动选择最新版或降低版本。
- 现存目录是软链接、目录内文件校验失败、原版本不再授权：拒绝加载，不静默覆盖或绕过完整性。
- 恢复过程中账号、租户或操作代次变化：拒绝发布到当前账号记录，不加载旧账号插件。

恢复会保留原插件配置、启用意图、用户/租户归属和版本授权标识，只更新物理目录、generation_id 与重新校验的 integrity。安装记录按既有原子保存流程持久化。原包不可获取、依赖安装失败或权限不足时保留失败状态和原记录，便于后续重试，不清空 Profile。

如果企业原包已经下架或原版本授权撤销，自动恢复不会越权进行；需通过正式企业市场选择仍获授权的版本处理。

## 当前交付状态

代码修复不会直接重建用户已经丢失的目录。用户启动包含本修复的开发版/正式版并保持企业登录后，由企业市场同步触发恢复。恢复需要企业服务及必要依赖源可达；后台请求成功不等于插件已经激活。

提交整理时已运行生命周期与安装相关回归，覆盖专属目录在公共冷启动清理后的保留、旧公共目录迁移、缺失目录恢复、篡改拒绝、账号切换中断、错误原包拒绝，以及企业市场恢复后的记录持久化。类型检查和桌面构建通过；全量回归仍有沙箱环境及其他模块失败，边界门禁仍报告分支相对上游的既有漂移，Web 打包因当前 Node 版本不满足脚本固定版本要求而未完成。源码与临时 Profile 验证不替代真实冷启动、网络恢复或 Windows 验收。
