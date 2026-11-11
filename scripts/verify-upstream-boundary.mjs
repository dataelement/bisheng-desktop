// Invoked with node: avoid CRLF shebangs breaking Vite/Vitest module imports.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 下游只拥有企业业务、品牌和独立 Web 交付；公共底座必须先在上游评审。
const ALLOWED_PATTERNS = [
  /^packages\/dsh-desktop-enterprise\//,
  /^packages\/dsh-desktop-office\/(?:lib\/web-(?:modes\.(?:js|d\.ts)|runtime\.js)|web-(?:cli\.mjs|index\.(?:js|d\.ts)))$/,
  /^packages\/dsh-desktop-workbenches\/(?:web-package-backend\.(?:mjs|d\.mts)|local-archive\.mjs)$/,
  /^build\/bisheng-/,
  /^build\/(?:app-icon\.png|icon\.(?:png|ico|icns)|dsh-desktop\.patch\.yml)$/,
  /^build\/web-runtime\//,
  /^bin\/start\.(?:sh|bat)$/,
  /^ops\/ci\//,
  /^ops\/nginx\/work-updates\.conf$/,
  /^scripts\/mock-bisheng-enterprise\.d\.mts$/,
  /^\.github\/workflows\/(?:release|build-web-runtime|verify-boundary|bisheng-ci)\.yml$/,
  /^scripts\/(?:verify-upstream-boundary|pack-(?:office-web|ppt-web|workbenches-web|web-runtime)|prepare-web-ci-inputs|build-web-runtime|stage-windows-web-runtime|check-web-runtime-import|mock-bisheng-enterprise|web-sidebar-slot|web-runtime-version|web-plugin-manager)\.mjs$/,
  /^docs\/downstream-[^/]+\.md$/,
  /^docs\/architecture-setup-plan\.md$/,
  /^test\/(?:enterprise-|web-runtime-)[^/]+\.(?:mjs|js|ts|mts)$/,
  /^(?:package\.json|package-lock\.json|tsconfig\.node\.json|electron\.vite\.config\.ts|electron-builder(?:\.[^/]+)?\.cjs|AGENTS\.md|\.gitignore)$/
]

function git(cwd, args, input) {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}

const splitPaths = text => text.split('\0').filter(Boolean)

export function getUpstreamBase(cwd, upstreamBase = process.env.UPSTREAM_BASE) {
  const ref = upstreamBase === undefined ? 'upstream/bisheng-adaptor' : upstreamBase
  if (!ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new Error('无效 UPSTREAM_BASE')
  try {
    const commit = git(cwd, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim()
    return { ref, commit }
  } catch {
    throw new Error('无法验证上游基准 ' + JSON.stringify(ref) + '；请 fetch 已评审的 upstream/bisheng-adaptor 或显式设置 UPSTREAM_BASE。禁止回退到 origin/main 或 HEAD~1。')
  }
}

export function collectChanges({ cwd = process.cwd(), upstreamBase = process.env.UPSTREAM_BASE } = {}) {
  cwd = git(cwd, ['rev-parse', '--show-toplevel']).trim()
  const base = getUpstreamBase(cwd, upstreamBase)
  // 即使双点比较可执行，无共同祖先也必须失败，不能掩盖错误的仓库/基准。
  try {
    git(cwd, ['merge-base', base.commit, 'HEAD'])
  } catch {
    throw new Error('上游基准与 HEAD 无法计算 merge-base；请检查 fetch 深度和基准，门禁不会降级比较。')
  }
  const diff = (...args) => splitPaths(git(cwd, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', ...args, '--']))
  // 双点包含尚未同步的上游变更；仅 triple-dot 会遗漏这些底座漂移。
  const committed = diff(base.commit, 'HEAD')
  const staged = diff('--cached', 'HEAD')
  const working = diff()
  const untracked = splitPaths(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']))
    .filter(file => !file.startsWith('.tmp/'))
  const files = [...new Set([...committed, ...staged, ...working, ...untracked])].sort()
  return { cwd, base, files, staged, working, untracked }
}

function treeEntries(cwd, commit) {
  return new Map(splitPaths(git(cwd, ['ls-tree', '-r', '-z', commit])).map(record => {
    const tab = record.indexOf('	')
    const [mode, type, oid] = record.slice(0, tab).split(' ')
    return [record.slice(tab + 1), { mode, type, oid }]
  }))
}

function indexEntries(cwd) {
  const entries = new Map()
  for (const record of splitPaths(git(cwd, ['ls-files', '--stage', '-z']))) {
    const tab = record.indexOf('	')
    const [mode, oid, stage] = record.slice(0, tab).split(' ')
    const file = record.slice(tab + 1)
    entries.set(file, stage === '0' ? { mode, oid, type: mode === '160000' ? 'commit' : 'blob' } : { type: 'unmerged' })
  }
  return entries
}

function worktreeEntry(cwd, file) {
  const absolute = path.join(cwd, file)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
    throw error
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) return { type: 'unsupported' }
  const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
  const bytes = stat.isSymbolicLink() ? readlinkSync(absolute, { encoding: 'buffer' }) : readFileSync(absolute)
  const oid = git(cwd, ['hash-object', '--no-filters', '--stdin'], bytes).trim()
  return { mode, type: 'blob', oid }
}

function sameEntry(left, right) {
  if (!left || !right) return left === right
  return left.type === right.type && left.mode === right.mode && left.oid === right.oid
}

// 纯路径规则；core 的例外只能由调用者提供已核对 bytes + mode 的集合。
export function checkPaths(files, { upstreamMatches = new Set(), legacyDeletions = new Set() } = {}) {
  return files.filter(file => {
    if (file === '.tmp' || file.startsWith('.tmp/')) return true
    return !ALLOWED_PATTERNS.some(pattern => pattern.test(file)) && !legacyDeletions.has(file) && !upstreamMatches.has(file)
  })
}

export function checkBoundary(options = {}) {
  const changes = collectChanges(options)
  const baseline = treeEntries(changes.cwd, changes.base.commit)
  const index = indexEntries(changes.cwd)
  const staged = new Set(changes.staged)
  const untracked = new Set(changes.untracked)
  const upstreamMatches = new Set()
  const legacyDeletions = new Set()
  for (const file of changes.files) {
    if (ALLOWED_PATTERNS.some(pattern => pattern.test(file))) continue
    const actual = worktreeEntry(changes.cwd, file)
    // 仅允许真实旧企业安装适配文件删除，不能借迁移名义继续改公共工作台代码。
    if (/^packages\/dsh-desktop-workbenches\/(?:enterprise-install|install-outcome)\.mjs$/.test(file) && !actual && (!staged.has(file) || !index.has(file))) {
      legacyDeletions.add(file)
    }
    if (!untracked.has(file) && sameEntry(actual, baseline.get(file)) && (!staged.has(file) || sameEntry(index.get(file), baseline.get(file)))) {
      upstreamMatches.add(file)
    }
  }
  return { ...changes, illegalFiles: checkPaths(changes.files, { upstreamMatches, legacyDeletions }) }
}

export function run() {
  try {
    const result = checkBoundary()
    console.log('🔍 [Boundary Gatekeeper] 已验证上游基准 ' + result.base.ref + ' (' + result.base.commit + ')')
    if (result.illegalFiles.length) {
      console.error('❌ 下游底座漂移：以下文件不属于企业白名单，或最终 bytes / filemode 与已评审上游不一致：')
      for (const file of result.illegalFiles) console.error('  ⛔ ' + JSON.stringify(file))
      console.error('请先在上游通过 PR + CI 合入底座修复，再同步到下游；禁止放宽门禁绕过。')
      return 1
    }
    console.log('✅ 边界检查通过，共检查 ' + result.files.length + ' 个文件（企业白名单或与上游完全一致）。')
    return 0
  } catch (error) {
    console.error('❌ [Boundary Gatekeeper] ' + error.message)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run()
