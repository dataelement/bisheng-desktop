# 企业产品显示名称

桌面沿用已同步的 upstream #954：应用身份解析 `dshDesktopIdentity.productName`，由 `app.getName()` 生成正式名称 `BISHENG` 或开发名称 `BISHENG Dev`。主进程通过 `--dsh-product-name` 参数传给 preload，通过 `__DSH_PRODUCT_NAME__` 传给客户端插件，通过 `DSH_DESKTOP_PRODUCT_NAME` 传给 Host 插件。

企业设置版本标签、登录回调成功页、授权设备名称和市场兼容提示消费同一身份。手机页面已由 runtime 将 `app.getName()` 传给 mobile extension。独立 Web 无 Electron preload 时保留企业默认 `BISHENG`，服务端可显式设置 `DSH_DESKTOP_PRODUCT_NAME`；市场缺少桌面授权能力时使用“桌面客户端”提示，避免把 Web 用户引导回同一 Web 页面。动态名称进入 HTML 时必须转义。

更新与关于弹窗的图标通过企业版构建 alias 使用 `build/bisheng-logo-mark.svg`，保持单一品牌资源输入；不修改公共底座 UI。

`Harness` 仍指内核，企业平台和模型提供方名称、插件包名、协议、userData 路径与 Profile 标识不随应用显示名改变。本次不修改底座源码或其边界门禁。

验证需覆盖中英文、深浅主题、正式/开发名称、名称 HTML 转义、真实登录回调、Host 子进程名称传递及构建后的更新/关于页面。真实 Electron 验收使用临时 userData，不接触用户实际 Profile。构建通过不代表已安装应用已更新，Windows 实机与安装包升级流程仍需单独验收。
