/** Local Web distribution experiment. Consume generated Desktop staging; never publish or edit Profiles. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { replaceInstalledPackages } from './ppt/ppt-package-projection.mjs'

const PACKAGE_NAME = 'dsh-ppt-composer'
const CORE_NAME = 'dsh-ppt'

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\')) throw new Error('Invalid package-relative path: ' + relative)
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(root + path.sep)) throw new Error('Path escapes package root: ' + relative)
  return resolved
}

async function requireFile(file) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.size === 0) throw new Error('Missing or empty staged file: ' + file)
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

// These files are generated JSON literals, not arbitrary JavaScript to execute during packaging.
async function generatedExport(file, name) {
  const source = await fs.readFile(file, 'utf8')
  const line = source.split('\n').find(line => line.startsWith('export const ' + name + ' = '))
  if (!source.startsWith('// Generated ') || !line) throw new Error('Missing generated ' + name + ': ' + file)
  return JSON.parse(line.slice(('export const ' + name + ' = ').length).replace(/;$/, ''))
}

async function validateSeeds(core) {
  const definitions = await generatedExport(path.join(core, 'lib/catalog.js'), 'definitions')
  const semantics = await generatedExport(path.join(core, 'lib/catalog.js'), 'semantics')
  const previews = await generatedExport(path.join(core, 'lib/preview-manifest.js'), 'previewFiles')
  if (!Array.isArray(definitions) || !definitions.length || !semantics || !previews || !Object.keys(previews).length) {
    throw new Error('Generated catalog and preview manifest must not be empty')
  }
  const references = path.join(core, 'skills/dsh-ppt/references')
  const previewPaths = new Set(Object.values(previews))
  const ids = new Set()
  for (const definition of definitions) {
    if (!definition?.id || ids.has(definition.id) || !semantics[definition.id]) throw new Error('Invalid generated catalog definition')
    ids.add(definition.id)
    const reference = inside(references, definition.referenceDirectory)
    const count = definition.referencePageCount
    if (!Number.isInteger(count) || count < 1) throw new Error('Invalid seed page count: ' + definition.id)
    await requireFile(path.join(reference, 'design.md'))
    for (const variant of ['source', 'source-zh']) {
      await requireFile(path.join(reference, variant, 'deck.pptd'))
      for (let number = 1; number <= count; number++) {
        await requireFile(path.join(reference, variant, 'pages', String(number).padStart(2, '0') + '.page'))
      }
    }
    for (let number = 1; number <= count; number++) {
      const relative = definition.referenceDirectory + '/pages/' + String(number).padStart(2, '0') + '.jpg'
      if (!previewPaths.has(relative)) throw new Error('Missing generated seed preview: ' + relative)
    }
  }
  for (const [hash, relative] of Object.entries(previews)) {
    const file = inside(references, relative)
    await requireFile(file)
    const actual = createHash('sha256').update(await fs.readFile(file)).digest('hex')
    if (hash !== actual) throw new Error('Stale generated seed preview: ' + relative)
  }
  return definitions.length
}

function mergeExact(core, adapter, field) {
  const merged = { ...core[field] }
  for (const [name, range] of Object.entries(adapter[field] ?? {})) {
    if (name === CORE_NAME) continue
    if (merged[name] !== undefined && merged[name] !== range) {
      throw new Error('Conflicting ' + field + ' for ' + name + ': ' + merged[name] + ' vs ' + range)
    }
    merged[name] = range
  }
  delete merged[CORE_NAME]
  return merged
}

async function copyPackage(source, target) {
  await fs.cp(source, target, {
    recursive: true,
    filter: async file => {
      const name = path.basename(file)
      if (['node_modules', '.git', '.DS_Store', 'package-lock.json'].includes(name) || name.startsWith('._') || name.endsWith('.tgz')) return false
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlink in staged package: ' + file)
      return true
    }
  })
}

async function rewriteCoreImport(file, relative) {
  const source = await fs.readFile(file, 'utf8')
  const matcher = /from (["'])dsh-ppt\1/g
  if (!matcher.test(source)) throw new Error('Missing expected adapter core import: ' + file)
  await fs.writeFile(file, source.replace(matcher, 'from ' + JSON.stringify(relative)))
}

/** Generate one installable bundle directory beneath projectRoot/.build, preserving source manifests and peer ranges. */
export async function preparePptWebPackage(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const buildRoot = path.join(projectRoot, '.build')
  const stagingRoot = path.resolve(projectRoot, options.stagingRoot ?? '.build/ppt-runtime/packages')
  const outputRoot = path.resolve(projectRoot, options.outputRoot ?? '.build/ppt-web')
  if (!outputRoot.startsWith(buildRoot + path.sep) || outputRoot === stagingRoot || outputRoot.startsWith(stagingRoot + path.sep) || stagingRoot.startsWith(outputRoot + path.sep)) {
    throw new Error('Web output must be separate from staging and beneath projectRoot/.build')
  }
  // Reject symlinked output ancestors before any writes or replacement operations.
  let ancestor = outputRoot
  while (ancestor !== projectRoot) {
    try {
      if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Symlink in Web output path: ' + ancestor)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    ancestor = path.dirname(ancestor)
  }
  const core = path.join(stagingRoot, CORE_NAME)
  const adapter = path.join(stagingRoot, PACKAGE_NAME)
  const coreManifest = await readJson(path.join(core, 'package.json'))
  const manifest = await readJson(path.join(adapter, 'package.json'))
  if (coreManifest.name !== CORE_NAME || manifest.name !== PACKAGE_NAME) throw new Error('Unexpected staged PPT package names')
  const templateCount = await validateSeeds(core)
  for (const file of ['web-mode-policy.js', 'office-pptx-scope-policy.js', 'office-pptx-scope-policy.d.ts']) {
    await requireFile(path.join(core, 'lib', file))
  }
  const client = await fs.readFile(path.join(adapter, 'lib/client.js'), 'utf8')
  if (/GENERATED_PPT_PREVIEWS|PERSONAL_TEMPLATE_MANAGER/.test(client)) throw new Error('Adapter client has not been generated')
  manifest.dependencies = mergeExact(coreManifest, manifest, 'dependencies')
  manifest.peerDependencies = mergeExact(coreManifest, manifest, 'peerDependencies')
  const scopeRange = manifest.peerDependencies['@deepseek-ai/dsh-agent']
  if (!scopeRange) throw new Error('Missing dsh-agent peer range for Web scope policy')
  // Session policy uses the existing Agent context; no separate scope runtime.
  delete manifest.peerDependencies['@deepseek-ai/dsh-scope']
  manifest.peerDependenciesMeta = mergeExact(coreManifest, manifest, 'peerDependenciesMeta')
  // Keep core's runtime floor visible to npm; differing floors require a reviewed compatibility decision.
  manifest.engines = mergeExact(coreManifest, manifest, 'engines')
  manifest.private = true
  manifest.files = [...new Set([...(manifest.files ?? []), 'vendor'])]
  delete manifest.dsh.client.inline
  if (manifest.dsh.bundle?.patch !== './cordis.patch.yml') throw new Error('Unexpected adapter bundle patch')
  manifest.main = 'lib/web-index.js'
  const entry = manifest.exports?.['.']
  if (typeof entry === 'string') manifest.exports['.'] = './lib/web-index.js'
  else if (entry && typeof entry.default === 'string') entry.default = './lib/web-index.js'
  else throw new Error('Unexpected adapter backend exports')

  await fs.mkdir(outputRoot, { recursive: true })
  const temporary = await fs.mkdtemp(path.join(outputRoot, '.prepare-'))
  try {
    const stage = path.join(temporary, PACKAGE_NAME)
    await copyPackage(adapter, stage)
    const vendor = path.join(stage, 'vendor', CORE_NAME)
    await copyPackage(core, vendor)
    // The vendored package is a private implementation, never a second discovered bundle/client.
    delete coreManifest.dsh
    await fs.writeFile(path.join(vendor, 'package.json'), JSON.stringify(coreManifest, null, 2) + '\n')
    await rewriteCoreImport(path.join(stage, 'lib/index.js'), '../vendor/dsh-ppt/lib/index.js')
    await rewriteCoreImport(path.join(stage, 'lib/types/index.d.ts'), '../../vendor/dsh-ppt/lib/types/index.js')
    await fs.writeFile(path.join(stage, 'lib/web-index.js'), [
      "import { apply as applyAdapter, inject as adapterInject } from './index.js'",
      "import { installWebModePolicy } from '../vendor/dsh-ppt/lib/web-mode-policy.js'",
      "export * from './index.js'",
      "export const inject = [...new Set([...adapterInject, 'workingDirectory'])]",
      'export async function apply(ctx, config) {',
      '  await applyAdapter(ctx, config)',
      "  installWebModePolicy(ctx, ctx.get('officeModes'))",
      '}',
      ''
    ].join('\n'))
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    await replaceInstalledPackages([{ packageName: PACKAGE_NAME, source: stage }], { nodeModulesRoot: outputRoot })
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
  return { packageDirectory: path.join(outputRoot, PACKAGE_NAME), outputRoot, templateCount }
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/pack-ppt-web.mjs (prepare .build/ppt-runtime/packages first)')
  const result = await preparePptWebPackage()
  // npm pack is local and offline; no lifecycle script, publish command or Profile write is involved.
  const args = ['pack', result.packageDirectory, '--offline', '--ignore-scripts', '--json', '--pack-destination', result.outputRoot, '--cache', path.join(result.outputRoot, '.npm-cache')]
  const npmCli = process.env.npm_execpath
  const executable = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const childArgs = npmCli ? [npmCli, ...args] : args
  await new Promise((resolve, reject) => {
    const child = spawn(executable, childArgs, { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error('Local npm pack failed: ' + (signal ?? code))))
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('PPT Web experiment: ' + error.message)
    process.exitCode = 1
  })
}
