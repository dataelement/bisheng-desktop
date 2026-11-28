/** Assemble a complete native Web distribution from the checked-in lock and replayed patches. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { c as createTar } from 'tar'
import { prepareWebCiInputs } from './prepare-web-ci-inputs.mjs'
import { assertWebPluginManagerContract } from './web-plugin-manager.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export async function packWebRuntime({ project = projectRoot, inputs, output } = {}) {
  if (process.versions.electron || process.version !== 'v24.15.0' || !['darwin', 'win32'].includes(process.platform)) throw new Error('Native Web packaging requires ordinary Node 24.15.0 on a supported Office target')
  project = path.resolve(project)
  const target = process.platform + '-' + process.arch
  const dist = path.join(project, 'dist')
  await fs.mkdir(dist, { recursive: true })
  output = path.resolve(output ?? path.join(dist, 'bisheng-web-runtime-' + target + '-' + Date.now()))
  // Exclusive output prevents deleting an existing distributable or user data.
  await fs.mkdir(output)
  inputs = inputs ?? await prepareWebCiInputs(path.join(project, '.build', 'web-inputs-' + Date.now()), { projectRoot: project })
  const modules = typeof inputs === 'string' ? path.join(inputs, 'node_modules') : inputs.modules
  const office = typeof inputs === 'string' ? path.join(inputs, 'office') : inputs.office
  const ppt = typeof inputs === 'string' ? path.join(inputs, 'ppt') : inputs.ppt
  await assertWebPluginManagerContract(modules)
  await fs.cp(modules, path.join(output, 'node_modules'), { recursive: true })
  for (const [name, source] of [['dsh-desktop-office', office], ['dsh-ppt-composer', ppt]]) {
    if (!source) throw new Error('Required Web package missing: ' + name)
    await fs.cp(source, path.join(output, 'node_modules', name), { recursive: true, force: true })
  }
  await fs.mkdir(path.join(output, 'node'))
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  await fs.copyFile(process.execPath, path.join(output, 'node', nodeName))
  if (process.platform !== 'win32') {
    await fs.chmod(path.join(output, 'node', nodeName), 0o755)
    await fs.writeFile(path.join(output, 'node/pnpm'), '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/node" "$DIR/../node_modules/pnpm/bin/pnpm.cjs" "$@"\n')
    await fs.chmod(path.join(output, 'node/pnpm'), 0o755)
  } else await fs.writeFile(path.join(output, 'node/pnpm.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0..\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\nexit /b %errorlevel%\r\n')
  const launcherRoot = path.join(project, 'build', 'web-runtime')
  for (const name of ['dsh-offline.mjs', 'dsh-offline.cmd', 'system-proxy.mjs']) await fs.copyFile(path.join(launcherRoot, name), path.join(output, name))
  await fs.writeFile(path.join(output, 'start.sh'), '#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/node/node" "$ROOT/dsh-offline.mjs" "$@"\n')
  await fs.chmod(path.join(output, 'start.sh'), 0o755)
  await fs.writeFile(path.join(output, 'start.bat'), '@echo off\r\n"%~dp0node\\node.exe" "%~dp0dsh-offline.mjs" %*\r\nexit /b %errorlevel%\r\n')
  await fs.mkdir(path.join(output, 'profile'))
  await fs.copyFile(path.join(launcherRoot, 'profile-package.json'), path.join(output, 'profile/package.json'))
  await fs.writeFile(path.join(output, 'profile/cordis.yml'), '[]\n')
  await fs.copyFile(path.join(launcherRoot, 'cordis.patch.yml'), path.join(output, 'profile/cordis.patch.yml'))
  await fs.writeFile(path.join(output, 'package.json'), JSON.stringify({ name: 'bisheng-web-runtime', private: true, type: 'module' }, null, 2))
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(output, 'node', nodeName), [path.join(output, 'dsh-offline.mjs'), '--version'], { cwd: output, env: { ...process.env, DSH_WEB_RUNTIME: '1' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Bundled launcher preflight failed: ' + code)))
  })
  const archive = output + '.tar.gz'
  await createTar({ file: archive, gzip: true, cwd: path.dirname(output), portable: true }, [path.basename(output)])
  const hash = createHash('sha256').update(await fs.readFile(archive)).digest('hex')
  await fs.writeFile(archive + '.sha256', hash + '  ' + path.basename(archive) + '\n')
  return { output, archive, sha256: hash, platform: process.platform, arch: process.arch }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/pack-web-runtime.mjs')
  console.log(JSON.stringify(await packWebRuntime(), null, 2))
}
