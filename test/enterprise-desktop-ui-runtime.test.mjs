import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supported = process.platform === 'darwin' || process.platform === 'win32'
const SUCCESS = 'ENTERPRISE_DESKTOP_UI_SUCCESS '
const FAILURE = 'ENTERPRISE_DESKTOP_UI_FAILURE '
const DEVELOPMENT_PROFILE = 'enterprise-ui-test-dev'

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No temporary mobile port available')
  const port = address.port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function terminateOwnedTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5_000 })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}

async function runElectron(executable, fixture, environment) {
  const child = spawn(executable, [fixture], {
    cwd: fixture, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  let spawnError
  let timedOut = false
  const append = chunk => { output = (output + chunk.toString()).slice(-256_000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.once('error', error => { spawnError = error })
  const deadline = setTimeout(() => { timedOut = true; terminateOwnedTree(child) }, 95_000)
  try {
    const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    return { ...result, output, timedOut, spawnError }
  } finally {
    clearTimeout(deadline)
    // Terminate only the process group this test created, including a surviving Host.
    if (child.exitCode === null || child.signalCode !== null) terminateOwnedTree(child)
  }
}

it.skipIf(!supported)('opens enterprise account settings through the real Electron UI and closes them with native Escape', async () => {
  const executable = createRequire(import.meta.url)('electron')
  if (typeof executable !== 'string') throw new Error('Run this suite in ordinary Node with the native Electron dependency installed')
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'dsh-enterprise-ui-')))
  let childFinished = false
  try {
    const directories = ['out/main', 'out/preload', 'app-data', 'logs', 'crashes', 'empty-web-home']
    for (const directory of directories) await mkdir(join(fixture, directory), { recursive: true })
    // These are inputs only. All generated code, profiles, credentials and logs remain in fixture.
    for (const directory of ['node_modules', 'build', '.build']) {
      await symlink(join(projectRoot, directory), join(fixture, directory), process.platform === 'win32' ? 'junction' : 'dir')
    }
    const sourceManifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    const version = sourceManifest.version
    await writeFile(join(fixture, 'package.json'), JSON.stringify({
      name: 'enterprise-desktop-ui-fixture', private: true, type: 'module', version, main: './launcher.cjs',
      dshDesktopIdentity: { productName: 'Enterprise UI Fixture', userDataDirectory: 'enterprise-ui-test', developmentUserDataDirectory: DEVELOPMENT_PROFILE },
      dshDesktopHostPlugins: ['dsh-desktop-enterprise', 'dsh-desktop-client-ui', 'dsh-desktop-workbenches']
    }))
    const dshHome = join(fixture, 'app-data', DEVELOPMENT_PROFILE, 'harness')
    await mkdir(dshHome, { recursive: true })
    await writeFile(join(dshHome, '.web-import-decision.json'), JSON.stringify({ decision: 'skipped', source: join(fixture, 'empty-web-home'), at: new Date().toISOString() }))
    await writeFile(join(fixture, 'launcher.cjs'), '(' + electronFixture.toString() + ')()')
    const common = { absWorkingDir: projectRoot, bundle: true, packages: 'external', external: ['electron'], platform: 'node', target: 'node22', logLevel: 'silent', loader: { '.svg': 'text' } }
    await build({ ...common, format: 'esm', entryPoints: {
      index: join(projectRoot, 'packages/dsh-desktop-enterprise/desktop/main.ts'),
      host: join(projectRoot, 'src/host/index.ts')
    }, outdir: join(fixture, 'out/main') })
    await build({ ...common, format: 'cjs', entryPoints: {
      app: join(projectRoot, 'packages/dsh-desktop-enterprise/desktop/preload.ts'),
      'enterprise-chat': join(projectRoot, 'packages/dsh-desktop-enterprise/desktop/preload/enterprise-chat.ts')
    }, outdir: join(fixture, 'out/preload'), outExtension: { '.js': '.cjs' } })
    // Avoid importing the developer's account/environment into this empty application.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|SystemRoot|WINDIR|ComSpec|PATHEXT|TMP|TEMP|TMPDIR|LANG|LC_[A-Z_]+|DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR)$/i.test(key)))
    Object.assign(environment, {
      APPDATA: join(fixture, 'app-data'), LOCALAPPDATA: join(fixture, 'app-data'),
      DSH_HOME: dshHome, DSH_DEV_PROFILE: DEVELOPMENT_PROFILE,
      DSH_DEV_MOBILE_PORT: String(await availablePort()),
      DSH_DESKTOP_PRIMARY_RUNTIME_DIR: join(fixture, '.build/office-runtime/primary-runtime')
    })
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.NODE_OPTIONS
    const result = await runElectron(executable, fixture, environment)
    childFinished = true
    const evidence = result.output
    expect(result.spawnError, evidence).toBeUndefined()
    expect(result.timedOut, evidence).toBe(false)
    expect(result.signal, evidence).toBeNull()
    expect(result.code, evidence).toBe(0)
    expect(evidence, evidence).not.toContain(FAILURE)
    // app.quit() can turn a failed main process into exit 0: require UI proof as well.
    const marker = evidence.split(String.fromCharCode(10)).find(line => line.startsWith(SUCCESS))
    expect(marker, evidence).toBeDefined()
    const proof = JSON.parse(marker.slice(SUCCESS.length))
    expect(proof).toEqual({
      signedOut: true, bridge: true, securePreferences: true, hostEndpoint: 200, accountConnected: false,
      accountPhase: 'idle', desktopVersion: version, harnessVersion: expect.any(String), loginForm: true, escapeClosed: true
    })
    expect(proof.harnessVersion.length).toBeGreaterThan(0)
  } finally {
    // fixture is the realpath returned by our own mkdtemp, never a supplied/shared path.
    // runElectron waits for exit (or kills its owned process tree) before this cleanup.
    if (childFinished) await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    else console.error('Enterprise UI fixture retained for diagnosis:', fixture)
  }
}, 120_000)

function electronFixture() {
  const { app } = require('electron')
  const { join } = require('node:path')
  const { pathToFileURL } = require('node:url')
  const root = __dirname
  app.setPath('appData', join(root, 'app-data'))
  app.setPath('userData', join(root, 'app-data', 'enterprise-ui-test-dev'))
  app.setPath('crashDumps', join(root, 'crashes'))
  const setLogs = app.setAppLogsPath.bind(app)
  app.setAppLogsPath = () => setLogs(join(root, 'logs'))
  app.setAppLogsPath()
  // Native OS protocol registration is unrelated to this UI regression and must not change the desktop.
  app.setAsDefaultProtocolClient = () => true
  let finished = false
  let running = false
  const deadline = setTimeout(() => finish(new Error('Enterprise UI fixture deadline exceeded')), 80_000)
  function finish(error, result) {
    if (finished) return
    finished = true
    clearTimeout(deadline)
    if (error) console.error('ENTERPRISE_DESKTOP_UI_FAILURE ' + JSON.stringify({ message: error.message }))
    else console.log('ENTERPRISE_DESKTOP_UI_SUCCESS ' + JSON.stringify(result))
    process.exitCode = error ? 1 : 0
    app.quit()
    setTimeout(() => app.exit(error ? 1 : 0), 5_000).unref()
  }
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      if (finished || running || window.webContents.getURL() !== 'dsh-app://app/') return
      running = true
      try {
        const preferences = window.webContents.getLastWebPreferences()
        if (!preferences.sandbox || !preferences.contextIsolation || preferences.nodeIntegration || !preferences.webSecurity) throw new Error('Application security preferences changed')
        const result = await window.webContents.executeJavaScript('(' + async function () {
          const waitFor = (selector, absent = false, timeout = 30_000) => new Promise((resolve, reject) => {
            const check = () => absent ? !document.querySelector(selector) : document.querySelector(selector)
            if (check()) return resolve(check())
            const observer = new MutationObserver(() => { if (check()) { observer.disconnect(); clearTimeout(timer); resolve(check()) } })
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Missing UI state: ' + selector)) }, timeout)
            observer.observe(document.documentElement, { childList: true, attributes: true, subtree: true })
          })
          const launcher = await waitFor('[data-dsh-account-launcher]')
          await waitFor('[data-dsh-account-launcher] button[aria-label*="Not signed in"], [data-dsh-account-launcher] button[aria-label*="未登录"]')
          if (typeof window.dshEnterpriseChat?.state !== 'function' || typeof window.dshDesktopEnterprise?.settingsInfo !== 'function') throw new Error('Enterprise preload bridge missing')
          const info = await window.dshDesktopEnterprise.settingsInfo()
          const response = await fetch('/api/enterprise.state')
          if (response.status !== 200) throw new Error('Enterprise Host state endpoint failed: ' + response.status)
          const account = await response.json()
          if (account.connected !== false || account.phase !== 'idle') {
            const phase = ['disabled', 'idle', 'authorizing', 'refreshing', 'connected', 'degraded', 'reauthRequired', 'error'].includes(account.phase) ? account.phase : 'invalid'
            throw new Error('Fixture must start with an empty signed-out account: ' + JSON.stringify({
              connected: typeof account.connected === 'boolean' ? account.connected : 'missing', phase,
              secureStorageAvailable: typeof account.secureStorageAvailable === 'boolean' ? account.secureStorageAvailable : 'missing'
            }))
          }
          const trigger = launcher.querySelector('button[aria-haspopup="menu"]')
          if (!trigger || trigger.disabled) throw new Error('Account launcher is unavailable')
          trigger.click()
          await waitFor('[role="menu"]')
          const signIn = Array.from(document.querySelectorAll('[role="menu"] button')).find(button => /登录企业账号|^Sign in$/.test(button.innerText.trim()))
          if (!signIn) throw new Error('Enterprise Sign in menu item missing')
          signIn.click()
          await waitFor('[data-shortcut-modal="settings"]')
          await waitFor('.dshEnterprise input[placeholder="https://bisheng.example.com"]')
          return { signedOut: true, bridge: true, hostEndpoint: response.status, accountConnected: account.connected, accountPhase: account.phase,
            desktopVersion: info.desktopVersion, harnessVersion: info.harnessVersion, loginForm: true }
        }.toString() + ')()')
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        window.webContents.focus()
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await window.webContents.executeJavaScript('(' + async function () {
          if (!document.querySelector('[data-shortcut-modal="settings"]')) return
          await new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
              if (!document.querySelector('[data-shortcut-modal="settings"]')) { observer.disconnect(); clearTimeout(timer); resolve() }
            })
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Settings did not close on native Escape')) }, 5_000)
            observer.observe(document.documentElement, { childList: true, subtree: true })
          })
        }.toString() + ')()')
        finish(null, { ...result, securePreferences: true, escapeClosed: true })
      } catch (error) { finish(error) }
    })
  })
  // Keep native import out of Vitest's SSR rewrite when serializing this launcher function.
  const importModule = new Function('url', 'return import(url)')
  importModule(pathToFileURL(join(root, 'out/main/index.js')).href).catch(error => finish(error))
}
