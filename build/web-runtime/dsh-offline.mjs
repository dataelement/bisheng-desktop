import { constants } from 'node:fs'
import { access, copyFile, mkdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { systemProxyEnvironment } from './system-proxy.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const home = path.join(root, 'data')
const profile = path.join(home, 'profiles', 'web')
const templates = ['package.json', 'cordis.yml', 'cordis.patch.yml']
async function main() {
  await access(entry, constants.R_OK)
  for (const name of templates) {
    await access(path.join(root, 'profile', name), constants.R_OK)
  }
  // Never initialize over an existing profile.
  await mkdir(path.dirname(profile), { recursive: true })
  let created = false
  try {
    await mkdir(profile)
    created = true
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await stat(profile)).isDirectory()) throw error
  }
  if (created) {
    for (const name of templates) {
      await copyFile(path.join(root, 'profile', name), path.join(profile, name), constants.COPYFILE_EXCL)
    }
  }
  // Never let Harness silently initialize over a partial existing profile.
  for (const name of templates) {
    try {
      await access(path.join(profile, name), constants.R_OK)
    } catch (error) {
      throw new Error(`Web profile is incomplete: ${name}; restore it before starting`, { cause: error })
    }
  }
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: root,
    env: { ...systemProxyEnvironment(), DSH_HOME: home, DSH_WEB_RUNTIME: '1' },
    stdio: 'inherit'
  })
  child.on('error', error => {
    console.error('[bisheng-offline] Failed to launch:', error.message)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) console.error('[bisheng-offline] Runtime terminated by signal:', signal)
    process.exitCode = code ?? 1
  })
}

main().catch(error => {
  console.error('[bisheng-offline] Initialization failed:', error.message)
  process.exitCode = 1
})
