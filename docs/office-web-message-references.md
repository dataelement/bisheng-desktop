# Office Web 消息引用迁移接缝

现代 Harness 不再提供旧版 `conversation.chat.userMessageFooter`。现有 `conversation.chat.user.before` 是按来源选举一个组件的 chain；普通用户消息的 durable source 可以只有 `{ kind: 'user' }`，rpcId 也可能重复。因此仅凭 source 无法定位首条消息，而且 Office/PPT 同时占用 chain 会遮挡其他来源装饰。

## 公开接缝

独立源码补丁见 [ui-chat-user-references.patch](upstream-patches/ui-chat-user-references.patch)，基于 Harness commit `05b1cae8db6e674c5685101494d4eec24652424a`，仅修改 `@deepseek-ai/dsh-client-ui-chat` 的源码、类型、测试及双语文档，不包含其他 resolver WIP。它不是旧版本的 patch-package 补丁，不会被当前 Desktop postinstall 自动应用。

新增 `conversation.chat.user.references` list/session，owner 为公开导出的 `UserReferencesOwnerProps { source, kind, messageId? }`。outlet 位于普通持久化用户消息内容后、actions 前；没有真实 messageId 的行、steering、pending 和本地 echo 不渲染。原 user.before chain 的 owner 与语义不变。

Office 和 PPT 各自注册 list 贡献，通过框架提供的 `useChat` 读取公开 Chat 顺序/节点，以首条真实 human 的 messageId 判断身份，并要求 `useSession(session => session.hasMore) === false`。历史分页尚未到头时隐藏引用，不将当前窗口第一条误认作会话开头。模板内容来自对应 session 的插件 store，不伪造 leading，不读取私有 React state 或私有 DOM，不以 rpcId 定位消息。

## 重放与构建

设置 DESKTOP_ROOT、HARNESS_ROOT 后执行：

```bash
PATCH_FILE="${DESKTOP_ROOT:?}/docs/upstream-patches/ui-chat-user-references.patch"
git -C "${HARNESS_ROOT:?}" apply --check "$PATCH_FILE"
git -C "${HARNESS_ROOT:?}" apply "$PATCH_FILE"
```

在 Harness 根目录运行：

```bash
pnpm exec tsc -b packages/client/ui-chat/tsconfig.json
pnpm --filter @deepseek-ai/dsh-client-ui-chat run bundle
pnpm run build:check
pnpm exec vitest run packages/client/ui-chat/tests/user-origin-slot.client.spec.tsx packages/client/ui-chat/tests/chat-view.client.spec.tsx
pnpm run verify-translation-pairing packages/client/ui-chat/README.md
```

Desktop 的 Office/PPT client 仍由各自既有 pack/build 链路分发。本次 PPT 生成客户端为 119,600 bytes，低于 120,000-byte 预算；仅压缩私有 JSX 编译绑定，未删除模板管理功能。ui-chat 不涉及 Web shell 修改；运行中的宿主必须对外提供重建后的 client bundle/graph revision，浏览器重新加载后再验收，不能仅凭本地构建声明当前页面已使用新接缝。

## 兼容边界与验证

旧宿主继续使用原 hero/accessory/composer 和 userMessageFooter；现代宿主使用 input.left + 单个 input.dock，所选模板预览保留在 dock 内。缺少新增 references slot 的现代宿主仍可选择/预览模板，但无法显示历史消息模板引用；插件不会回退占用 source chain，也不会猜测消息身份。要达到完整现代历史引用功能，必须部署此 ui-chat 补丁。

[Office registry 回归](../test/office-harness-slots.test.mjs) 使用真实 Cordis 与 Harness SlotRegistry，覆盖新旧声明、延迟 slot/owner 重挂、停用与重新激活、Word/Excel 互斥、单 dock、所选预览、首条用户身份、无 rpcId/重复 rpcId、分页未完整、会话切换、Office/PPT 共存、取消选择和 source 装饰独立。现有 Office 26 项行为测试及 PPT 个人模板管理 36 项行为测试保留。上游真实 MessageItem 测试覆盖引用在内容之后、多引用与来源装饰共存、分页 prepend 身份和 transient/无身份排除。

当前 3080 已从官方管理器安装 Office 与新版 PPT，刷新后的认证页面实际模块图与对应脚本均包含该 references 接缝；Word/Excel/PPT 控件和模板预览已实际挂载。正常与窄屏按钮命中及系统深浅主题切换已验收，记录见 [Office Web 迁移](office-web-plugin.md)。持久消息身份与分页的正反例由真实 Host MessageItem 和真实 SlotRegistry 回归覆盖；未为验证引用而向用户会话发送付费模型请求，也未声称与原版像素等价。
