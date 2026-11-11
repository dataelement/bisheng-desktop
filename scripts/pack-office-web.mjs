/** Standalone Web distribution from the existing Office maintenance sources. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { t as listTar } from 'tar'
import { replaceInstalledPackages } from './ppt/ppt-package-projection.mjs'
import { prepareOfficeRuntime, officeTarget } from './office-runtime/prepare.mjs'
import { prepareOfficeTemplates } from './office-runtime/prepare-templates.mjs'
import { createTemplateLibrary } from '../packages/dsh-desktop-office/lib/templates.js'

const PACKAGE_NAME = 'dsh-desktop-office'
const project = fileURLToPath(new URL('../', import.meta.url))

/** Generate the native payload, validate every template hash, then assemble the installable package. */
export async function prepareOfficeWebPackage({ projectRoot = project, outputRoot = path.join(projectRoot, '.build/office-web'), target = officeTarget() } = {}) {
  if (target !== officeTarget()) throw new Error('Office Web previews must be built on their native target: ' + target)
  projectRoot = path.resolve(projectRoot)
  outputRoot = path.resolve(outputRoot)
  if (!outputRoot.startsWith(path.join(projectRoot, '.build') + path.sep)) throw new Error('Office Web output must be inside project .build')
  for (let part = outputRoot; part !== projectRoot; part = path.dirname(part)) {
    try { if ((await fs.lstat(part)).isSymbolicLink()) throw new Error('Symlink in Office Web output path') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const runtime = path.join(outputRoot, 'runtime')
  await prepareOfficeRuntime({ target, output: runtime })
  await prepareOfficeTemplates({ runtime, node: process.execPath, cli: path.join(projectRoot, 'packages/dsh-desktop-office/web-cli.mjs') })
  const library = await createTemplateLibrary(path.join(runtime, 'templates'))
  const templates = await library.list()
  for (const item of templates) for (const file of Object.keys(library.entry(item.id).files)) await library.asset(item.id, file)
  const source = path.join(projectRoot, 'packages/dsh-desktop-office')
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  if (manifest.name !== PACKAGE_NAME) throw new Error('Unexpected Office package identity')
  manifest.main = './web-index.js'
  manifest.types = './web-index.d.ts'
  manifest.exports['.'] = { types: './web-index.d.ts', default: './web-index.js' }
  manifest.exports['./cordis.patch.yml'] = './cordis.patch.yml'
  manifest.dsh.bundle = { patch: './cordis.patch.yml' }
  manifest.files = ['vendor', 'index.js', 'index.d.ts', 'web-index.js', 'web-index.d.ts', 'web-cli.mjs', 'client.js', 'lib', 'resources', 'cordis.patch.yml']
  manifest.os = [target.startsWith('mac-') ? 'darwin' : 'win32']
  manifest.cpu = [target.endsWith('arm64') ? 'arm64' : 'x64']
  manifest.engines = { node: '>=24' }
  // Retain the reviewed host peer ranges from the current maintenance manifest.
  manifest.peerDependencies = { ...manifest.peerDependencies }
  delete manifest.peerDependencies['@deepseek-ai/dsh-skill-office']
  delete manifest.peerDependencies['@deepseek-ai/dsh-tool-workspace-dependencies']
  manifest.dependencies = { ...manifest.dependencies, '@deepseek-ai/libreoffice-kit': '0.1.5' }
  delete manifest.peerDependencies['@deepseek-ai/libreoffice-kit']

  const stage = await fs.mkdtemp(path.join(outputRoot, '.stage-'))
  try {
    for (const file of ['index.js', 'index.d.ts', 'web-index.js', 'web-index.d.ts', 'web-cli.mjs', 'client.js', 'lib']) await fs.cp(path.join(source, file), path.join(stage, file), { recursive: true })
    await build({
      stdin: { contents: "export * as officeSkills from '@deepseek-ai/dsh-skill-office'; export * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'", resolveDir: projectRoot },
      outfile: path.join(stage, 'vendor/official.js'), banner: { js: "import { createRequire as vendorCreateRequire } from 'node:module'; const require = vendorCreateRequire(import.meta.url);" }, bundle: true, format: 'esm', platform: 'node', target: 'node24',
      plugins: [{ name: 'host-peers', setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\// }, args => ['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies'].includes(args.path) ? undefined : { path: args.path, external: true })
      } }]
    })
    const require = createRequire(import.meta.url)
    const provenance = await Promise.all(['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies', 'yaml'].map(async name => {
      const manifest = JSON.parse(await fs.readFile(require.resolve(name + '/package.json'), 'utf8'))
      const bytes = await fs.readFile(require.resolve(name))
      const packageRoot = path.dirname(require.resolve(name + '/package.json'))
      const licenseFile = name.replace('@deepseek-ai/', '') + '-LICENSE.txt'
      await fs.copyFile(path.join(packageRoot, 'LICENSE'), path.join(stage, 'vendor', licenseFile))
      return { name, version: manifest.version, license: manifest.license, source: manifest.repository, licenseFile, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await fs.writeFile(path.join(stage, 'vendor/provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
    // npm pack drops symlinks. Dereference Python's validated sibling interpreter aliases.
    await fs.cp(runtime, path.join(stage, 'resources'), { recursive: true, dereference: true, filter: file => path.basename(file) !== '.assembly-fingerprint' })
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    await fs.writeFile(path.join(stage, 'cordis.patch.yml'), "- insert:\n    - id: desktop-office-web\n      name: dsh-desktop-office\n      config:\n        root: !!js dshHomePath('office-web')\n")
    const packageDirectory = path.join(outputRoot, PACKAGE_NAME)
    await replaceInstalledPackages([{ packageName: PACKAGE_NAME, source: stage }], { nodeModulesRoot: outputRoot })
    return { packageDirectory, outputRoot, templateCount: templates.length }
  } finally { await fs.rm(stage, { recursive: true, force: true }) }
}

/** Publish only a successfully packed and inspected archive; failure leaves the previous tgz intact. */
export async function packOfficeWebArchive(result, { npmCli = process.env.npm_execpath } = {}) {
  const temporary = await fs.mkdtemp(path.join(result.outputRoot, '.pack-'))
  try {
    const args = ['pack', result.packageDirectory, '--offline', '--ignore-scripts', '--json', '--pack-destination', temporary, '--cache', path.join(result.outputRoot, '.npm-cache')]
    const executable = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(executable, npmCli ? [npmCli, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    const stdout = [], stderr = []
    child.stdout.on('data', data => stdout.push(data))
    child.stderr.on('data', data => stderr.push(data))
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Office npm pack failed: ' + code + ' ' + Buffer.concat(stderr).toString('utf8').slice(-2000))))
    })
    const packed = JSON.parse(Buffer.concat(stdout).toString('utf8'))
    if (packed.length !== 1 || !/^[a-z0-9][a-z0-9._-]*[.]tgz$/.test(packed[0]?.filename)) throw new Error('Invalid Office npm pack result')
    const filename = packed[0].filename
    const archive = path.join(temporary, filename)
    const required = new Set(['package/package.json', 'package/web-index.js', 'package/vendor/official.js', 'package/resources/templates/catalog.json'])
    await listTar({ file: archive, strict: true, onReadEntry(entry) {
      if (!entry.path.startsWith('package/') || entry.path.split('/').includes('..') || !['File', 'Directory'].includes(entry.type)) throw new Error('Unsafe Office archive entry: ' + entry.path)
      required.delete(entry.path)
    } })
    if (required.size) throw new Error('Incomplete Office archive')
    const outputFile = path.join(result.outputRoot, filename)
    await fs.rename(archive, outputFile)
    return { outputFile, size: packed[0].size, integrity: packed[0].integrity }
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/pack-office-web.mjs')
  console.log(JSON.stringify(await packOfficeWebArchive(await prepareOfficeWebPackage()), null, 2))
}
