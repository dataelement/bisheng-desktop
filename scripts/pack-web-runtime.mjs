import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(projectRoot, 'dist')
const outputDir = path.join(distDir, 'bisheng-web-runtime')
const zipFile = path.join(distDir, 'bisheng-web-runtime.zip')

async function packWebRuntime() {
  console.log('📦 Starting Web Runtime Packaging...')
  await fs.mkdir(distDir, { recursive: true })
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.rm(zipFile, { force: true })

  await fs.mkdir(path.join(outputDir, 'bin'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'patches'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'plugins'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'profile'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'data'), { recursive: true })

  // 1. Copy bin scripts
  console.log('  -> Copying bin scripts (start.sh, start.bat)...')
  await fs.copyFile(path.join(projectRoot, 'bin', 'start.sh'), path.join(outputDir, 'bin', 'start.sh'))
  await fs.copyFile(path.join(projectRoot, 'bin', 'start.bat'), path.join(outputDir, 'bin', 'start.bat'))
  await fs.chmod(path.join(outputDir, 'bin', 'start.sh'), 0o755)

  // 2. Copy patches
  console.log('  -> Copying 3080 upstream patches...')
  const patchFiles = await fs.readdir(path.join(projectRoot, 'patches'))
  for (const file of patchFiles) {
    if (file.endsWith('.patch')) {
      await fs.copyFile(path.join(projectRoot, 'patches', file), path.join(outputDir, 'patches', file))
    }
  }

  // 3. Copy enterprise and workbench plugins
  console.log('  -> Packaging plugins (dsh-desktop-enterprise, dsh-desktop-workbenches)...')
  await fs.cp(
    path.join(projectRoot, 'packages', 'dsh-desktop-enterprise'),
    path.join(outputDir, 'plugins', 'dsh-desktop-enterprise'),
    { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.stage') }
  )
  await fs.cp(
    path.join(projectRoot, 'packages', 'dsh-desktop-workbenches'),
    path.join(outputDir, 'plugins', 'dsh-desktop-workbenches'),
    { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.stage') }
  )

  // 4. Create default profile (resolves 3 levels up from data/profiles/web)
  console.log('  -> Creating default runtime profile...')
  const profilePackageJson = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      'dsh-desktop-enterprise': 'file:../../../plugins/dsh-desktop-enterprise',
      'dsh-desktop-workbenches': 'file:../../../plugins/dsh-desktop-workbenches'
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
  await fs.writeFile(
    path.join(outputDir, 'profile', 'cordis.yml'),
    '[]\n',
    'utf8'
  )

  // 5. Create README for runtime distribution
  const readmeContent = `# 毕昇 / DeepSeek Harness Web 运行环境 (Windows / Linux / macOS)

## 快速上手

### Windows 环境测试指南
1. 确保已安装 **Node.js (>=20.0.0，推荐 Node 22+)**：https://nodejs.org/
2. 如果同级目录下已有 \`deepseek-harness\` 仓库，直接双击运行 \`bin\\start.bat\` 即可。
3. 若需在全新 Windows 机器部署：
   - 克隆官方 Harness 仓库：\`git clone https://github.com/deepseek-ai/deepseek-harness.git\`
   - 切换基线版本：\`cd deepseek-harness && git checkout dsh-v0.2.2-alpha.3\`
   - 应用 3080 补丁：\`git apply ..\\bisheng-web-runtime\\patches\\harness-web-3080-unified.patch\`
   - 安装依赖：\`pnpm install\`
   - 回到本目录，双击 \`bin\\start.bat\` 启动服务！
4. 浏览器打开 \`http://localhost:3080\` 访问。

### Linux / macOS
\`\`\`bash
./bin/start.sh
\`\`\`

---

## 目录结构
- \`bin/\`: 启动控制脚本（start.sh, start.bat）
- \`patches/\`: 3080 现场全量核心补丁 (\`harness-web-3080-unified.patch\`)
- \`plugins/\`: 企业插件套件（SSO、反代、知识库、模式切换）与工作台运行时
- \`profile/\`: 运行时 Profile 与插件依赖声明
- \`data/\`: 运行时数据与工作区持久化存储
`
  await fs.writeFile(path.join(outputDir, 'README.md'), readmeContent, 'utf8')

  // 6. Create Zip Archive
  console.log('  -> Creating zip archive: bisheng-web-runtime.zip...')
  const zipResult = spawnSync('zip', ['-r', '-q', zipFile, 'bisheng-web-runtime'], {
    cwd: distDir,
    stdio: 'inherit'
  })
  if (zipResult.status !== 0) {
    console.warn('  ⚠️ Warning: zip command failed or not available, skipping zip archive creation.')
  } else {
    console.log(`  -> Zip created at: ${zipFile}`)
  }

  console.log(`✅ Web Runtime Packaged Successfully into: ${outputDir}`)
}

packWebRuntime().catch((err) => {
  console.error('❌ Failed to pack web runtime:', err)
  process.exit(1)
})
