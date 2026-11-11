# BISHENG 桌面发布与安全验证

本文件记录私有 [release workflow](../.github/workflows/release.yml) 的产品路径、安全 development 验证与正式发布依赖。通用发布/签名/恢复步骤参见 [release runbook](release-runbook.md)。本轮只准备代码和命令；没有触发远程任务、读取密钥值、提交、push 或发布。

## 构建输入与产物

权威输入为 [package.json](../package.json) 的 build 与 dshDesktopIdentity，以及 [development 配置](../electron-builder.dev.cjs)。原生 runner 保持 macos-15 arm64、macos-15-intel x64、windows-2022 x64；Node 固定 24.15.0。私有 workflow 的少量显式 BISHENG 路径由 [企业契约测试](../test/enterprise-release-workflow.test.mjs) 与真实配置逐项比对；[产物验证器](../ops/ci/desktop-artifacts.mjs) 从构建输入派生清单，逐项检查，避免 Actions upload 多路径只找到部分文件也通过。

| 对象 | Release | Development |
| --- | --- | --- |
| Mac app | dist/mac-arm64/BISHENG.app、dist/mac/BISHENG.app | dist-dev/mac-arm64/BISHENG Dev.app、dist-dev/mac/BISHENG Dev.app |
| Mac DMG / ZIP / ZIP blockmap | dist/bisheng-mac-{arm64,x64}.{dmg,zip,zip.blockmap} | dist-dev/bisheng-dev-mac-{arm64,x64}.{dmg,zip,zip.blockmap} |
| Windows app | dist/win-unpacked/BISHENG.exe | dist-dev/win-unpacked/BISHENG Dev.exe |
| Windows installer / blockmap | dist/bisheng-windows-x64-setup.exe[.blockmap] | dist-dev/bisheng-dev-windows-x64-setup.exe[.blockmap] |
| Windows smoke userData | bisheng | bisheng-dev |
| 更新元数据 | latest.yml、各架构 latest-mac-{arch}.yml，发布前合并 latest-mac.yml | publish:null，不依赖 latest.yml |
| 未签名 Windows payload | dist/win-unpacked.tar.gz，供 UKey 签名重打包 | extended 检查后保留 dist-dev/win-unpacked.tar.gz 到独立 Actions artifact |

打包仍必须先执行 [verify-target](../scripts/verify/verify-target.mjs)。保留 [afterPack](../scripts/release/after-pack.cjs) 的 asar/Harness/PPT/Office 内容门禁；其 resources 路径从 productFilename 派生。[afterSign](../scripts/release/notarize-macos.mjs) 同样从 productFilename 派生 app 路径。Mac 保留 keychain、codesign、notarytool、stapler、spctl；Windows 保留全部 PE 扫描、UKey、NSIS 重打包、最终签名与元数据重算。没有通过改名为通用 DSH 产物、删验证或跳签名来绕过失败。

## 安全 development 验证命令

在当前 integration 分支的改动经审核并由有权限的人 push 后，执行以下命令。若已合入 main，把 --ref 与 --branch 改为 main。以下命令仅作为可执行操作记录，本轮未执行。

~~~bash
release_repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
gh workflow run release.yml --repo "$release_repo" --ref codex/bisheng-unified \
  -f mode=development -f target=all -f checks=extended

gh run list --repo "$release_repo" --workflow release.yml \
  --branch codex/bisheng-unified --event workflow_dispatch --limit 5
# 从上面的列表读取本次 RUN_ID 后执行：
gh run view RUN_ID --repo "$release_repo" --json jobs,conclusion,headSha,url
# 成功后可下载本次 Actions artifacts：
gh run download RUN_ID --repo "$release_repo" --dir artifacts/desktop-development
~~~

不要填写 version 或 source_run_id；development 的 shell guard 会拒绝它们。必须使用分支 ref（当前 integration 或 main），避免选到 v* tag，因为 tag 本身代表正式发布意图。workflow 默认 mode=development、target=all，但命令显式指定，便于审计。

预期执行 jobs 为 Validate dispatch inputs、macOS Apple Silicon、macOS Intel、Windows x64。后四个 job id sign-windows、publish-signed-test、publish、publish-prerelease 必须 skipped。Mac 两架构原生构建，arm64 执行共享 typecheck/测试；Windows extended 执行全量 parallel/serial 测试、三尺度恢复 UI、真实打包应用 koffi/pnpm/Harness/工作区与会话 smoke、归档与 gzip/tar 验证。上传 macos-apple-silicon-dev、macos-intel-dev、windows-x64-dev、windows-x64-dev-unpacked 及安装计时/恢复 UI 证据。Windows smoke 复制到仓库外独立目录运行并回收该副本进程。

非 tag development 的输出仅为 Actions artifacts：不创建/更新 GitHub draft/release，不上传 ModelScope，不发飞书，不调整 rollout，不访问签名密钥。默认 contents:read；只有正式 release / prerelease jobs 获得 contents:write，签名和下载 job 按需 actions:read。PR target 为 main。

## 通用产品 API 与上游同步

此前发现的品牌接口缺口已在上游隔离 checkout 实现并验证，最终由父 agent 统一提交、评审和同步。根工作区不直接修改底座；私有 workflow 已显式传入以下参数，须与对应上游 API 同步交付：

| 通用文件 | 新接口 | 保留的原行为 |
| --- | --- | --- |
| [verify-release-assets.mjs](../scripts/verify/verify-release-assets.mjs) | --artifact-prefix bisheng；库接口 options.artifactPrefix，默认 dsh-desktop | 同一名称映射驱动全部必需文件和三个更新 metadata entry；文件头、最低尺寸、版本、size、sha512 检查全部保留 |
| [sign-windows-unpacked.mjs](../scripts/release/sign-windows-unpacked.mjs) | JSIGN_NAME=BISHENG、JSIGN_URL=https://www.dshdesktop.com，交给已有 buildJsignArgs；省略仍为 DSH 默认值 | PE 扫描、厂商签名保留、ETOKEN、SHA-256、时间戳、重试和签名提取校验保持不变 |
| [signed_test_build.py](../.github/scripts/signed_test_build.py) | --artifact-prefix bisheng --product-name BISHENG，省略保持 DSH 兼容 | 非空文件、真实 Git 变更来源、上传后公开 URL 的 Range/Content-Length/首字节验证、失败禁止通知 |
| [release.test.ts](../test/release.test.ts) | 通用 workflow 路径断言从真实 package/dev 配置派生，默认产品仍保留原精确断言 | 没有 skip 或降低签名/隔离/发布要求；配合新增 generic product-release 套件验证正反例 |

artifact-prefix 限制为最多 64 字符的小写 ASCII 字母/数字与单连字符分段；拒绝路径、URL、凭据、空白、点号和 Windows 保留名。产品展示名限制为最多 80 字符的安全纯文本。JSIGN_URL 必须为无凭据、无 query/hash 的 HTTPS URL。没有 CLI 参数可关闭完整性验证或降低生产最小尺寸。公开下载探针原本只验证可访问性与尺寸，不应描述成远端完整 SHA 校验；正式发布的 size/sha512 由产物验证器独立保障。

已核实无需品牌路径 API 改动的消费者：[archive-windows-release](../scripts/release/archive-windows-release.mjs) 接收目录、保留固定 win-unpacked archive 结构并验证 gzip/tar；[finalize-windows-release](../scripts/release/finalize-windows-release.mjs) 查找唯一 installer，重新计算 blockmap/size/sha512；[merge-mac-update-metadata](../scripts/release/merge-mac-update-metadata.mjs) 依据 metadata URL 的架构与 ZIP 后缀合并；[inject-popup-notes](../scripts/release/inject-popup-notes.mjs) 操作标准 latest feeds；[validate_publish_source](../.github/scripts/validate_publish_source.py) 检查 tag SHA、来源运行、当前 attempt 成功 jobs 和 signed artifact ID；[append_version_index](../.github/scripts/append_version_index.py) 从现有 catalog 追加、失败不清空历史。这些 gates 全部保留。

ModelScope repo_id 与更新源仍保留现有显式配置；不能在没有产品部署事实的情况下猜测替换目标。[package.json](../package.json) 中 https://dshdesktop.com/work/updates/latest/ 与当前 workflow 的 ModelScope 镜像之间是否已有网关映射，需要正式发布前由维护者确认。该检查不能用本地路径契约证明。

## 本地验证与远程验收边界

~~~bash
npx --no-install vitest run test/enterprise-release-workflow.test.mjs
npx --no-install vitest run test/release.test.ts
git diff --check
~~~

新增测试真实解析 YAML（拒绝重复 key）、执行 job/step 条件矩阵、执行 dispatch Bash guard、用命令 stub 验证 verify-target 失败后不会打包，并使用临时产物逐项检查缺失/空文件失败。当前新增 8/8 通过；连同 release-ci-scheduling、release-publish-recovery、archive-windows-release、finalize-windows-release、verify-release-assets 六份相关套件共 49/49 通过。同步前根工作区继承 release 套件曾为 29/31，失败为两个旧品牌硬断言；经授权在上游通用测试中改为配置派生后，上游默认 release/signing/signed-test/asset-verifier 与新增 product-release 五套共 50/50 通过，上游 typecheck 通过。上游同步后须在根工作区重跑全部相关测试，不能把隔离 checkout 的结果冒充最终 main 验证。

本地测试不证明 Apple 凭据、公证、UKey、原生 Windows 安装与完整 smoke、Feishu 人审回调、ModelScope 公开下载、网关回源或最终 main 的 CI 成功。完成上游 API 同步及根工作区回归后，先跑分支 development/all/extended，审核 PR 合入 main，再验证 main 的同一安全 dispatch；正式 tag/显式 publish 仍需来源身份绑定、产物完整性、Feishu 人审、popup 注入、历史归档与 rollout 门禁。
