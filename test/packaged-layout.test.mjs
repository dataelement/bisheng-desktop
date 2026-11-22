import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { packagedLayout } = require('../scripts/verify/packaged-layout.cjs')
// Load the public entry first: builder's platform classes share circular imports.
require('app-builder-lib')
const { LinuxPackager } = require('app-builder-lib/out/linuxPackager.js')
const { createPackage } = require('@electron/asar')
const FpmTarget = require('app-builder-lib/out/targets/FpmTarget.js').default
const packageJson = require('../package.json')
const devConfig = require('../electron-builder.dev.cjs')
const execFile = promisify(execFileCallback)
let root
let archive
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-packaged-layout-')) })
afterEach(async () => {
  // Electron's patched recursive rm sees ASAR as a directory; unlink the archive first.
  if (archive) { await unlink(archive); archive = undefined }
  await rm(root, { recursive: true, force: true })
})

function linuxContext(config, metadata = packageJson) {
  // Use the installed builder's resolved naming, including extraMetadata in dev builds.
  const packager = new LinuxPackager({ config, metadata: { ...metadata, ...config.extraMetadata },
    options: {}, projectDir: resolve(import.meta.dirname, '..'), buildResourcesDir: join(root, 'build') })
  return { appOutDir: root, electronPlatformName: 'linux', packager }
}

it.each([['production', packageJson.build, 'bisheng'], ['development', devConfig, 'bisheng-dev']])(
  'uses the actual %s Linux builder executableName', (_name, config, executableName) => {
    const context = linuxContext(config)
    expect(context.packager.executableName).toBe(executableName)
    expect(packagedLayout(context)).toEqual({ resources: join(root, 'resources'), executable: join(root, executableName) })
  }
)

it.each([['production', packageJson.build, 'dsh-desktop'], ['development', devConfig, 'bisheng-dev']])(
  'computes real deb metadata for %s without requiring an invented author email', async (_name, config, packageName) => {
    const { packager } = linuxContext(config)
    let sequence = 0
    packager.info.tempDirManager = { getTempFile: async ({ suffix }) => join(root, `${sequence++}-${suffix}`) }
    const target = new FpmTarget('deb', packager, {}, root)
    // The constructor also writes install/remove/AppArmor templates; await them
    // so their failures cannot escape as unhandled background rejections.
    await target.scriptFiles
    expect(await target.computeFpmMetaInfoOptions()).toEqual({
      name: packageName, maintainer: 'DataElement', vendor: 'DataElement', url: packageJson.homepage
    })
    delete target.options.maintainer
    await expect(target.computeFpmMetaInfoOptions()).rejects.toThrow('email')
  }
)

it.each([['production', packageJson.build, 'BISHENG'], ['development', devConfig, 'BISHENG Dev']])(
  'configures a root-owned SUID helper in the generated %s installer', async (_name, config, product) => {
    const { packager } = linuxContext(config)
    let sequence = 0
    packager.info.tempDirManager = { getTempFile: async ({ suffix }) => join(root, `${sequence++}-${suffix}`) }
    const target = new FpmTarget('deb', packager, {}, root)
    const { afterInstall } = await target.scriptFiles
    const sandbox = join(root, 'chrome-sandbox')
    const bin = join(root, 'bin')
    const calls = join(root, 'chown.log')
    const script = join(root, 'postinst')
    await mkdir(bin)
    await writeFile(sandbox, 'fixture', { mode: 0o755 })
    for (const [name, body] of Object.entries({
      'update-alternatives': 'exit 0',
      'update-mime-database': 'exit 0',
      'update-desktop-database': 'exit 0',
      apparmor_status: 'exit 1',
      chown: 'printf "%s\\n" "$*" >> "$DSH_TEST_LOG"; [ "$DSH_TEST_CHOWN_FAIL" != 1 ]'
    })) {
      const path = join(bin, name)
      await writeFile(path, `#!/bin/sh\n${body}\n`)
      await chmod(path, 0o755)
    }
    const generated = await readFile(afterInstall, 'utf8')
    const originalPath = `/opt/${product}/chrome-sandbox`
    expect(generated).toContain(originalPath)
    await writeFile(script, generated.replaceAll(originalPath, sandbox))
    const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, DSH_TEST_LOG: calls }
    await execFile('/bin/bash', [script, 'configure'], { env })
    expect((await stat(sandbox)).mode & 0o7777).toBe(0o4755)
    expect(await readFile(calls, 'utf8')).toContain(`root:root ${sandbox}`)
    await expect(execFile('/bin/bash', [script, 'configure'], { env: { ...env, DSH_TEST_CHOWN_FAIL: '1' } })).rejects.toMatchObject({ code: 1 })
  }
)

it('honors builder naming precedence and the package-name fallback, not the display name', () => {
  for (const [config, name] of [
    [{ productName: 'Display Name', linux: { executableName: 'custom-linux' }, executableName: 'global' }, 'custom-linux'],
    [{ productName: 'Display Name', executableName: 'global' }, 'global'],
    [{ productName: 'Display Name' }, 'package-name']
  ]) {
    expect(packagedLayout(linuxContext(config, { name: 'Package-Name', version: '1.0.0' })).executable).toBe(join(root, name))
  }
})

it.each(['DSH Desktop', 'DSH Desktop Dev'])('preserves macOS Helper and Windows exe naming for %s', product => {
  const packager = { appInfo: { productFilename: product }, executableName: 'ignored-linux-name' }
  expect(packagedLayout({ appOutDir: root, electronPlatformName: 'darwin', packager })).toEqual({
    resources: join(root, `${product}.app`, 'Contents', 'Resources'),
    executable: join(root, `${product}.app`, 'Contents', 'Frameworks', `${product} Helper.app`, 'Contents', 'MacOS', `${product} Helper`)
  })
  expect(packagedLayout({ appOutDir: root, electronPlatformName: 'win32', packager })).toEqual({
    resources: join(root, 'resources'), executable: join(root, `${product}.exe`)
  })
})

it.each([undefined, '', '../outside'])('rejects invalid resolved Linux names rather than guessing: %s', executableName => {
  expect(() => packagedLayout({ appOutDir: root, electronPlatformName: 'linux',
    packager: { appInfo: { productFilename: 'Display Name' }, executableName } })).toThrow('packager.executableName')
})

// Intercept only the subprocess boundary: execute each hook's real resource lookup
// and assertions, then reject the probe so a failed gate must remain a rejection.
async function loadHook(file, calls, failure) {
  const filename = require.resolve(`../scripts/verify/${file}`)
  const localRequire = createRequire(filename)
  const execFile = () => { throw new Error('Expected the promisified subprocess boundary') }
  execFile[promisify.custom] = async (...args) => {
    calls.push(args)
    if (file === 'verify-office-runtime.cjs' && calls.length === 1) return { stdout: '' }
    throw failure
  }
  const module = { exports: {} }
  const scopedRequire = id => id === 'node:child_process' ? { execFile } : localRequire(id)
  runInNewContext(await readFile(filename, 'utf8'), { require: scopedRequire, module,
    __filename: filename, __dirname: dirname(filename), process, console })
  return module.exports
}

describe.each(['linux', 'darwin', 'win32'])('%s verifier dispatch', platform => {
  it.each(['verify-packaged-harness.cjs', 'verify-packaged-ppt-runtime.cjs', 'verify-office-runtime.cjs'])(
    'runs the packaged executable and propagates failed gate in %s', async file => {
      const context = { appOutDir: root, electronPlatformName: platform,
        packager: { appInfo: { productFilename: 'DSH Desktop Dev' }, executableName: 'dsh-desktop' } }
      const { resources, executable } = packagedLayout(context)
      await mkdir(resources, { recursive: true })
      const source = join(root, 'asar-source')
      await mkdir(source)
      await writeFile(join(source, 'package.json'), '{}')
      archive = join(resources, 'app.asar')
      await createPackage(source, archive)
      await mkdir(dirname(executable), { recursive: true })
      await writeFile(executable, '')
      const payload = join(resources, 'office-runtime', 'primary-runtime')
      await mkdir(payload, { recursive: true })
      await writeFile(join(payload, 'runtime.json'), JSON.stringify({ platform: process.platform, arch: process.arch }))
      const calls = []
      const failure = new Error('probe failed')
      const exported = await loadHook(file, calls, failure)
      const hook = typeof exported === 'function' ? exported : exported.verifyPackagedHarness ?? exported.afterPack
      await expect(hook(context)).rejects.toBe(failure)
      expect(calls).toHaveLength(file === 'verify-office-runtime.cjs' ? 2 : 1)
      const [binary, args, options] = calls.at(-1)
      expect(binary).toBe(executable)
      expect(args).toContain(join(resources, 'app.asar'))
      if (file === 'verify-office-runtime.cjs') expect(args.at(-1)).toBe(calls[0][2].cwd)
      expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(options.timeout).toBe(120_000)
    }
  )
})
