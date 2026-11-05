import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outputDir = path.join(projectRoot, 'dist', 'bisheng-web-runtime')

async function packWebRuntime() {
  console.log('📦 Starting Web Runtime Packaging...')
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(path.join(outputDir, 'bin'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'patches'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'plugins'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'profile'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'data'), { recursive: true })

  // 1. Copy bin scripts
  console.log('  -> Copying bin scripts...')
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

  // 4. Create default profile
  console.log('  -> Creating default runtime profile...')
  const profilePackageJson = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      'dsh-desktop-enterprise': 'file:../../plugins/dsh-desktop-enterprise',
      'dsh-desktop-workbenches': 'file:../../plugins/dsh-desktop-workbenches'
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
  const readmeContent = `# 毕昇 / DeepSeek Harness Web 独立运行环境

## 🚀 启动方式

### Linux / macOS
\`\`\`bash
./bin/start.sh
\`\`\`

### Windows
双击运行 \`bin\\start.bat\` 或在终端中执行：
\`\`\`cmd
bin\\start.bat
\`\`\`

服务启动后，在浏览器中访问：\`http://localhost:3080\`。

---

## 📁 目录结构说明
- \`bin/\`: 启动控制脚本（start.sh, start.bat）。
- \`patches/\`: 针对官方 Harness 的 4 个精简核心补丁及合一补丁。
- \`plugins/\`: 预置的企业插件套件（SSO、LLM 反代、安全审计、知识库、模式切换）与工作台运行时。
- \`profile/\`: 运行时 Profile 与插件加载配置。
- \`data/\`: 用户会话与本地工作区持久化存储目录。
`
  await fs.writeFile(path.join(outputDir, 'README.md'), readmeContent, 'utf8')

  console.log(`✅ Web Runtime Packaged Successfully into: ${outputDir}`)
}

packWebRuntime().catch((err) => {
  console.error('❌ Failed to pack web runtime:', err)
  process.exit(1)
})
