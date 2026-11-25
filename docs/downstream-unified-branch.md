# Desktop / Web 统一分支交接

最终交付目标为通过 PR 合入 main；codex/bisheng-unified 是临时集成与 CI 验证分支，不通过直接推送替换 main。

## 迁移来源

- codex/upgrade-dsh-0.2.2-rc.1-integrated：新版 Harness 与公共 Desktop/Host 双端底座、企业桌面生命周期接入。
- codex/web-minimal 与其祖先 codex/plugin-architecture：保留企业 Web 业务、离线启动、完整 Office/PPT Web 分发、工作台 Web 包后端及企业安装生命周期和回归。旧分支删除 Desktop 源码的做法不迁移；SDK 保持 0.2.2-rc.1。
- fix-enterprise-skill-name：保留显示名与内部隔离调用键分离、中文搜索、独立 description 和隐藏内部 alias，使用当前 SDK 的公开可选 displayName 契约。
- 上游通用能力经独立 PR 合入 bisheng-adaptor 后同步，企业登录、凭据与配额实现仍留在企业包。

## 可复现验证

维护输入以 package-lock.json 和标准原子补丁为准。Web 构建不使用开发机 Downloads、不隐式依赖其它 checkout、不静默省略 Office/PPT，也不在组装后动态 patch SDK。prepare-web-ci-inputs 准备生产依赖及完整原生资源，portable assembler 检查随包 Node、中文空格路径、启动、认证 HTML、bootstrap 注册与插件导入。完整 UI 与模型请求不能由静态注册预检替代。

CI 使用非 tag 开发验证，只上传 Actions 工件；不触发正式发布、签名凭据、ModelScope、通知或生产部署。正式发行继续沿用单独 workflow 的人审、原生目标、签名与校验门禁。

## 分支清理原则

只在 PR 合入及最终验证后删除已确认纳入的过程分支。提交历史通过重写/重放迁移时，不能只按 git cherry 判断功能缺失，也不能以文件同名推定全部等价；需以源码语义和相应回归确认。

origin/codex/usage-recovery 与 origin/codex/v120-unified-credits 已是原 main 祖先，可在最终 main 历史保留后清理。V1.3.0、V1.3.0-ui、cloud-workbenches-v130、workbench-package-install-v130、远程访问、运行中重命名等仍有独有功能，未逐项纳入前不得误删。最终交付只保留一个发布主干，不等于允许丢弃未合并开发成果。

当前修复前源码补丁与精确分支 SHA 的本地诊断备份位于被忽略的 .tmp，不能加入发布包或Git提交；实际验证结果与远端Actions链接在最终PR中记录。
