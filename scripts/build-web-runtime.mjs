import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkWebHarnessVersion } from './web-runtime-version.mjs'
import { applyWebPluginManagerPatch } from './web-plugin-manager.mjs'
import { addWebSidebarSwitcher } from './web-sidebar-slot.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const outputDir = path.join(distDir, 'bisheng-web-runtime')
const dshDir = path.join(outputDir, 'dsh')
const dshHomeDir = path.join(outputDir, 'dsh-home')
const nodeDir = path.join(outputDir, 'node')

console.log('🚀 Starting BiSheng Web Runtime Packaging...')
console.log('Project root:', projectRoot)

async function run() {
  await fs.mkdir(distDir, { recursive: true })

  // 1. Check offline-base exists
  const offlineBase = path.join(projectRoot, '.build/offline-base/dsh')
  const downloadBase = path.join(os.homedir(), 'Downloads/dsh-portable/dsh-portable/dsh')

  let sourceDsh = null
  if (await fs.stat(offlineBase).catch(() => null)) {
    sourceDsh = offlineBase
  } else if (await fs.stat(downloadBase).catch(() => null)) {
    sourceDsh = downloadBase
  } else {
    throw new Error('Could not find base dsh runtime directory in .build/offline-base/dsh or ~/Downloads')
  }

  console.log(`📦 Using base dsh from: ${sourceDsh}`)
  await checkWebHarnessVersion(path.join(sourceDsh, 'node_modules'))
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  // 2. Copy dsh runtime
  console.log('📂 Copying dsh runtime...')
  await fs.cp(sourceDsh, dshDir, { recursive: true })
  await applyWebPluginManagerPatch(path.join(dshDir, 'node_modules'))

  const sidebar = path.join(dshDir, "node_modules/@deepseek-ai/dsh-client-ui-sidebar")
  const sidebarClient = path.join(sidebar, "lib/client.js")
  if (await fs.stat(sidebarClient).catch(() => null)) {
    console.log("  -> Patching sidebar quickSwitcher slot...")
    const raw = await fs.readFile(sidebarClient, "utf8")
    if (!raw.includes("sidebar.quickSwitcher")) {
      await fs.writeFile(sidebarClient, addWebSidebarSwitcher(raw))
      console.log("  -> Successfully added sidebar.quickSwitcher slot!")
    }
  }


  // 3. Ensure custom plugins are synced into dsh/node_modules
  const customPlugins = [
    'dsh-desktop-client-ui',
    'dsh-desktop-enterprise',
    'dsh-desktop-workbenches',
    'dsh-desktop-office',
    'dsh-ppt-composer'
  ]

  console.log('🔌 Syncing custom BiSheng plugins into dsh/node_modules...')
  for (const name of customPlugins) {
    const src = path.join(projectRoot, 'packages', name)
    const dst = path.join(dshDir, 'node_modules', name)
    if (await fs.stat(src).catch(() => null)) {
      await fs.cp(src, dst, { recursive: true })
      console.log(`  -> Synced packages/${name}`)
    } else {
      console.log(`  -> Skipped packages/${name} (already in base)`)
    }
  }

  // 4. Setup Windows portable Node.js runtime
  const sourceNode = path.join(projectRoot, 'dist/bisheng-web-runtime-test/node')
  const downloadNode = path.join(os.homedir(), 'Downloads/dsh-portable/dsh-portable/node')
  let nodeSource = (await fs.stat(path.join(sourceNode, 'node.exe')).catch(() => null)) ? sourceNode : downloadNode

  if (await fs.stat(path.join(nodeSource, 'node.exe')).catch(() => null)) {
    console.log(`🟢 Bundling Windows Node.js runtime from: ${nodeSource}`)
    await fs.cp(nodeSource, nodeDir, { recursive: true })
  } else {
    console.warn('⚠️ Warning: Windows node.exe not found in local staging directories.')
  }

  // 5. Setup dsh-home profile configuration
  console.log('⚙️ Initializing dsh-home web profile...')
  const webProfileDir = path.join(dshHomeDir, 'profiles', 'web')
  await fs.mkdir(webProfileDir, { recursive: true })

  const profilePkg = {
    "name": "dsh-profile-web",
    "private": true,
    "dependencies": {},
    "dsh": {
      "profile": {
        "bundles": [
          "@deepseek-ai/dsh-base",
          "@deepseek-ai/dsh-web-app",
          "dsh-desktop-client-ui",
          "dsh-desktop-enterprise",
          "dsh-desktop-workbenches",
          "dsh-desktop-office",
          "dsh-ppt-composer"
        ]
      }
    }
  }
  await fs.writeFile(path.join(webProfileDir, 'package.json'), JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(webProfileDir, 'cordis.yml'), '[]\n', 'utf8')
  await fs.writeFile(path.join(webProfileDir, 'cordis.patch.yml'), '- id: ui-brand-official\n  disabled: true\n', 'utf8')

  // 6. Generate Clean Windows Launch Scripts (Strict CRLF)
  console.log('📝 Generating Windows CMD & BAT launchers...')
  const cmdContent = `@ECHO OFF
SETLOCAL
REM ===================================================================
REM  BiSheng Web Runtime (DeepSeek Harness) Portable Offline Launcher
REM  Supports: Windows CMD / PowerShell
REM ===================================================================

SET "PORTABLE_ROOT=%~dp0"
SET "DSH_NODE=%PORTABLE_ROOT%node\\node.exe"
SET "DSH_ENTRY=%PORTABLE_ROOT%dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"
SET "DSH_HOME=%PORTABLE_ROOT%dsh-home"
SET "DSH_WEB_RUNTIME=1"

SET "PATH=%PORTABLE_ROOT%node;%PATH%"

IF NOT EXIST "%DSH_NODE%" (
  ECHO [bisheng-portable] ERROR: bundled node.exe not found:
  ECHO   %DSH_NODE%
  SET "RC=1"
  GOTO finish
)

IF NOT EXIST "%DSH_ENTRY%" (
  ECHO [bisheng-portable] ERROR: dsh entry point not found:
  ECHO   %DSH_ENTRY%
  SET "RC=1"
  GOTO finish
)

IF "%~1"=="" GOTO show_usage

"%DSH_NODE%" "%DSH_ENTRY%" %*
SET "RC=%ERRORLEVEL%"
GOTO finish

:show_usage
ECHO.
ECHO   BiSheng Web Runtime  -  DeepSeek Harness (Portable Offline)
ECHO   ===========================================================
ECHO.
ECHO   Usage:
ECHO     dsh web                        start browser UI (default port 3080)
ECHO     dsh web --port 8080            start with custom port
ECHO     dsh headless "your task"       run task and print result
ECHO     dsh --version                  show version
ECHO     dsh --help                     show help
ECHO.
ECHO   Data directory: %DSH_HOME%
ECHO.
SET "RC=1"

:finish
ENDLOCAL & EXIT /B %RC%
`.replace(/\r?\n/g, '\r\n')
  await fs.writeFile(path.join(outputDir, 'dsh.cmd'), cmdContent, 'ascii')

  const batContent = `@ECHO OFF
CHCP 65001 >NUL
SETLOCAL
CD /D "%~dp0"
TITLE BiSheng Web Runtime (DeepSeek Harness)

ECHO ===================================================
ECHO   BiSheng Web Runtime (DeepSeek Harness)
ECHO ===================================================
ECHO.
ECHO 正在启动 Web UI (默认端口 3080)...
ECHO 启动完成后请在浏览器中访问: http://localhost:3080
ECHO 按 Ctrl+C 可以停止服务。
ECHO.

:run_service
ECHO 正在启动 Web UI (默认端口 3080)...
ECHO 启动完成后请在浏览器中访问: http://localhost:3080
ECHO 按 Ctrl+C 可以停止服务。
ECHO.

CALL "%~dp0dsh.cmd" web
SET "RC=%ERRORLEVEL%"

IF "%RC%"=="42" (
  ECHO.
  ECHO ========================================================
  ECHO   [BiSheng] 收到重启请求，正在自动重新启动 Web 服务...
  ECHO ========================================================
  ECHO.
  TIMEOUT /T 1 /NOBREAK >NUL 2>&1
  GOTO run_service
)

IF %RC% NEQ 0 (
  ECHO.
  ECHO 运行退出，退出码: %RC%
  PAUSE
)

ENDLOCAL & EXIT /B %RC%
`.replace(/\r?\n/g, '\r\n')
  await fs.writeFile(path.join(outputDir, '启动.bat'), batContent, 'utf8')

  const shContent = `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export DSH_HOME="\${DIR}/dsh-home"
export DSH_WEB_RUNTIME=1

NODE_BIN="node"
if [ -f "\${DIR}/node/bin/node" ]; then
  NODE_BIN="\${DIR}/node/bin/node"
  export PATH="\${DIR}/node/bin:\$PATH"
fi

ENTRY="\${DIR}/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"

if [ ! -f "\${ENTRY}" ]; then
  echo "Error: entry point not found: \${ENTRY}"
  exit 1
fi

exec "\${NODE_BIN}" "\${ENTRY}" "$@"
`
  await fs.writeFile(path.join(outputDir, 'dsh.sh'), shContent, 'utf8')
  await fs.chmod(path.join(outputDir, 'dsh.sh'), 0o755)

  // 7. Prune safe non-executable files to optimize size and avoid path limit
  console.log('🧹 Pruning non-executable assets (tests, maps, typings)...')
  const pruneScript = `
import os, shutil

target = '${path.join(outputDir, 'dsh/node_modules')}'
safe_exts = {'.map', '.d.ts', '.d.ts.map', '.markdown'}
safe_names = {'changelog.md', '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.prettierrc'}

for root, dirs, files in os.walk(target, topdown=False):
    for f in files:
        fl = f.lower()
        if f == 'SKILL.md' or f == 'package.json':
            continue
        if any(fl.endswith(ext) for ext in safe_exts) or fl in safe_names:
            try:
                os.remove(os.path.join(root, f))
            except Exception:
                pass
    for d in dirs:
        if d.lower() in {'__tests__', 'coverage', '.github'}:
            dp = os.path.join(root, d)
            has_code = any(f.endswith(('.js', '.cjs', '.mjs', '.node')) for _, _, fl in os.walk(dp) for f in fl)
            if not has_code:
                shutil.rmtree(dp, ignore_errors=True)
`
  spawnSync('python3', ['-c', pruneScript], { stdio: 'inherit' })

  console.log('✅ BiSheng Web Runtime staging assembled successfully!')
}

run().catch(err => {
  console.error('❌ Build failed:', err)
  process.exit(1)
})
