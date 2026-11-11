/** Generate a Web entry around the maintained public Desktop workbench package. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { replaceInstalledPackages } from './ppt/ppt-package-projection.mjs'

const PACKAGE_NAME = 'dsh-desktop-workbenches'
const HARNESS_VERSION = '0.2.2-rc.1'
const project = fileURLToPath(new URL('../', import.meta.url))
const EXCLUDED = new Set(['node_modules', '.git', '.cache', '.npm-cache', '.pnpm-store', '.vite', '.vitest', '__pycache__', '.pytest_cache', 'coverage', '.DS_Store', 'package-lock.json'])

/**
 * Assemble current source and assets without changing the Desktop manifest or Profile.
 * The Web Profile must supply Config.root explicitly, using its own dshHomePath.
 * @param {{ projectRoot?: string, outputRoot?: string }} [options]
 * @returns {Promise<{ packageDirectory: string, outputRoot: string }>}
 */
export async function prepareWorkbenchWebPackage({ projectRoot = project, outputRoot } = {}) {
  projectRoot = path.resolve(projectRoot)
  outputRoot = path.resolve(projectRoot, outputRoot ?? '.build/workbenches-web')
  if (!outputRoot.startsWith(path.join(projectRoot, '.build') + path.sep)) throw new Error('Workbench Web output must be beneath projectRoot/.build')
  for (let ancestor = outputRoot; ancestor !== projectRoot; ancestor = path.dirname(ancestor)) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Symlink in Workbench Web output path: ' + ancestor) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const source = path.join(projectRoot, 'packages', PACKAGE_NAME)
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  if (manifest.name !== PACKAGE_NAME || manifest.main !== './index.js' || manifest.exports?.['.'] !== './index.js') throw new Error('Unexpected Desktop workbench package entry')
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'))
  const yamlVersion = lock.packages?.['node_modules/js-yaml']?.version
  if (typeof yamlVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(yamlVersion)) throw new Error('Missing exact locked js-yaml version')
  manifest.main = './web-index.js'
  manifest.exports['.'] = './web-index.js'
  manifest.peerDependencies = { ...manifest.peerDependencies,
    '@deepseek-ai/dsh-app-boot': HARNESS_VERSION,
    '@deepseek-ai/dsh-plugin-manager': HARNESS_VERSION
  }
  manifest.dependencies = { ...manifest.dependencies, 'js-yaml': yamlVersion }
  // The product Profile explicitly composes these plugins. Do not add a bundle
  // patch here: automatic bundle insertion would mount the same plugin twice.
  await fs.mkdir(outputRoot, { recursive: true })
  const stage = await fs.mkdtemp(path.join(outputRoot, '.prepare-'))
  try {
    await fs.cp(source, stage, { recursive: true, filter: async file => {
      const name = path.basename(file)
      if (EXCLUDED.has(name) || name.startsWith('._') || name.endsWith('.tgz') || name.endsWith('.tsbuildinfo')) return false
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlink in Workbench Web source: ' + file)
      return true
    } })
    await fs.access(path.join(stage, 'web-package-backend.mjs'))
    await fs.writeFile(path.join(stage, 'web-index.js'), [
      "import { apply as applyNative } from './index.js'",
      "import { registerWebPackageBackend } from './web-package-backend.mjs'",
      "export * from './index.js'",
      'export function apply(ctx, config) {',
      '  registerWebPackageBackend(ctx)',
      '  return applyNative(ctx, config)',
      '}',
      ''
    ].join('\n'))
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    await replaceInstalledPackages([{ packageName: PACKAGE_NAME, source: stage }], { nodeModulesRoot: outputRoot })
  } finally { await fs.rm(stage, { recursive: true, force: true }) }
  return { packageDirectory: path.join(outputRoot, PACKAGE_NAME), outputRoot }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/pack-workbenches-web.mjs')
  console.log(JSON.stringify(await prepareWorkbenchWebPackage(), null, 2))
}
