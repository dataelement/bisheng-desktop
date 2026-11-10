import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { WEB_HARNESS_VERSION } from './web-runtime-version.mjs'
import { addWebSidebarSwitcher } from './web-sidebar-slot.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const harnessRoot = path.resolve(projectRoot, '../../../../AI/deepseek-harness')
const distDir = path.join(projectRoot, 'dist')
const outputDir = path.join(distDir, 'bisheng-web-runtime')
const zipFile = path.join(distDir, 'bisheng-web-runtime.zip')
const depsDir = path.join(outputDir, 'deps')

async function packWebRuntime() {
  console.log('📦 Starting Web Runtime Packaging (Dependency Approach)...')
  await fs.mkdir(distDir, { recursive: true })
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.rm(zipFile, { force: true })

  await fs.mkdir(path.join(outputDir, 'bin'), { recursive: true })
  await fs.mkdir(depsDir, { recursive: true })
  await fs.mkdir(path.join(outputDir, 'profile'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'data'), { recursive: true })
  await fs.copyFile(path.join(projectRoot, 'scripts/web-plugin-manager.mjs'), path.join(outputDir, 'web-plugin-manager.mjs'))
  await fs.copyFile(path.join(projectRoot, 'scripts/web-sidebar-slot.mjs'), path.join(outputDir, 'web-sidebar-slot.mjs'))

  // 1. Pack modified upstream packages and local plugins into tgz
  console.log('  -> Packing pre-compiled upstream packages from harness...')
  const packagesToPack = [
    {
      name: 'app-boot',
      dirs: [path.join(harnessRoot, 'packages/boot/app-boot'), path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-app-boot')]
    },
    {
      name: 'ui-chat',
      dirs: [path.join(harnessRoot, 'packages/client/ui-chat'), path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-chat')]
    },
    {
      name: 'ui-conversation',
      dirs: [path.join(harnessRoot, 'packages/client/ui-conversation'), path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-conversation')]
    },
    {
      name: 'ui-workspace',
      dirs: [path.join(harnessRoot, 'packages/client/ui-workspace'), path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-workspace')]
    },
    {
      name: 'enterprise',
      dirs: [path.join(projectRoot, 'packages/dsh-desktop-enterprise'), path.join(projectRoot, 'node_modules/dsh-desktop-enterprise')]
    },
    {
      name: 'workbenches',
      dirs: [path.join(projectRoot, 'packages/dsh-desktop-workbenches'), path.join(projectRoot, 'node_modules/dsh-desktop-workbenches')]
    },
    {
      name: 'client-ui',
      dirs: [path.join(projectRoot, 'packages/dsh-desktop-client-ui'), path.join(projectRoot, 'node_modules/dsh-desktop-client-ui')]
    }
  ]

  for (const pkg of packagesToPack) {
    let resolvedDir = null
    for (const d of pkg.dirs) {
      if (await fs.stat(d).catch(() => null)) {
        resolvedDir = d
        break
      }
    }
    if (!resolvedDir) {
      throw new Error(`Package directory for ${pkg.name} not found in candidates: ${pkg.dirs.join(', ')}`)
    }
    console.log(`     Packing ${pkg.name} from ${resolvedDir}...`)
    const res = spawnSync('pnpm', ['--dir', resolvedDir, 'pack', '--pack-destination', depsDir], {
      stdio: 'inherit'
    })
    if (res.status !== 0) throw new Error(`Failed to pack ${pkg.name}`)
  }

  // Check for pre-built office and ppt web packages and include if available
  const officeTgzSource = path.join(projectRoot, '.build/office-web/dsh-desktop-office-0.1.0.tgz')
  if (await fs.stat(officeTgzSource).catch(() => null)) {
    console.log('     Including pre-built dsh-desktop-office-0.1.0.tgz...')
    await fs.copyFile(officeTgzSource, path.join(depsDir, 'dsh-desktop-office-0.1.0.tgz'))
  }

  const pptTgzSource = path.join(projectRoot, '.build/ppt-web/dsh-ppt-composer-0.1.1-rc.2.tgz')
  if (await fs.stat(pptTgzSource).catch(() => null)) {
    console.log('     Including pre-built dsh-ppt-composer-0.1.1-rc.2.tgz...')
    await fs.copyFile(pptTgzSource, path.join(depsDir, 'dsh-ppt-composer-0.1.1-rc.2.tgz'))
  }

  // 2. Discover generated tgz file names
  const tgzFiles = (await fs.readdir(depsDir)).filter(f => f.endsWith('.tgz'))
  console.log(`     Generated ${tgzFiles.length} tgz packages in deps/`)

  // Copy bundled Windows Node.js portable runtime if present
  const sourceNodeDir = path.join(os.homedir(), 'Downloads/dsh-portable/dsh-portable/node')
  const targetNodeDir = path.join(outputDir, 'node')
  if (await fs.stat(path.join(sourceNodeDir, 'node.exe')).catch(() => null)) {
    console.log('  -> Bundling portable Windows Node.js from dsh-portable/node...')
    await fs.cp(sourceNodeDir, targetNodeDir, { recursive: true })
    // Strip unnecessary doc/map/test files to reduce small file count
    const stripExts = new Set(['.map', '.md', '.d.ts.map'])
    const stripDirs = new Set(['__tests__', 'test', 'tests', '.github', 'docs'])
    const walkAndPrune = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (stripDirs.has(entry.name.toLowerCase())) {
            await fs.rm(full, { recursive: true, force: true }).catch(() => {})
          } else {
            await walkAndPrune(full)
          }
        } else if (stripExts.has(path.extname(entry.name).toLowerCase()) || entry.name.toLowerCase() === 'changelog.md') {
          await fs.rm(full, { force: true }).catch(() => {})
        }
      }
    }
    await walkAndPrune(targetNodeDir)
  }

  const appBootTgz = tgzFiles.find(f => f.includes('app-boot'))
  const uiChatTgz = tgzFiles.find(f => f.includes('ui-chat'))
  const uiConversationTgz = tgzFiles.find(f => f.includes('ui-conversation'))
  const uiWorkspaceTgz = tgzFiles.find(f => f.includes('ui-workspace'))
  const enterpriseTgz = tgzFiles.find(f => f.includes('enterprise'))
  const workbenchesTgz = tgzFiles.find(f => f.includes('workbenches'))
  const clientUiTgz = tgzFiles.find(f => f.startsWith('dsh-desktop-client-ui'))
  const officeTgz = tgzFiles.find(f => f.includes('office'))
  const pptTgz = tgzFiles.find(f => f.includes('ppt'))

  // 3. Create root package.json for runtime dependencies
  console.log('  -> Creating root package.json with dependencies...')
  const rootPackageJson = {
    name: 'bisheng-web-runtime',
    version: '1.0.0',
    description: 'BiSheng Web Standalone Runtime for DeepSeek Harness',
    private: true,
    type: 'module',
    scripts: {
      start: 'node ./node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3080 --no-open'
    },
    dependencies: {
      '@deepseek-ai/dsh': WEB_HARNESS_VERSION,
      '@deepseek-ai/dsh-web-app': WEB_HARNESS_VERSION,
      '@deepseek-ai/dsh-sandbox': WEB_HARNESS_VERSION,
      '@deepseek-ai/dsh-llm-deepseek': WEB_HARNESS_VERSION,
      '@deepseek-ai/dsh-app-boot': `file:./deps/${appBootTgz}`,
      '@deepseek-ai/dsh-client-ui-chat': `file:./deps/${uiChatTgz}`,
      '@deepseek-ai/dsh-client-ui-conversation': `file:./deps/${uiConversationTgz}`,
      '@deepseek-ai/dsh-client-ui-workspace': `file:./deps/${uiWorkspaceTgz}`,
      'dsh-desktop-enterprise': `file:./deps/${enterpriseTgz}`,
      'dsh-desktop-workbenches': `file:./deps/${workbenchesTgz}`,
      'dsh-desktop-client-ui': `file:./deps/${clientUiTgz}`,
      ...(officeTgz ? { 'dsh-desktop-office': `file:./deps/${officeTgz}` } : {}),
      ...(pptTgz ? { 'dsh-ppt-composer': `file:./deps/${pptTgz}` } : {})
    }
  }
  await fs.writeFile(
    path.join(outputDir, 'package.json'),
    JSON.stringify(rootPackageJson, null, 2),
    'utf8'
  )

  // 4. Create profile package.json, cordis.yml & cordis.patch.yml
  console.log('  -> Creating profile configuration...')
  const profilePackageJson = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      'dsh-desktop-enterprise': `file:../../../deps/${enterpriseTgz}`,
      'dsh-desktop-workbenches': `file:../../../deps/${workbenchesTgz}`,
      'dsh-desktop-client-ui': `file:../../../deps/${clientUiTgz}`,
      ...(officeTgz ? { 'dsh-desktop-office': `file:../../../deps/${officeTgz}` } : {}),
      ...(pptTgz ? { 'dsh-ppt-composer': `file:../../../deps/${pptTgz}` } : {})
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          'dsh-desktop-client-ui',
          'dsh-desktop-enterprise',
          'dsh-desktop-workbenches',
          ...(officeTgz ? ['dsh-desktop-office'] : []),
          ...(pptTgz ? ['dsh-ppt-composer'] : [])
        ]
      }
    }
  }
  await fs.writeFile(
    path.join(outputDir, 'profile', 'package.json'),
    JSON.stringify(profilePackageJson, null, 2),
    'utf8'
  )
  await fs.writeFile(path.join(outputDir, 'profile', 'cordis.yml'), '[]\n', 'utf8')
  await fs.copyFile(
    path.join(projectRoot, 'build', 'web-runtime', 'cordis.patch.yml'),
    path.join(outputDir, 'profile', 'cordis.patch.yml')
  )

  // Helper to ensure CRLF and proper line endings for Windows batch scripts
  const writeBatchFile = async (filePath, content) => {
    const crlfContent = content.replace(/\r?\n/g, '\r\n')
    await fs.writeFile(filePath, crlfContent, 'utf8')
  }

  // 5. Create Root Portable Launchers (Modeled after dsh-portable)
  console.log('  -> Creating root portable launchers (dsh.cmd, dsh.sh, 启动.bat)...')

  const dshCmd = `@ECHO OFF
SETLOCAL
REM ===================================================================
REM  BiSheng Web Runtime (DeepSeek Harness) Portable Launcher
REM  Supports: Windows CMD / PowerShell
REM ===================================================================

SET "PORTABLE_ROOT=%~dp0"
SET "DSH_HOME=%PORTABLE_ROOT%data"
SET "DSH_WEB_RUNTIME=1"

REM 1. 查找 Node.js 运行时 (优先内置 node\\node.exe，回退系统 node)
IF EXIST "%PORTABLE_ROOT%node\\node.exe" (
  SET "DSH_NODE=%PORTABLE_ROOT%node\\node.exe"
  SET "PATH=%PORTABLE_ROOT%node;%PATH%"
) ELSE (
  WHERE node >NUL 2>&1
  IF %ERRORLEVEL% NEQ 0 (
    ECHO [bisheng-portable] ERROR: 未检测到 Node.js，请先安装 Node.js (>=20.0.0): https://nodejs.org/
    EXIT /B 1
  )
  SET "DSH_NODE=node"
)

SET "DSH_ENTRY=%PORTABLE_ROOT%node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"

REM 2. 检查并安装运行时依赖 (首次启动自愈)
IF NOT EXIST "%DSH_ENTRY%" (
  ECHO [bisheng-portable] 首次运行，正在自动安装依赖...
  PUSHD "%PORTABLE_ROOT%"
  CALL npm install --omit=dev --legacy-peer-deps
  IF %ERRORLEVEL% NEQ 0 (
    POPD
    ECHO [bisheng-portable] ERROR: 依赖安装失败，请检查网络或 npm 配置。
    EXIT /B 1
  )
  POPD
)

"%NODE_BIN%" "%PORTABLE_ROOT%web-plugin-manager.mjs" "%PORTABLE_ROOT%node_modules"
IF ERRORLEVEL 1 (
  SET "EXIT_CODE=1"
  GOTO finish
)

REM 3. 初始化 Web Profile
IF NOT EXIST "%DSH_HOME%\\profiles\\web" (
  MKDIR "%DSH_HOME%\\profiles\\web" >NUL 2>&1
  IF EXIST "%PORTABLE_ROOT%profile\\package.json" (
    COPY /Y "%PORTABLE_ROOT%profile\\package.json" "%DSH_HOME%\\profiles\\web\\package.json" >NUL
  )
  IF EXIST "%PORTABLE_ROOT%profile\\cordis.yml" (
    COPY /Y "%PORTABLE_ROOT%profile\\cordis.yml" "%DSH_HOME%\\profiles\\web\\cordis.yml" >NUL
  )
  IF EXIST "%PORTABLE_ROOT%profile\\cordis.patch.yml" (
    COPY /Y "%PORTABLE_ROOT%profile\\cordis.patch.yml" "%DSH_HOME%\\profiles\\web\\cordis.patch.yml" >NUL
  )
)

REM 4. 显示使用提示
IF "%~1"=="" (
  ECHO.
  ECHO   BiSheng Web Runtime  -  DeepSeek Harness
  ECHO   ===========================================
  ECHO.
  ECHO   Usage:
  ECHO     dsh web                        启动网页界面 (默认端口 3080)
  ECHO     dsh web --port 8080            指定端口启动
  ECHO     dsh headless "你的任务"        直接运行任务并输出结果
  ECHO     dsh --version                  查看版本
  ECHO     dsh --help                     查看全部帮助
  ECHO.
  ECHO   数据目录: %DSH_HOME%
  ECHO.
  SET "RC=1"
  GOTO :finish
)

"%DSH_NODE%" "%DSH_ENTRY%" %*
SET "RC=%ERRORLEVEL%"

:finish
ENDLOCAL & EXIT /B %RC%
`
  await writeBatchFile(path.join(outputDir, 'dsh.cmd'), dshCmd)

  const dshSh = `#!/bin/sh
# ===================================================================
#  BiSheng Web Runtime (DeepSeek Harness) Portable Launcher
#  Supports: macOS / Linux / Git Bash / MSYS2 / WSL
# ===================================================================

set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

topath() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

ROOT=$(topath "$SCRIPT_DIR")
export DSH_WEB_RUNTIME=1

# 1. 查找 Node.js 运行时 (优先内置，回退系统)
if [ -x "$ROOT/node/node" ]; then
  NODE_BIN="$ROOT/node/node"
elif [ -x "$ROOT/node/node.exe" ]; then
  NODE_BIN="$ROOT/node/node.exe"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
else
  echo "[bisheng-portable] ERROR: 未找到 Node.js，请先安装 Node.js (>=20.0.0): https://nodejs.org/" >&2
  exit 1
fi

ENTRY="$ROOT/node_modules/@deepseek-ai/dsh/lib/bin.js"
export DSH_HOME="$ROOT/data"
export DSH_NODE="$NODE_BIN"

if [ -d "$ROOT/node" ]; then
  export PATH="$ROOT/node:$PATH"
fi

# 2. 检查并安装运行时依赖 (首次启动自愈)
if [ ! -f "$ENTRY" ]; then
  echo "[bisheng-portable] 首次运行，正在自动安装依赖..."
  cd "$ROOT"
  npm install --omit=dev --legacy-peer-deps
  if [ $? -ne 0 ]; then
    echo "[bisheng-portable] ERROR: 依赖安装失败，请检查网络或 npm 环境。" >&2
    exit 1
  fi
fi

# Apply the reviewed alpha.3 verified-install boundary before starting Harness.
"$NODE_BIN" "$ROOT/web-plugin-manager.mjs" "$ROOT/node_modules" || exit $?

# 3. 初始化 Web Profile
if [ ! -d "$DSH_HOME/profiles/web" ]; then
  mkdir -p "$DSH_HOME/profiles/web"
  [ -f "$ROOT/profile/package.json" ] && cp "$ROOT/profile/package.json" "$DSH_HOME/profiles/web/package.json"
  [ -f "$ROOT/profile/cordis.yml" ] && cp "$ROOT/profile/cordis.yml" "$DSH_HOME/profiles/web/cordis.yml"
  [ -f "$ROOT/profile/cordis.patch.yml" ] && cp "$ROOT/profile/cordis.patch.yml" "$DSH_HOME/profiles/web/cordis.patch.yml"
fi

# 4. 显示使用提示
if [ "$#" -eq 0 ]; then
  cat >&2 <<EOF

  BiSheng Web Runtime  -  DeepSeek Harness
  ===========================================

  Usage:
    ./dsh.sh web                      启动网页界面 (默认端口 3080)
    ./dsh.sh web --port 8080          指定端口启动
    ./dsh.sh headless "你的任务"      直接运行任务并输出结果
    ./dsh.sh --version                查看版本
    ./dsh.sh --help                   查看全部帮助

  数据目录: $DSH_HOME

EOF
  exit 1
fi

exec "$NODE_BIN" "$ENTRY" "$@"
`
  await fs.writeFile(path.join(outputDir, 'dsh.sh'), dshSh, 'utf8')
  await fs.chmod(path.join(outputDir, 'dsh.sh'), 0o755)

  const quickStartBat = `@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title BiSheng Web Runtime - DeepSeek Harness

echo.
echo   BiSheng Web Runtime  -  DeepSeek Harness
echo   ========================================
echo.
echo   正在启动网页界面，稍后浏览器会自动打开...
echo   用完之后，直接关闭本窗口即可停止服务。
echo.

if not exist "%~dp0dsh.cmd" goto noshim

call "%~dp0dsh.cmd" web %*
set "RC=%ERRORLEVEL%"
goto done

:noshim
echo   [错误] 找不到 dsh.cmd
echo   请确认本文件与 dsh.cmd 放在同一个文件夹里。
echo.
pause
exit /b 1

:done
if not "%RC%"=="0" (
  echo.
  echo   [提示] 服务已退出，返回码 %RC%
  echo.
  echo   如果提示端口被占用 (EADDRINUSE)，可以指定端口再试：
  echo       dsh.cmd web --port 8080
  echo.
  pause
)
`
  await writeBatchFile(path.join(outputDir, '启动.bat'), quickStartBat)

  // 6. Create bin/start.ps1, bin/start.bat, bin/start.sh (Compatibility entries)
  console.log('  -> Creating bin/ compatibility entries...')
  const startPs1 = `# PowerShell Startup Script for BiSheng Web Runtime
$ErrorActionPreference = "Stop"
$DIR = Split-Path -Parent $PSScriptRoot
$env:DSH_HOME = "$DIR\\data"
$env:DSH_WEB_RUNTIME = "1"
$PORT = if ($env:PORT) { $env:PORT } else { "3080" }
$HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$env:NODE_ENV = "production"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  BiSheng Web Runtime (PowerShell on Windows)" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Root:    $DIR"
Write-Host "  Data:    $env:DSH_HOME"
Write-Host "  URL:     http://127.0.0.1:$PORT"
Write-Host "========================================================" -ForegroundColor Cyan

# 1. 检查 Node.js
try {
    $nodeVer = node --version
    Write-Host "[OK] Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] 未检测到 Node.js，请先安装 Node.js (>=20.0.0): https://nodejs.org/" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}

# 2. 首次运行自动安装依赖
if (-not (Test-Path "$DIR\\node_modules\\@deepseek-ai\\dsh")) {
    Write-Host "[INFO] 首次运行，正在自动安装依赖 (npm install)..." -ForegroundColor Yellow
    Set-Location $DIR
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install --prod
    } else {
        npm install --omit=dev --legacy-peer-deps
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] 依赖安装失败，请检查网络或 npm 配置" -ForegroundColor Red
        Read-Host "按回车键退出..."
        exit 1
    }
}

& node "$DIR\\web-plugin-manager.mjs" "$DIR\\node_modules"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 3. 初始化 Web Profile
if (-not (Test-Path "$env:DSH_HOME\\profiles\\web")) {
    Write-Host "[INFO] 正在初始化 Web Profile 配置..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "$env:DSH_HOME\\profiles\\web" | Out-Null
    Copy-Item -Force "$DIR\\profile\\package.json" "$env:DSH_HOME\\profiles\\web\\package.json"
    Copy-Item -Force "$DIR\\profile\\cordis.yml" "$env:DSH_HOME\\profiles\\web\\cordis.yml"
    Copy-Item -Force "$DIR\\profile\\cordis.patch.yml" "$env:DSH_HOME\\profiles\\web\\cordis.patch.yml"
}

# 4. 启动服务
$entry = "$DIR\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"
if (-not (Test-Path $entry)) {
    Write-Host "[ERROR] 未找到启动程序: $entry" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}

Write-Host "[INFO] 正在启动服务并在浏览器打开 http://127.0.0.1:$PORT ..." -ForegroundColor Green
Start-Process "http://127.0.0.1:$PORT"

Set-Location $DIR
node $entry web --port $PORT --host $HOST --no-open
`
  await fs.writeFile(path.join(outputDir, 'bin', 'start.ps1'), startPs1, 'utf8')

  const startBat = `@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if %errorlevel% neq 0 pause
`
  await writeBatchFile(path.join(outputDir, 'bin', 'start.bat'), startBat)

  const startSh = `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export DSH_HOME="\${DIR}/data"
export DSH_WEB_RUNTIME=1
export PORT="\${PORT:-3080}"
export HOST="\${HOST:-127.0.0.1}"
export NODE_ENV="production"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (>=20.0.0)"
  exit 1
fi

if [ ! -d "\${DIR}/node_modules/@deepseek-ai/dsh" ]; then
  echo "ℹ️ [INFO] 正在安装运行时依赖..."
  cd "\${DIR}"
  npm install --omit=dev --legacy-peer-deps
fi

node "\${DIR}/web-plugin-manager.mjs" "\${DIR}/node_modules" || exit $?

mkdir -p "\${DSH_HOME}/profiles/web"
[ -f "\${DIR}/profile/package.json" ] && cp "\${DIR}/profile/package.json" "\${DSH_HOME}/profiles/web/package.json"
[ -f "\${DIR}/profile/cordis.yml" ] && cp "\${DIR}/profile/cordis.yml" "\${DSH_HOME}/profiles/web/cordis.yml"
[ -f "\${DIR}/profile/cordis.patch.yml" ] && cp "\${DIR}/profile/cordis.patch.yml" "\${DSH_HOME}/profiles/web/cordis.patch.yml"

echo "🚀 启动服务: http://127.0.0.1:\${PORT}"
cd "\${DIR}"
exec node ./node_modules/@deepseek-ai/dsh/lib/bin.js web --port "\${PORT}" --host "\${HOST}" --no-open
`
  await fs.writeFile(path.join(outputDir, 'bin', 'start.sh'), startSh, 'utf8')
  await fs.chmod(path.join(outputDir, 'bin', 'start.sh'), 0o755)

  // 7. Create README
  const readme = `# 毕昇 Web 独立运行包 (BiSheng Web Portable Runtime)

基于 DeepSeek Harness 的便携式独立运行包，数据自闭环，开箱即用。

## 运行方式

### 方式 1：Windows 双击启动（最简单）
直接双击根目录下的 **\`启动.bat\`** ，浏览器会自动打开网页界面。
用完后直接关闭控制台窗口即可停止服务。

### 方式 2：Windows 命令行 (CMD / PowerShell)
在当前文件夹打开终端运行：
\`\`\`cmd
dsh web                        :: 启动网页界面 (默认端口 3080)
dsh web --port 8080            :: 指定端口启动
dsh headless "你的任务"        :: 命令行跑任务并直接输出
dsh --version                  :: 查看版本
dsh --help                     :: 查看帮助
\`\`\`

### 方式 3：macOS / Linux / Git Bash
\`\`\`bash
./dsh.sh web
./dsh.sh web --port 8080
./dsh.sh headless "你的任务"
\`\`\`

## 数据存储
所有会话记录、用户配置均存储在本文件夹内的 \`data/\` 目录中，不写入系统注册表或用户主目录。
`
  await fs.writeFile(path.join(outputDir, 'README.md'), readme, 'utf8')

  // 9. Create Zip Archive (using Python zipfile to preserve UTF-8 filenames across Windows/macOS)
  console.log('  -> Creating zip archive: bisheng-web-runtime.zip...')
  const pyZipScript = `
import os, sys, zipfile

dist_dir = sys.argv[1]
output_zip = sys.argv[2]
src_dir = os.path.join(dist_dir, 'bisheng-web-runtime')

with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src_dir):
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, dist_dir)
            info = zipfile.ZipInfo.from_file(full_path, rel_path)
            info.flag_bits |= 0x800  # Mark UTF-8 encoding so Windows Explorer won't corrupt Chinese filenames
            with open(full_path, 'rb') as fp:
                zf.writestr(info, fp.read())
`
  const zipResult = spawnSync('python3', ['-c', pyZipScript, distDir, zipFile], {
    cwd: distDir,
    stdio: 'inherit'
  })
  if (zipResult.status !== 0) {
    console.warn('  ⚠️ Warning: python3 zip creation failed, falling back to zip command')
    spawnSync('zip', ['-r', '-q', zipFile, 'bisheng-web-runtime'], {
      cwd: distDir,
      stdio: 'inherit'
    })
  } else {
    console.log(`  -> Zip created at: ${zipFile}`)
  }

  console.log(`✅ Packaging Complete! Location: ${outputDir}`)
}

packWebRuntime().catch((err) => {
  console.error('❌ Failed to pack web runtime:', err)
  process.exit(1)
})
