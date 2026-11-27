# 必晟更新与版本切换源

## 统一配置

历史 v1.2.0 / v1.3.0 使用 `https://dshdesktop.com/work/updates/latest/`。产品更新配置应与 electron-builder publish 保持一致：

```json
{
  "dshDesktopUpdates": {
    "updatesBaseUrl": "https://dshdesktop.com/work/updates/",
    "strategy": "feed"
  }
}
```

该配置同时存在于开发 manifest 和 build.extraMetadata，分别覆盖开发执行与安装包。依赖上游可配置更新源接缝合入后同步，单独增加元数据不会修复旧底座硬编码。不得在下游通过修改底座文件或运行时拦截请求绕过边界。

- 最新版本：`https://dshdesktop.com/work/updates/latest/`
- 可切换版本目录：`https://dshdesktop.com/work/updates/versions.json`
- 指定版本下载：`https://dshdesktop.com/work/updates/archive/<version>/`
- 对应 ModelScope 仓库：`alexyaojin/bisheng-work`，目录 `releases/latest`、`releases/versions.json`、`releases/archive/<version>`

`feed` 策略恢复历史必晟安装包直接读取产品 latest feed 的行为；不调用 upstream 的灰度策略接口，也不在 upstream crash 服务写发布规则。故障上报独立于产品更新，此次不修改其地址、用户确认或报告机制。开发模式不支持自动安装更新的规则保持不变。

## 发布与历史归档

正式发布和历史补档都调用企业 CI helper `bisheng_append_version_index.py`，读取已发布的必晟目录并保持其历史记录，新增版本后将各条 archiveUrl 规范化为必晟路径，修复旧生成器带入的 upstream 默认路径。任何下载/校验失败均中止，不能将空目录覆盖历史。补档 workflow 使用 `alexyaojin/bisheng-work`，不能上传到 `alexyaojin/dsh-desktop`。

未自动触发线上发布或回填。已有线上索引需在审核后执行下一次正式发布或为对应必晟 tag 手动补档；不把公共 upstream tag 批量导入必晟目录。

## 当前验证限制

按用户要求未运行完整回归、打包或安装更新。只做语法/差异检查。线上必晟目录读取遇到 SSL 握手超时，不能声称线上目录正常或已完成切源。上游接缝需先审核合入，再同步到 V1.3.1 并重新构建安装包。
