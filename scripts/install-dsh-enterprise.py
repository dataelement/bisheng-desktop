#!/usr/bin/env python3
"""Interactive first-install helper for the DSH Enterprise server stack.

The Gateway release's full application.yml and init.sql are distribution
inputs, not maintained by this repository. Never synthesize their contents.
"""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen


SOURCE = 'https://github.com/dataelement/bisheng.git'
GATEWAY_IMAGE = 'cr.dataelem.com/dataelement/gateway:v1.6.0-dsh-20260921'
REQUIRED_MARKERS = ('__DSH_GATEWAY_DB_PASSWORD__', '__DSH_GATEWAY_HMAC_SECRET__', '__DSH_PUBLIC_URL__')
ROUTE = '''location ~ ^/api/dsh/(authorizations|token|logout|jwks)$ {
    proxy_pass http://gateway:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_read_timeout 30s;
}
'''


class InstallError(Exception):
    pass


def say(message):
    print(message, flush=True)


def run(command, *, cwd=None, env=None, input_text=None, stream=False, sensitive=False):
    if stream:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, bufsize=1)
        assert process.stdout is not None
        pending = ''
        for char in iter(lambda: process.stdout.read(1), ''):
            if char in '\r\n':
                if pending.strip():
                    # Docker reports per-layer byte counters; Git reports percentage.
                    say('  ' + pending.strip())
                pending = ''
            else:
                pending += char
        if pending.strip():
            say('  ' + pending.strip())
        code = process.wait()
        if code:
            raise InstallError(f'命令失败（退出码 {code}）：{command[0]} {command[1]}')
        return ''
    result = subprocess.run(command, cwd=cwd, env=env, input=input_text, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        if sensitive:
            raise InstallError(f'命令失败（退出码 {result.returncode}）：{command[0]} {command[1]}；输出可能包含凭据，已隐藏')
        detail = (result.stderr or result.stdout).strip()[-700:]
        raise InstallError(f'命令失败（退出码 {result.returncode}）：{command[0]} {command[1]}\n{detail}')
    return result.stdout


def validate_public_url(value):
    parts = urlsplit(value)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise InstallError('企业地址必须是完整的 http(s) URL，且不能包含账号密码')
    if parts.path not in ('', '/') or parts.query or parts.fragment:
        raise InstallError('企业地址只填写源站地址，不包含路径、查询或片段')
    return value.rstrip('/')


def validate_inputs(args):
    if not re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)(?:-beta(\d+))?', args.tag):
        raise InstallError('BISHENG 标签格式不受支持；请使用 v3.0.0-beta2 或更新的正式发布标签')
    numbers = tuple(map(int, re.findall(r'\d+', args.tag)))
    if numbers[:3] < (3, 0, 0) or numbers[:3] == (3, 0, 0) and len(numbers) > 3 and numbers[3] < 2:
        raise InstallError('BISHENG 版本至少为 v3.0.0-beta2')
    public_url = validate_public_url(args.public_url)
    install_dir = args.install_dir.expanduser().resolve()
    if install_dir.exists():
        raise InstallError(f'安装目录已存在：{install_dir}。本脚本仅支持全新安装，不改动已有部署')
    for item in (args.base_compose, args.base_config, args.gateway_config, args.gateway_sql):
        if not item.is_file() or not item.stat().st_size:
            raise InstallError(f'正式配套文件不存在或为空：{item}')
    template = args.gateway_config.read_text()
    missing = [marker for marker in REQUIRED_MARKERS if marker not in template]
    if missing:
        raise InstallError('Gateway 完整配置模板缺少安装变量：' + ', '.join(missing))
    if re.search(r'\bCREATE\s+(DATABASE|USER)\b', args.gateway_sql.read_text(), re.IGNORECASE):
        raise InstallError('Gateway SQL 包含建库或建账号语句；请按正式发行说明拆分，避免重复执行')
    base = args.base_compose.read_text()
    if 'MYSQL_ROOT_PASSWORD: "1234"' in base or 'root:1234@' in base:
        raise InstallError('基础 Compose 仍使用上游示例数据库密码 1234，请先按 BISHENG 官方说明配置')
    if 'bisheng-backend' not in base or 'bisheng-frontend' not in base:
        raise InstallError('基础 Compose 缺少 BISHENG 前后端镜像')
    for command in ('git', 'docker', 'openssl'):
        if not shutil.which(command):
            raise InstallError(f'缺少命令：{command}')
    run(['docker', 'compose', 'version'])
    run(['docker', 'info'])
    refs = run(['git', 'ls-remote', '--tags', '--refs', SOURCE, f'refs/tags/{args.tag}'])
    if not refs.strip():
        raise InstallError(f'远端不存在标签 {args.tag}')
    return install_dir, public_url


def compose(docker_dir, *command, stream=False):
    return run(['docker', 'compose', '--project-name', 'bisheng', '-f', 'docker-compose.yml',
                '-f', 'docker-compose.gateway.yml', *command], cwd=docker_dir, stream=stream)


def base_compose(docker_dir, *command, stream=False, input_text=None, sensitive=False):
    return run(['docker', 'compose', '--project-name', 'bisheng', '-f', 'docker-compose.yml',
                *command], cwd=docker_dir, stream=stream, input_text=input_text,
               sensitive=sensitive)


def replace_one(text, pattern, replacement, label):
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise InstallError(f'发行版配置找不到预期位置：{label}')
    return result


def prepare_files(docker_dir, args, public_url, db_password, hmac_secret):
    gateway_dir = docker_dir / 'gateway'
    gateway_dir.mkdir(mode=0o700)
    app = args.gateway_config.read_text()
    app = app.replace('__DSH_GATEWAY_DB_PASSWORD__', db_password)
    app = app.replace('__DSH_GATEWAY_HMAC_SECRET__', hmac_secret)
    app = app.replace('__DSH_PUBLIC_URL__', public_url)
    if any(marker in app for marker in REQUIRED_MARKERS):
        raise InstallError('Gateway 配置仍有未替换的安装变量')
    (gateway_dir / 'application.yml').write_text(app)
    (gateway_dir / 'application.yml').chmod(0o600)
    shutil.copyfile(args.gateway_sql, gateway_dir / 'init.sql')
    (gateway_dir / 'init.sql').chmod(0o600)

    config_path = docker_dir / 'bisheng/config/config.yaml'
    config = config_path.read_text()
    config = replace_one(config, r'^(sso_sync:\s*\n(?:[ \t]+[^\n]*\n)*)',
                         lambda match: replace_one(match.group(1),
                             r'^([ \t]+gateway_hmac_secret:).*$','  gateway_hmac_secret: !env BS_SSO_SYNC__GATEWAY_HMAC_SECRET',
                             'sso_sync.gateway_hmac_secret'), 'sso_sync')
    if re.search(r'^dsh:', config, re.MULTILINE):
        raise InstallError('发行版已有 dsh 配置，需要人工核对后再安装')
    config += f'\n# DSH Enterprise access\ndsh:\n  enabled: true\n  platform_public_url: {json.dumps(public_url)}\n  gateway_internal_url: "http://gateway:8080"\n'
    config_path.write_text(config)

    nginx_path = docker_dir / 'nginx/conf.d/default.conf'
    nginx = nginx_path.read_text()
    if 'location ~ ^/api/dsh/' in nginx:
        raise InstallError('发行版已有 DSH Nginx 路由，需要人工核对')
    route = ROUTE.replace('X-Forwarded-Proto $scheme',
                          'X-Forwarded-Proto https' if public_url.startswith('https://') else 'X-Forwarded-Proto $scheme')
    nginx = replace_one(nginx, r'^[ \t]*location ~ \^\(/workspace\)\?/api\(/\|\$\) \{',
                        lambda _: route + '\n\tlocation ~ ^(/workspace)?/api(/|$) {', '通用 API Nginx 路由')
    nginx_path.write_text(nginx)

    overlay = f'''services:
  gateway:
    image: {GATEWAY_IMAGE}
    restart: unless-stopped
    environment:
      TZ: Asia/Shanghai
      JAVA_OPTS: -Xms256m -Xmx768m -Dserver.port=8080 -Dspring.config.location=/config/application.yml
    volumes:
      - type: bind
        source: ./gateway/application.yml
        target: /config/application.yml
        read_only: true
        bind:
          create_host_path: false
    expose:
      - "8080"
    depends_on:
      - mysql
      - redis
      - backend
  backend:
    environment:
      BS_SSO_SYNC__GATEWAY_HMAC_SECRET: "{hmac_secret}"
  backend_worker:
    environment:
      BS_SSO_SYNC__GATEWAY_HMAC_SECRET: "{hmac_secret}"
'''
    overlay_path = docker_dir / 'docker-compose.gateway.yml'
    overlay_path.write_text(overlay)
    overlay_path.chmod(0o600)


def mysql_input(docker_dir, root_password, sql, *, database=None):
    # Keep the password out of argv, terminal output and process environment.
    with tempfile.NamedTemporaryFile(mode='w', delete=False, prefix='dsh-mysql-', suffix='.cnf') as file:
        escaped = root_password.replace('\\', '\\\\').replace('"', '\\"')
        file.write('[client]\nuser=root\npassword="' + escaped + '"\n')
        temp_path = Path(file.name)
    temp_path.chmod(0o600)
    container_file = '/tmp/dsh-installer-mysql.cnf'
    try:
        base_compose(docker_dir, 'cp', str(temp_path), f'mysql:{container_file}')
        command = ['exec', '-T', 'mysql', 'mysql', f'--defaults-extra-file={container_file}']
        if database:
            command.append(database)
        return base_compose(docker_dir, *command, input_text=sql, sensitive=True)
    finally:
        try:
            base_compose(docker_dir, 'exec', '-T', 'mysql', 'rm', '-f', container_file)
        finally:
            temp_path.unlink(missing_ok=True)


def install(args):
    install_dir, public_url = validate_inputs(args)
    say('\nDSH Enterprise · 首次安装')
    say(f'BISHENG: {args.tag}  |  Gateway: {GATEWAY_IMAGE}')
    say(f'安装目录: {install_dir}\n企业地址: {public_url}')
    say('正式 Gateway 配置与 SQL 由操作者提供；安装后还需在后台配置模型、授权成员。')
    projects = run(['docker', 'compose', 'ls', '--format', 'json'])
    if any(item.get('Name') == 'bisheng' for item in json.loads(projects or '[]')):
        raise InstallError('Docker 已有 bisheng Compose 项目；本脚本不会接管已有服务')
    if input('输入 INSTALL 开始安装（会启动 Docker 服务）：').strip() != 'INSTALL':
        raise InstallError('已取消')
    root_password = getpass.getpass('当前 MySQL 管理员密码（仅用于本次建库）：')
    if not root_password or '\n' in root_password:
        raise InstallError('MySQL 管理员密码不能为空或包含换行')
    db_password = secrets.token_hex(24)
    hmac_secret = secrets.token_hex(32)
    say('\n[1/6] 下载 BISHENG 源码（Git 会显示接收百分比）')
    run(['git', 'clone', '--progress', SOURCE, str(install_dir)], stream=True)
    run(['git', 'switch', '--detach', args.tag], cwd=install_dir)
    docker_dir = install_dir / 'docker'
    if not (docker_dir / 'docker-compose.yml').is_file():
        raise InstallError('所选标签缺少 docker/docker-compose.yml')
    shutil.copyfile(args.base_compose, docker_dir / 'docker-compose.yml')
    (docker_dir / 'docker-compose.yml').chmod(0o600)
    shutil.copyfile(args.base_config, docker_dir / 'bisheng/config/config.yaml')
    (docker_dir / 'bisheng/config/config.yaml').chmod(0o600)
    say('[2/6] 检查版本与 Compose 服务')
    images = base_compose(docker_dir, 'config', '--images')
    if (f'bisheng-backend:{args.tag}' not in images
            or f'bisheng-frontend:{args.tag}' not in images):
        raise InstallError('基础 Compose 前后端镜像与所选 BISHENG 标签不一致')
    say('[3/6] 拉取基础镜像（显示各镜像层下载字节和状态）')
    base_compose(docker_dir, 'config', '--quiet')
    base_compose(docker_dir, 'pull', stream=True)
    say('[4/6] 启动 BISHENG')
    base_compose(docker_dir, 'up', '-d', '--wait', '--wait-timeout', '300', stream=True)
    say('[5/6] 生成 DSH 接入配置、拉取 Gateway')
    prepare_files(docker_dir, args, public_url, db_password, hmac_secret)
    compose(docker_dir, 'config', '--quiet')
    run(['docker', 'pull', GATEWAY_IMAGE], stream=True)
    say('[6/6] 初始化数据库并启动 Gateway')
    create_sql = ("CREATE DATABASE bisheng_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;\n"
                  "CREATE USER 'dsh_gateway'@'%' IDENTIFIED BY '" + db_password + "';\n"
                  "GRANT SELECT, INSERT, UPDATE, DELETE ON bisheng_gateway.* TO 'dsh_gateway'@'%';\n")
    mysql_input(docker_dir, root_password, create_sql)
    mysql_input(docker_dir, root_password, args.gateway_sql.read_text(), database='bisheng_gateway')
    tables = mysql_input(docker_dir, root_password, 'SHOW TABLES;', database='bisheng_gateway')
    if len(tables.splitlines()) < 2:
        raise InstallError('正式 SQL 导入后没有发现 Gateway 表；停止启动，请核对初始化脚本')
    compose(docker_dir, 'up', '-d', '--force-recreate', 'backend', 'backend_worker', 'gateway', stream=True)
    compose(docker_dir, 'exec', '-T', 'frontend', 'nginx', '-t')
    compose(docker_dir, 'exec', '-T', 'frontend', 'nginx', '-s', 'reload')
    compose(docker_dir, 'ps', '-a', stream=True)
    with urlopen(public_url + '/api/dsh/jwks', timeout=15) as response:
        jwks = json.load(response)
    if not isinstance(jwks, dict) or not isinstance(jwks.get('keys'), list):
        raise InstallError('JWKS 响应没有 keys 数组，请检查 Gateway 与 Nginx 路由')
    say('\n服务端安装完成。接下来在 BISHENG 后台启用 DSH 接入、添加系统模型并分配成员额度；成员安装 Desktop 后完成登录与对话验收。')
    say(f'维护时进入 {docker_dir}，使用：docker compose --project-name bisheng -f docker-compose.yml -f docker-compose.gateway.yml ...')


def main():
    parser = argparse.ArgumentParser(description='DSH Enterprise 首次安装 TUI（Linux + Docker Compose）')
    parser.add_argument('--install-dir', type=Path, required=True, help='全新安装目录，必须不存在')
    parser.add_argument('--public-url', required=True, help='成员可访问的完整企业地址')
    parser.add_argument('--gateway-config', type=Path, required=True, help='正式完整 application.yml 模板')
    parser.add_argument('--gateway-sql', type=Path, required=True, help='对应镜像的正式首次建表 SQL')
    parser.add_argument('--base-compose', type=Path, required=True, help='按官方部署说明准备的基础 Compose 文件')
    parser.add_argument('--base-config', type=Path, required=True, help='与基础 Compose 匹配的 BISHENG config.yaml')
    parser.add_argument('--tag', default='v3.0.0-beta2', help='BISHENG 实际发布标签')
    args = parser.parse_args()
    try:
        if not sys.stdin.isatty():
            raise InstallError('请在交互式终端运行安装脚本')
        if sys.platform != 'linux':
            raise InstallError('服务端安装仅支持 Linux')
        install(args)
    except KeyboardInterrupt:
        say('\n安装已中断；已创建的目录、容器和数据库保留供检查。')
        return 130
    except (InstallError, OSError, ValueError) as error:
        say(f'\n安装停止：{error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
