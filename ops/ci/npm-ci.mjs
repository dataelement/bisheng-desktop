import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// @electron/get 5 的 FetchDownloader 对 503 只抛一次。postinstall 里的
// install-electron 因此会让整次 npm ci 失败，即使二进制源只是短暂不可用。
export const electronMirror = 'https://cdn.npmmirror.com/binaries/electron/'

export const electronDownloadRetries = Object.freeze([
  Object.freeze({ delayMs: 15000, mirror: false }),
  Object.freeze({ delayMs: 30000, mirror: false }),
  Object.freeze({ delayMs: 15000, mirror: true })
])

export function npmCiArgs(argv) {
  return ['ci', ...(argv.length > 0 ? argv : ['--prefer-offline', '--no-audit', '--no-fund'])]
}

export function resolveNpmCli(execPath = process.execPath, exists = existsSync) {
  const candidates = [
    join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]
  return candidates.find(candidate => exists(candidate)) ?? null
}

export function isTransientElectronDownloadFailure(output) {
  if (typeof output !== 'string' || output.length === 0) return false
  const tail = output.slice(-65536)
  const transientHttp = /HTTPError: Response code (?:408|425|429|500|502|503|504) \([^)\n]*\) for \S*electron/i.test(tail)
  const mentionsDownload = /https?:\/\/\S*electron\S*\.zip|FetchDownloader\.download|node_modules[\\/]electron[\\/]install\.js/i.test(tail)
  const transientNetwork = /(?:\bECONNRESET\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|\bENOTFOUND\b|\bUND_ERR_[A-Z_]+\b|\bfetch failed\b|\bsocket hang up\b)/i.test(tail)
  return transientHttp || (mentionsDownload && transientNetwork)
}

export async function recoverElectronDownload({
  npmResult,
  installElectron,
  electronInstallExists,
  retries = electronDownloadRetries,
  sleep = delay => new Promise(resolvePromise => setTimeout(resolvePromise, delay)),
  env = process.env,
  mirror = electronMirror,
  log = console.error
}) {
  if (npmResult.code === 0) return 0
  if (!isTransientElectronDownloadFailure(npmResult.output) || !electronInstallExists()) return npmResult.code ?? 1
  for (let index = 0; index < retries.length; index += 1) {
    const step = retries[index]
    log(`Electron download returned a transient error. Retry ${index + 1}/${retries.length}${step.mirror ? ' using the Electron mirror.' : '.'}`)
    await sleep(step.delayMs)
    const retryEnv = { ...env }
    if (step.mirror && !retryEnv.ELECTRON_MIRROR) retryEnv.ELECTRON_MIRROR = mirror
    const retry = await installElectron(retryEnv)
    if (retry.code === 0) return 0
    if (!isTransientElectronDownloadFailure(retry.output)) return retry.code ?? 1
  }
  return 1
}

function run(command, args, env, shell = false) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { env, shell, stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    const capture = chunk => {
      process.stdout.write(chunk)
      output += chunk.toString()
      if (output.length > 131072) output = output.slice(-65536)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', chunk => {
      process.stderr.write(chunk)
      output += chunk.toString()
      if (output.length > 131072) output = output.slice(-65536)
    })
    child.on('error', error => finish({ code: 1, output: output + String(error?.stack || error) }))
    child.on('close', code => finish({ code: code ?? 1, output }))
  })
}

async function main() {
  const npmArgs = npmCiArgs(process.argv.slice(2))
  const cli = resolveNpmCli()
  const npmResult = cli
    ? await run(process.execPath, [cli, ...npmArgs], process.env)
    : await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, process.env, process.platform === 'win32')
  const code = await recoverElectronDownload({
    npmResult,
    env: process.env,
    electronInstallExists: () => existsSync(join(process.cwd(), 'node_modules', 'electron', 'install.js')),
    installElectron: retryEnv => run(process.execPath, [join('node_modules', 'electron', 'install.js')], retryEnv)
  })
  process.exit(code)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry === import.meta.url) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
