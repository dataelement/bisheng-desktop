import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { stageWindowsWebRuntime } from '../../scripts/stage-windows-web-runtime.mjs'
import { verifyWebPortable } from './verify-web-portable.mjs'

export const NODE_VERSION = '24.15.0'
// https://nodejs.org/dist/v24.15.0/SHASUMS256.txt (win-x64/node.exe)
export const NODE_EXE_SHA256 = '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5'
const names = ['node-directory', 'modules-directory', 'office-directory', 'ppt-directory', 'output-directory']

export function parseOptions(args) {
  const result = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '')
    const value = args[i + 1]
    if (!args[i]?.startsWith('--') || !names.includes(key) || Object.hasOwn(result, key) || !value || !path.isAbsolute(value)) {
      throw new Error('Expected each supported --*-directory exactly once with an absolute path')
    }
    result[key] = path.resolve(value)
  }
  if (names.some(name => !result[name])) throw new Error('All five explicit input/output directories are required')
  return result
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) {
    // Commands may include authentication URLs; never forward child output into CI logs.
    throw new Error(path.basename(executable) + ' failed (exit ' + result.status + ', signal ' + result.signal + ')', { cause: result.error })
  }
  return result.stdout
}

export async function buildWebPortable(options) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.version !== 'v' + NODE_VERSION) {
    throw new Error('Portable assembly requires native Windows x64 and Node ' + NODE_VERSION)
  }
  const node = path.join(options['node-directory'], 'node.exe')
  if (await sha256(node) !== NODE_EXE_SHA256) throw new Error('Bundled node.exe SHA-256 mismatch')
  if (run(node, ['--version']).trim() !== 'v' + NODE_VERSION) throw new Error('Bundled Node version mismatch')
  const output = options['output-directory']
  await fs.mkdir(path.dirname(output), { recursive: true })
  // Refuse overwrite, including existing empty outputs and archive files.
  const zip = output + '-windows-x64.zip'
  for (const target of [output, zip, zip + '.sha256', zip + '.verification.json']) {
    try { await fs.lstat(target) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error('Build output already exists: ' + target)
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bisheng-web-ci-'))
  try {
    const profile = path.join(temporary, 'profile')
    await fs.mkdir(profile)
    const template = JSON.parse(await fs.readFile(new URL('../../build/web-runtime/profile-package.json', import.meta.url), 'utf8'))
    template.dependencies = {}
    // The product patch mounts each host plugin once; only core bundles auto-compose.
    template.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
    await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify(template, null, 2) + '\n')
    await fs.writeFile(path.join(profile, 'cordis.yml'), '[]\n')
    await fs.copyFile(new URL('../../build/web-runtime/cordis.patch.yml', import.meta.url), path.join(profile, 'cordis.patch.yml'))
    await stageWindowsWebRuntime({ modules: options['modules-directory'], node,
      office: options['office-directory'], ppt: options['ppt-directory'], profile, output })
    run('7z', ['a', '-tzip', '-mx=5', zip, path.basename(output)], { cwd: path.dirname(output) })
    run('7z', ['t', zip])
    const extracted = path.join(temporary, '离线 runtime (clean)')
    await fs.mkdir(extracted)
    run('7z', ['x', '-y', '-o' + extracted, zip])
    const evidence = await verifyWebPortable(path.join(extracted, path.basename(output)))
    const digest = await sha256(zip)
    await fs.writeFile(zip + '.sha256', digest + '  ' + path.basename(zip) + '\n')
    await fs.writeFile(zip + '.verification.json', JSON.stringify({ ...evidence, nodeVersion: NODE_VERSION,
      nodeSha256: NODE_EXE_SHA256, archiveSha256: digest }, null, 2) + '\n')
    console.log('Verified Windows portable ZIP, bootstrap and Office/PPT imports; no publication performed.')
    return { archive: zip, sha256: digest }
  } finally {
    // This directory was created by this invocation and contains only isolated CI probe data.
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildWebPortable(parseOptions(process.argv.slice(2)))
}
