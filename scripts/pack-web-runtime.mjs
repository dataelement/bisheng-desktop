import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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

  // 1. Pack modified upstream packages and local plugins into tgz
  console.log('  -> Packing pre-compiled upstream packages from harness...')
  const packagesToPack = [
    { name: 'app-boot', dir: path.join(harnessRoot, 'packages/boot/app-boot') },
    { name: 'ui-chat', dir: path.join(harnessRoot, 'packages/client/ui-chat') },
    { name: 'ui-conversation', dir: path.join(harnessRoot, 'packages/client/ui-conversation') },
    { name: 'ui-workspace', dir: path.join(harnessRoot, 'packages/client/ui-workspace') },
    { name: 'enterprise', dir: path.join(projectRoot, 'packages/dsh-desktop-enterprise') },
    { name: 'workbenches', dir: path.join(projectRoot, 'packages/dsh-desktop-workbenches') }
  ]

  for (const pkg of packagesToPack) {
    console.log(`     Packing ${pkg.name}...`)
    const res = spawnSync('pnpm', ['--dir', pkg.dir, 'pack', '--pack-destination', depsDir], {
      stdio: 'inherit'
    })
    if (res.status !== 0) throw new Error(`Failed to pack ${pkg.name}`)
  }

  // 2. Discover generated tgz file names
  const tgzFiles = (await fs.readdir(depsDir)).filter(f => f.endsWith('.tgz'))
  console.log(`     Generated ${tgzFiles.length} tgz packages in deps/`)

  const appBootTgz = tgzFiles.find(f => f.includes('app-boot'))
  const uiChatTgz = tgzFiles.find(f => f.includes('ui-chat'))
  const uiConversationTgz = tgzFiles.find(f => f.includes('ui-conversation'))
  const uiWorkspaceTgz = tgzFiles.find(f => f.includes('ui-workspace'))
  const enterpriseTgz = tgzFiles.find(f => f.includes('enterprise'))
  const workbenchesTgz = tgzFiles.find(f => f.includes('workbenches'))

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
      '@deepseek-ai/dsh': '0.2.2-alpha.3',
      '@deepseek-ai/dsh-web-app': '0.2.2-alpha.3',
      '@deepseek-ai/dsh-app-boot': `file:./deps/${appBootTgz}`,
      '@deepseek-ai/dsh-client-ui-chat': `file:./deps/${uiChatTgz}`,
      '@deepseek-ai/dsh-client-ui-conversation': `file:./deps/${uiConversationTgz}`,
      '@deepseek-ai/dsh-client-ui-workspace': `file:./deps/${uiWorkspaceTgz}`,
      'dsh-desktop-enterprise': `file:./deps/${enterpriseTgz}`,
      'dsh-desktop-workbenches': `file:./deps/${workbenchesTgz}`
    }
  }
  await fs.writeFile(
    path.join(outputDir, 'package.json'),
    JSON.stringify(rootPackageJson, null, 2),
    'utf8'
  )

  // 4. Create profile package.json & cordis.yml
  console.log('  -> Creating profile configuration...')
  const profilePackageJson = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      'dsh-desktop-enterprise': `file:../../../deps/${enterpriseTgz}`,
      'dsh-desktop-workbenches': `file:../../../deps/${workbenchesTgz}`
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          'dsh-desktop-enterprise',
          'dsh-desktop-workbenches'
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

  // 5. Create start.ps1 (PowerShell script)
  console.log('  -> Creating bin/start.ps1 (PowerShell)...')
  const startPs1 = `# PowerShell Startup Script for BiSheng Web Runtime
$ErrorActionPreference = "Stop"
$DIR = Split-Path -Parent $PSScriptRoot
$env:DSH_HOME = "$DIR\\data"
$PORT = if ($env:PORT) { $env:PORT } else { "3080" }
$HOST = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$env:NODE_ENV = "production"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  BiSheng Web Runtime (PowerShell on Windows)" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Root:    $DIR"
Write-Host "  Data:    $env:DSH_HOME"
Write-Host "  URL:     http://localhost:$PORT"
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
        npm install --omit=dev
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] 依赖安装失败，请检查网络或 npm 配置" -ForegroundColor Red
        Read-Host "按回车键退出..."
        exit 1
    }
}

# 3. 初始化 Web Profile
if (-not (Test-Path "$env:DSH_HOME\\profiles\\web")) {
    Write-Host "[INFO] 正在初始化 Web Profile 配置..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "$env:DSH_HOME\\profiles\\web" | Out-Null
    Copy-Item -Force "$DIR\\profile\\package.json" "$env:DSH_HOME\\profiles\\web\\package.json"
    Copy-Item -Force "$DIR\\profile\\cordis.yml" "$env:DSH_HOME\\profiles\\web\\cordis.yml"
}

# 4. 启动服务
$entry = "$DIR\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"
if (-not (Test-Path $entry)) {
    Write-Host "[ERROR] 未找到启动程序: $entry" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}

Write-Host "[INFO] 正在启动服务并在浏览器打开 http://localhost:$PORT ..." -ForegroundColor Green
Start-Process "http://localhost:$PORT"

Set-Location $DIR
node $entry web --port $PORT --host $HOST --no-open
`
  await fs.writeFile(path.join(outputDir, 'bin', 'start.ps1'), startPs1, 'utf8')

  // 6. Create start.bat (Double-click entry for CMD / Explorer)
  console.log('  -> Creating bin/start.bat...')
  const startBat = `@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if %errorlevel% neq 0 pause
`
  await fs.writeFile(path.join(outputDir, 'bin', 'start.bat'), startBat, 'utf8')

  // 7. Create start.sh (for Linux/macOS)
  console.log('  -> Creating bin/start.sh...')
  const startSh = `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export DSH_HOME="\${DIR}/data"
export PORT="\${PORT:-3080}"
export HOST="\${HOST:-0.0.0.0}"
export NODE_ENV="production"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (>=20.0.0)"
  exit 1
fi

if [ ! -d "\${DIR}/node_modules/@deepseek-ai/dsh" ]; then
  echo "ℹ️ [INFO] 正在安装运行时依赖..."
  cd "\${DIR}"
  npm install --omit=dev
fi

mkdir -p "\${DSH_HOME}/profiles/web"
[ -f "\${DIR}/profile/package.json" ] && cp "\${DIR}/profile/package.json" "\${DSH_HOME}/profiles/web/package.json"
[ -f "\${DIR}/profile/cordis.yml" ] && cp "\${DIR}/profile/cordis.yml" "\${DSH_HOME}/profiles/web/cordis.yml"

echo "🚀 启动服务: http://localhost:\${PORT}"
cd "\${DIR}"
exec node ./node_modules/@deepseek-ai/dsh/lib/bin.js web --port "\${PORT}" --host "\${HOST}" --no-open
`
  await fs.writeFile(path.join(outputDir, 'bin', 'start.sh'), startSh, 'utf8')
  await fs.chmod(path.join(outputDir, 'bin', 'start.sh'), 0o755)

  // 8. Create README
  const readme = `# 毕昇 Web 独立运行包 (Dependency 方案)

无需 Git，无需克隆任何源码，纯依赖自闭环！

## Windows 运行方法 (PowerShell)
1. 确保安装了 **Node.js (>=20.0.0)**：https://nodejs.org/
2. **方法 A（双击）**：直接双击 \`bin\\start.bat\`。
3. **方法 B（PowerShell）**：打开 PowerShell 运行：
   \`\`\`powershell
   .\\bin\\start.ps1
   \`\`\`
首次启动会自动完成依赖装载并唤起默认浏览器打开 \`http://localhost:3080\`。
`
  await fs.writeFile(path.join(outputDir, 'README.md'), readme, 'utf8')

  // 9. Create Zip Archive
  console.log('  -> Creating zip archive: bisheng-web-runtime.zip...')
  const zipResult = spawnSync('zip', ['-r', '-q', zipFile, 'bisheng-web-runtime'], {
    cwd: distDir,
    stdio: 'inherit'
  })
  if (zipResult.status !== 0) {
    console.warn('  ⚠️ Warning: zip failed')
  } else {
    console.log(`  -> Zip created at: ${zipFile}`)
  }

  console.log(`✅ Packaging Complete! Location: ${outputDir}`)
}

packWebRuntime().catch((err) => {
  console.error('❌ Failed to pack web runtime:', err)
  process.exit(1)
})
