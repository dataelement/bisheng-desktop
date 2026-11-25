import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
require('app-builder-lib')
const { LinuxPackager } = require('app-builder-lib/out/linuxPackager.js')
const FpmTarget = require('app-builder-lib/out/targets/FpmTarget.js').default
const packageJson = require('../package.json')
const devConfig = require('../electron-builder.dev.cjs')
const execFile = promisify(execFileCallback)
let root
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'enterprise-linux-installer-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
function linuxContext(config) {
  const packager = new LinuxPackager({ config, metadata: { ...packageJson, ...config.extraMetadata },
    options: {}, projectDir: resolve(import.meta.dirname, '..'), buildResourcesDir: join(root, 'build') })
  return { packager }
}

// These execute POSIX permission and shell semantics; the Linux CI job runs both.
it.skipIf(process.platform === 'win32').each([['production', packageJson.build, 'BISHENG'], ['development', devConfig, 'BISHENG Dev']])(
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
