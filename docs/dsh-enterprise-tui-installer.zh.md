# DSH Enterprise 服务端 TUI 首次安装

运行入口：[scripts/install-dsh-enterprise.py](../scripts/install-dsh-enterprise.py)。本脚本在 **Linux 服务器**的交互式终端中执行，安装全新的 BISHENG Compose 项目及 DSH 专用 Gateway。它不接管已有部署，也不安装成员电脑上的 Desktop。

安装依据：[DSH Enterprise Deployment](https://dshdesktop.com/zh/enterprise/deployment/) 与[商业拓展套件部署说明](https://dataelem.feishu.cn/wiki/KNWrwK1DtiFli7klsLzczx7enNh)。后者的 `gateway:release`、License、示例 SQL 和旧地址属于旧商业套件流程；这里采用 Deployment 指定的 `v1.6.0-dsh-20260921` 镜像。该镜像默认无需 Gateway License。

## 安装前准备

1. Linux 服务器具备 Docker Engine、Compose 插件、Git、OpenSSL 和镜像仓库访问权限。建议至少 8 核 CPU、32 GB 内存；磁盘按 BISHENG 发行版要求准备。
2. 准备 BISHENG `v3.0.0-beta2` 或更新正式标签对应的基础 `docker-compose.yml` 和 `bisheng/config/config.yaml`，按[官方私有化部署说明](https://dataelem.feishu.cn/wiki/BSCcwKd4Yiot3IkOEC8cxGW7nPc)修改其数据库密码、模型及存储设置。两个文件必须相互匹配，不能保留示例数据库密码 `1234`。脚本会将它们复制到新克隆的发行版目录。
3. 从 BISHENG 团队获取**与 Gateway 镜像完全配套**的完整 `application.yml` 和首次建表 SQL。官网 Deployment 当前只展示配置片段，尚未提供完整文件下载。复制完整 `application.yml` 为安装模板，并在相应字段中使用这三个占位符：`__DSH_GATEWAY_DB_PASSWORD__`（`spring.datasource.password`）、`__DSH_GATEWAY_HMAC_SECRET__`（`bisheng.gateway-hmac-secret`）、`__DSH_PUBLIC_URL__`（`bisheng.home-url` 和 `bisheng.web-home-url`）。其余数据库、Redis、路由及运行参数按正式模板和目标环境填写。脚本生成数据库账号和服务间密钥，并替换占位符；不会从旧文档拼凑完整配置。
4. 首次 SQL 只用于新的 `bisheng_gateway` 库；请先核对它不包含与脚本重复的建库、建账号语句。企业地址须能从成员电脑访问。HTTPS 在外层代理终止时，先配置可信的 HTTPS 反向代理到前端 3001 端口。

## 运行

```bash
python3 scripts/install-dsh-enterprise.py \
  --install-dir /srv/bisheng \
  --tag v3.0.0-beta2 \
  --public-url https://ai.example.com \
  --base-compose /secure-input/docker-compose.yml \
  --base-config /secure-input/config.yaml \
  --gateway-config /secure-input/application.yml \
  --gateway-sql /secure-input/init.sql
```

脚本先检查输入、远端标签、Docker 服务和现有项目，再显示实际目标，输入 `INSTALL` 后开始。Git 克隆显示对象接收百分比；Docker Compose 与 Gateway 拉取显示各镜像层的下载量、解压及完成状态。过程中会提示输入当前 MySQL 管理员密码，密码不写入脚本参数或终端输出。Gateway 的运行账号密码和 HMAC 密钥随机生成，写入权限为 `0600` 的本地配置。实际镜像下载时间取决于网络，不使用虚构的总体百分比。

安装顺序：拉取发行版源码 → 复制经过审阅的基础配置 → 检查并拉取基础镜像 → 启动 BISHENG → 生成 Gateway/DSH 接入配置 → 拉取 Gateway → 建库并导入正式 SQL → 重建后端与 Gateway → 检查并重载 Nginx → 验证 `/api/dsh/jwks` 返回 `keys` 数组。安装中断时保留目录、容器、数据库和日志，便于按阶段排查；脚本不会自动删除用户数据或重试建库。重新运行前应检查现场，不能将同一目录当作新安装再次执行。

## 安装后验收

管理员在 BISHENG 后台开启 DSH Desktop 接入，配置至少一个在线大语言模型，并为体验成员分配模型额度。成员安装支持企业登录的 Desktop，使用同一企业地址登录并发送一条实际消息；管理员再检查使用统计。JWKS 检查只证明公开授权路由可访问，不能代替浏览器登录、模型调用和统计验收。

已有 BISHENG 环境须沿用原项目名、完整 Compose 文件列表、数据目录与环境参数，并按对应版本说明备份和升级。本首次安装脚本会拒绝已有 `bisheng` Compose 项目；不能直接用它迁移旧系统。
