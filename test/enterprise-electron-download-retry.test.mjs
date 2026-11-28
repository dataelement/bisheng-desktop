import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import {
  electronMirror,
  isTransientElectronDownloadFailure,
  npmCiArgs,
  recoverElectronDownload,
  resolveNpmCli
} from '../ops/ci/npm-ci.mjs'

const ciFailure = `
> dsh-desktop@1.0.1 postinstall
> patch-package && node scripts/release/install-brand-assets.mjs && install-electron --no
HTTPError: Response code 503 (Service Unavailable) for https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-win32-x64.zip
    at FetchDownloader.download
npm error command failed
npm error command C:\\Windows\\system32\\cmd.exe /d /s /c patch-package && node scripts/release/install-brand-assets.mjs && install-electron --no
`

test('classifies the observed Electron 503 as retryable and leaves other install failures alone', () => {
  assert.equal(isTransientElectronDownloadFailure(ciFailure), true)
  assert.equal(isTransientElectronDownloadFailure(`
TypeError: fetch failed
    at FetchDownloader.download
  [cause]: Error: connect ETIMEDOUT
`), true)
  assert.equal(isTransientElectronDownloadFailure(`
HTTPError: Response code 404 (Not Found) for https://github.com/electron/electron/releases/download/v0.0.0/electron-v0.0.0-win32-x64.zip
`), false)
  assert.equal(isTransientElectronDownloadFailure(`
> install-electron --no
Error: Checksum mismatch for electron-v44.7.0-win32-x64.zip
`), false)
  assert.equal(isTransientElectronDownloadFailure(`
> patch-package && install-electron --no
Error: ECONNRESET while applying patches
`), false)
  assert.equal(isTransientElectronDownloadFailure(''), false)
})

test('retries the official zip before switching to the verified mirror', async () => {
  const calls = []
  const code = await recoverElectronDownload({
    npmResult: { code: 1, output: ciFailure },
    electronInstallExists: () => true,
    sleep: async () => {},
    env: { PATH: '/usr/bin' },
    log: () => {},
    installElectron: async retryEnv => {
      calls.push(retryEnv.ELECTRON_MIRROR)
      return { code: calls.length === 3 ? 0 : 1, output: calls.length === 3 ? '' : ciFailure }
    }
  })
  assert.equal(code, 0)
  assert.deepEqual(calls, [undefined, undefined, electronMirror])
})

test('does not treat a finished install or a non-download failure as success', async () => {
  let installs = 0
  const installElectron = async () => {
    installs += 1
    return { code: 0, output: '' }
  }
  assert.equal(await recoverElectronDownload({
    npmResult: { code: 0, output: '' },
    electronInstallExists: () => false,
    installElectron,
    sleep: async () => {},
    log: () => {}
  }), 0)
  assert.equal(await recoverElectronDownload({
    npmResult: { code: 7, output: 'patch-package failed' },
    electronInstallExists: () => true,
    installElectron,
    sleep: async () => {},
    log: () => {}
  }), 7)
  assert.equal(await recoverElectronDownload({
    npmResult: { code: 1, output: ciFailure },
    electronInstallExists: () => false,
    installElectron,
    sleep: async () => {},
    log: () => {}
  }), 1)
  assert.equal(installs, 0)
  assert.equal(await recoverElectronDownload({
    npmResult: { code: 1, output: ciFailure },
    electronInstallExists: () => true,
    sleep: async () => {},
    log: () => {},
    installElectron: async () => ({ code: 9, output: 'Error: Checksum mismatch for electron zip' })
  }), 9)
})

test('keeps an explicit mirror and resolves npm next to the active Node', () => {
  assert.deepEqual(npmCiArgs([]), ['ci', '--prefer-offline', '--no-audit', '--no-fund'])
  assert.deepEqual(npmCiArgs(['--timing']), ['ci', '--timing'])
  const unixCli = join('opt', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  assert.equal(resolveNpmCli(join('opt', 'node', 'bin', 'node'), candidate => candidate === unixCli), unixCli)
  const windowsCli = join('node-root', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  assert.equal(resolveNpmCli(join('node-root', 'node.exe'), candidate => candidate === windowsCli), windowsCli)
  return recoverElectronDownload({
    npmResult: { code: 1, output: ciFailure },
    electronInstallExists: () => true,
    retries: [{ delayMs: 0, mirror: true }],
    sleep: async () => {},
    env: { ELECTRON_MIRROR: 'https://example.invalid/electron/' },
    log: () => {},
    installElectron: async retryEnv => {
      assert.equal(retryEnv.ELECTRON_MIRROR, 'https://example.invalid/electron/')
      return { code: 0, output: '' }
    }
  })
})

test('candidate and release installs retry Electron through the shared helper', () => {
  const candidates = ['bisheng-ci', 'build-web-runtime']
  for (const name of candidates) {
    const workflow = readFileSync(new URL('../.github/workflows/' + name + '.yml', import.meta.url), 'utf8')
    assert.match(workflow, /node ops\/ci\/npm-ci\.mjs --prefer-offline --no-audit --no-fund\n/)
    assert.doesNotMatch(workflow, /^ {8}run: npm ci --prefer-offline --no-audit --no-fund$/m)
  }
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const timed = release.match(/node ops\/ci\/npm-ci\.mjs --prefer-offline --no-audit --no-fund --timing --logs-dir "\$\{\{ runner\.temp \}\}\/npm-timings"/g)
  assert.equal(timed?.length, 2)
  assert.match(release, /run: npm ci --ignore-scripts/)
})
