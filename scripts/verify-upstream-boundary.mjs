#!/usr/bin/env node
import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * Downstream Fork 边界规则门禁 (CI Boundary Gatekeeper)
 *
 * 核心目的:
 * 防止开发者直接在下游 (bisheng-work / bisheng-desktop) 随意修改底座平台代码 (src/main, src/host, patches 等)。
 * 强制底座代码的任何修复与功能演进必须在 upstream (dataelem/dsh-desktop) 发生并闭环。
 */

// 1. 下游合法扩展白名单模式 (Whitelist patterns for downstream)
const ALLOWED_PATTERNS = [
  /^packages\/dsh-desktop-enterprise\//,
  /^packages\/dsh-desktop-office\/(lib\/web-|web-)/,
  /^packages\/dsh-desktop-workbenches\/(web-package-backend|enterprise-install|install-outcome|local-archive)/,
  /^build\/bisheng-/,
  /^build\/app-icon\.png$/,
  /^build\/icon\.(png|ico|icns)$/,
  /^build\/web-runtime\//,
  /^build\/dsh-desktop\.patch\.yml$/,
  /^bin\/start\.(sh|bat)$/,
  /^ops\//,
  /^\.github\/workflows\/build-web-runtime\.yml$/,
  /^\.github\/workflows\/verify-boundary\.yml$/,
  /^scripts\/verify-upstream-boundary\.mjs$/,
  /^scripts\/pack-web-runtime\.mjs$/,
  /^scripts\/build-web-runtime\.mjs$/,
  /^scripts\/stage-windows-web-runtime\.mjs$/,
  /^scripts\/check-web-runtime-import\.mjs$/,
  /^scripts\/mock-bisheng-enterprise\./,
  /^scripts\/web-/,
  /^docs\/downstream-/,
  /^docs\/architecture-setup-plan\.md$/,
  /^test\/enterprise-/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^\.gitignore$/
]

// 2. 获取比对基准 (Upstream Ref)
function getUpstreamBase() {
  const envBase = process.env.UPSTREAM_BASE
  if (envBase) return envBase

  // 尝试检查 upstream 分支
  const candidateRefs = [
    'upstream/upgrade/dsh-0.2.2-rc.1',
    'origin/upgrade/dsh-0.2.2-rc.1',
    'upstream/main',
    'origin/main'
  ]

  for (const ref of candidateRefs) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { stdio: 'ignore' })
      return ref
    } catch {
      // ignore
    }
  }

  // 兜底回退到上一次提交
  return 'HEAD~1'
}

function run() {
  const baseRef = getUpstreamBase()
  console.log(`🔍 [Boundary Gatekeeper] 正在检查相对上游 [${baseRef}] 的所有文件修改...`)

  let diffOutput = ''
  try {
    // 包含已提交、已暂存和工作区未暂存的所有修改
    diffOutput = execSync(`git diff --name-only ${baseRef}`, { encoding: 'utf8' }).trim()
  } catch (error) {
    console.warn(`⚠️ 无法通过 ${baseRef} 获取 diff:`, error.message)
    diffOutput = execSync(`git status --porcelain`, { encoding: 'utf8' })
      .split('\n')
      .map(line => line.slice(3).trim())
      .filter(Boolean)
      .join('\n')
  }

  if (!diffOutput) {
    console.log('✅ [Boundary Gatekeeper] 无变动文件，门禁通过。')
    process.exit(0)
  }

  const changedFiles = diffOutput.split('\n').map(f => f.trim()).filter(Boolean)
  const illegalFiles = []

  for (const file of changedFiles) {
    const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(file))
    if (!isAllowed) {
      illegalFiles.push(file)
    }
  }

  if (illegalFiles.length > 0) {
    console.error('\n' + '='.repeat(68))
    console.error('❌ [CI 门禁拦截] 检测到底座平台文件被直接修改！')
    console.error('='.repeat(68))
    console.error('根据《Downstream Fork 架构规范》，严禁在下游商业仓库直接修改底座核心代码：')
    for (const f of illegalFiles) {
      console.error(`  ⛔ ${f}`)
    }
    console.error('-'.repeat(68))
    console.error('💡 正确修复流程：')
    console.error('  1. 请切到上游仓库 (dataelem/dsh-desktop) 对应的开发分支；')
    console.error('  2. 在上游编写测试用例并完成 Bug 修复 / 能力演进；')
    console.error('  3. 上游合入后，在当前仓库通过 git rebase upstream 同步底座更新。')
    console.error('='.repeat(68) + '\n')
    process.exit(1)
  }

  console.log(`✅ [Boundary Gatekeeper] 检查通过！共 ${changedFiles.length} 个修改文件均在下游白名单内。`)
  process.exit(0)
}

run()
