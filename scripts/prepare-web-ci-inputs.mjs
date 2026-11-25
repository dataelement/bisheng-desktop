/** Assemble locked native production inputs for the portable Web CI; never publish or modify a Profile. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const project = fileURLToPath(new URL('../', import.meta.url))
const EXCLUDED = new Set(['node_modules', '.git', '.bin', '.cache', '.npm-cache', '.pnpm-store', '.vite', '.vite-temp', '.vitest', '__pycache__', '.pytest_cache', 'coverage', '.DS_Store', '.npmrc', '.netrc', '.env'])
const forbidden = name => EXCLUDED.has(name) || name.startsWith('.env.') || name.startsWith('._') || name.endsWith('.tgz') || name.endsWith('.tsbuildinfo')
const contained = (root, target) => { const rel = path.relative(root, target); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function absent(target) {
  try { await fs.lstat(target) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error('Output already exists')
}

/** Reject aliases into the repository sources and all existing symlink ancestors before writing. */
export async function validateOutput(output, projectRoot = project) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new TypeError('Output must be an absolute new directory')
  const root = await fs.realpath(projectRoot)
  const resolved = path.resolve(output)
  for (const source of ['packages', 'scripts', 'patches', 'build', 'node_modules', '.git']) {
    const input = path.join(root, source)
    if (contained(input, resolved) || contained(resolved, input)) throw new Error('Output overlaps repository inputs')
  }
  if (resolved === root) throw new Error('Output overlaps repository root')
  for (let ancestor = resolved; ; ancestor = path.dirname(ancestor)) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Symlink in output ancestors') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (path.dirname(ancestor) === ancestor) break
  }
  await absent(resolved)
  return resolved
}

/** Copy only maintained inputs; do not ingest caches, dependency trees, credentials or undeclared host links. */
export async function copyInputs(source, destination) {
  await fs.cp(source, destination, { recursive: true, filter: async file => {
    if (file !== source && forbidden(path.basename(file))) return false
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlink in maintained build inputs')
    return true
  } })
}

/** Materialize the validated production closure into a new tree, without following any link outside trusted roots. */
export async function materializeLinks({ source, destination, allowedRoots = [], expectedLinks = {} }) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination)) throw new TypeError('Materialization paths must be absolute')
  const modules = await fs.realpath(source)
  const roots = [modules, ...await Promise.all(allowedRoots.map(root => fs.realpath(root)))]
  if (roots.some(root => contained(root, path.resolve(destination)) || contained(path.resolve(destination), root))) throw new Error('Materialization output overlaps its inputs')
  await absent(destination)
  let files = 0
  const visit = async (input, output, parents = new Set()) => {
    if (input !== source && (path.basename(input) === '.bin' || forbidden(path.basename(input)) && path.basename(input) !== 'node_modules')) return
    const info = await fs.lstat(input)
    const canonical = await fs.realpath(input)
    if (!roots.some(root => contained(root, canonical))) throw new Error('Production link escapes trusted package roots')
    if (info.isSymbolicLink() && forbidden(path.basename(canonical))) throw new Error('Production link targets excluded private input')
    const expected = expectedLinks[path.resolve(input)]
    if (info.isSymbolicLink() && expected && canonical !== await fs.realpath(expected)) throw new Error('Production package link has an unexpected owner')
    if ((await fs.stat(canonical)).isDirectory()) {
      if (parents.has(canonical)) throw new Error('Cyclic production package link')
      await fs.mkdir(output)
      const next = new Set([...parents, canonical])
      for (const name of (await fs.readdir(canonical)).sort()) await visit(path.join(canonical, name), path.join(output, name), next)
    } else if ((await fs.stat(canonical)).isFile()) {
      await fs.copyFile(canonical, output)
      files++
    } else throw new Error('Unsupported production file type')
  }
  await visit(source, destination)
  return { files }
}

/** Resolve the CLI belonging to the current Node installation; never execute a PATH npm shim. */
export async function resolveNpmCli({ execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {}) {
  const require = createRequire(import.meta.url)
  const candidates = []
  if (npmExecPath) candidates.push(npmExecPath)
  try {
    candidates.push(path.join(path.dirname(require.resolve('npm/package.json', { paths: [path.dirname(execPath), path.resolve(path.dirname(execPath), '../lib/node_modules')] })), 'bin/npm-cli.js'))
  } catch { /* Standalone Node layouts can carry npm without a resolvable package export. */ }
  candidates.push(path.resolve(path.dirname(execPath), '../lib/node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(execPath), 'node_modules/npm/bin/npm-cli.js'))
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || path.basename(candidate) !== 'npm-cli.js') continue
    try { if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate) }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
  }
  throw new Error('Cannot locate the current Node npm-cli.js')
}

export async function runNodeScript(script, args, { cwd, env = {}, label = 'build stage' } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    // Tool output may contain registry credentials or host paths. Expose only stage and exit status.
    child.stdout.resume()
    child.stderr.resume()
    child.once('error', error => reject(new Error(label + ' failed to start', { cause: error })))
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(label + ' failed (' + (signal ?? 'exit ' + code) + ')')))
  })
}

/** Preserve only reviewed lock-shaping booleans; never copy registry/auth configuration into artifacts. */
export async function readInstallFlags(projectRoot) {
  let contents
  try { contents = await fs.readFile(path.join(projectRoot, '.npmrc'), 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const flags = new Map()
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^\s*(legacy-peer-deps|install-links)\s*=\s*(.*?)\s*$/u.exec(line)
    if (!match) continue
    if (!['true', 'false'].includes(match[2])) throw new Error('Lock-shaping npm settings require literal booleans')
    flags.set(match[1], '--' + match[1] + '=' + match[2])
  }
  return [...flags.values()]
}

/** Install exactly the production lock graph and replay all patches using the already installed build tool. */
export async function prepareProductionModules({ staging, projectRoot = project, npmCli, cache }) {
  for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(projectRoot, name), path.join(staging, name))
  for (const name of ['packages', 'patches', 'scripts']) await copyInputs(path.join(projectRoot, name), path.join(staging, name))
  const original = await fs.readFile(path.join(staging, 'package-lock.json'))
  const lock = JSON.parse(original)
  const manifest = JSON.parse(await fs.readFile(path.join(staging, 'package.json'), 'utf8'))
  const expectedLinks = {}, allowedRoots = []
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (!spec.startsWith('file:')) continue
    const relative = spec.slice(5)
    const source = path.resolve(staging, relative)
    if (!contained(path.join(staging, 'packages'), source) || source === path.join(staging, 'packages')) throw new Error('Local production dependency leaves maintained package roots')
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
    if (pkg.name !== name) throw new Error('Local production dependency identity mismatch')
    allowedRoots.push(source)
    expectedLinks[path.join(staging, 'node_modules', name)] = source
  }
  const installFlags = await readInstallFlags(projectRoot)
  await runNodeScript(npmCli ?? await resolveNpmCli(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, ...installFlags], { cwd: staging, label: 'Locked production npm ci' })
  if (!original.equals(await fs.readFile(path.join(staging, 'package-lock.json')))) throw new Error('Production install changed the authoritative lockfile')
  const patchTool = path.join(projectRoot, 'node_modules/patch-package/index.js')
  await runNodeScript(patchTool, ['--error-on-fail'], { cwd: staging, env: { NODE_ENV: 'production' }, label: 'Complete production patch replay' })
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    const entry = lock.packages?.['node_modules/' + name]
    if (!entry?.dev) continue
    try { await fs.lstat(path.join(staging, 'node_modules', name)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error('Development-only package leaked into production install: ' + name)
  }
  for (const name of Object.keys(manifest.dependencies ?? {})) await fs.access(path.join(staging, 'node_modules', name, 'package.json'))
  return { allowedRoots, expectedLinks, lockSha256: digest(original), installFlags }
}

export async function prepareWebCiInputs(output, { projectRoot = project } = {}) {
  if (!['darwin', 'win32'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch) || process.platform === 'win32' && process.arch !== 'x64' || process.version !== 'v24.15.0' || process.versions.electron) throw new Error('Use native macOS arm64/x64 or Windows x64 with ordinary Node 24.15.0')
  output = await validateOutput(output, projectRoot)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output)
  const staging = await fs.mkdtemp(path.join(output, '.staging-'))
  const cache = path.join(projectRoot, '.tmp/npm-cache')
  await fs.mkdir(cache, { recursive: true })
  try {
    const production = await prepareProductionModules({ staging, projectRoot, cache })
    await fs.mkdir(path.join(staging, 'build'), { recursive: true })
    for (const name of ['icon.png', 'logo-light.png', 'logo-dark.png']) await fs.copyFile(path.join(projectRoot, 'build', name), path.join(staging, 'build', name))
    await runNodeScript(path.join(staging, 'scripts/release/install-brand-assets.mjs'), [], { cwd: staging, label: 'Production Web brand assets' })
    // Execute maintained generators through the installed build-tool closure, but direct every output into staging.
    const templateRoot = path.join(staging, '.build/ppt-runtime/templates')
    for (const name of ['generate-zara-ppt-templates.mjs', 'localize-ppt-templates.mjs', 'enrich-ppt-templates.mjs', 'build-ppt-runtime.mjs']) {
      await runNodeScript(path.join(projectRoot, 'scripts/ppt', name), [], { cwd: staging, env: { DSH_PPT_TEMPLATE_OUTPUT: templateRoot }, label: 'PPT source generation: ' + name })
    }
    const { prepareOfficeWebPackage } = await import('./pack-office-web.mjs')
    const { preparePptWebPackage } = await import('./pack-ppt-web.mjs')
    const { prepareWorkbenchWebPackage } = await import('./pack-workbenches-web.mjs')
    const office = await prepareOfficeWebPackage({ projectRoot: staging })
    const ppt = await preparePptWebPackage({ projectRoot: staging })
    const workbench = await prepareWorkbenchWebPackage({ projectRoot: staging })
    const projected = path.join(output, '.projection')
    await materializeLinks({ source: path.join(staging, 'node_modules'), destination: projected, allowedRoots: production.allowedRoots, expectedLinks: production.expectedLinks })
    // Replacements happen only inside our new output; retain originals in staging for failure diagnostics.
    for (const name of ['dsh-desktop-workbenches', 'dsh-desktop-office', 'dsh-ppt-composer', 'dsh-ppt']) {
      const target = path.join(projected, name)
      if (!contained(projected, target) || path.dirname(target) !== projected) throw new Error('Invalid package projection destination')
      await fs.rm(target, { recursive: true, force: true })
    }
    await fs.cp(workbench.packageDirectory, path.join(projected, 'dsh-desktop-workbenches'), { recursive: true })
    await fs.cp(office.packageDirectory, path.join(output, 'office'), { recursive: true })
    await fs.cp(ppt.packageDirectory, path.join(output, 'ppt'), { recursive: true })
    await fs.rename(projected, path.join(output, 'node_modules'))
    const canonicalOutput = await fs.realpath(output)
    const canonicalStaging = await fs.realpath(staging)
    if (path.dirname(canonicalStaging) !== canonicalOutput || !path.basename(canonicalStaging).startsWith('.staging-') || (await fs.lstat(staging)).isSymbolicLink()) throw new Error('Unexpected staging cleanup target')
    await fs.rm(canonicalStaging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ status: 'prepared', platform: process.platform, arch: process.arch,
      node: process.versions.node, lockSha256: production.lockSha256, npmInstallFlags: production.installFlags, productionInstall: true, patchReplay: true,
      brandAssets: true, officeTemplates: office.templateCount, pptTemplates: ppt.templateCount, workbenchWeb: true,
      runtimeAcceptance: false, publication: false }, null, 2) + '\n')
    console.log('Prepared locked native production modules and complete Office/PPT/Web workbench inputs; runtime acceptance remains separate.')
    return { modules: path.join(output, 'node_modules'), office: path.join(output, 'office'), ppt: path.join(output, 'ppt') }
  } catch (error) {
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ status: 'failed', runtimeAcceptance: false, publication: false }, null, 2) + '\n')
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/prepare-web-ci-inputs.mjs <absolute new output>')
  await prepareWebCiInputs(process.argv[2])
}
