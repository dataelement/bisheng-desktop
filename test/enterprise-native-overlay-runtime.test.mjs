import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(!['darwin', 'win32'].includes(process.platform))('hands real Electron native Chat visibility to host modals, menus and hidden pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-overlay-'))
  try {
    const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
    const helpers = source.slice(source.indexOf('function observeHostOverlays('), source.indexOf('const NAV_ICON_PATHS ='))
    await writeFile(join(directory, 'client.cjs'), helpers + '\n(' + renderer.toString() + ')()')
    await writeFile(join(directory, 'main.cjs'), '(' + main.toString() + ')()')
    await writeFile(join(directory, 'page.html'), '<div id="root"></div><style>html,body,#root{margin:0;width:100%;height:100%}.dshModes,.dshModeStage,.dshModeBody{width:100%;height:100%}[hidden]{display:none!important}</style>')
    const executable = createRequire(import.meta.url)('electron')
    const environment = { ...process.env, OVERLAY_REACT: createRequire(import.meta.url).resolve('react'), OVERLAY_REACT_DOM: createRequire(import.meta.url).resolve('react-dom/client') }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [join(directory, 'main.cjs')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', value => { output += value })
    child.stderr.on('data', value => { output += value })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25000)
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timeout))
    expect(output).toContain('NATIVE_OVERLAY_SUCCESS')
    expect(code, output).toBe(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

function main() {
  const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron')
  const { join } = require('node:path')
  app.setPath('userData', join(__dirname, 'profile'))
  app.whenReady().then(async () => {
    const host = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    const native = new WebContentsView()
    native.setVisible(false)
    host.contentView.addChildView(native)
    await native.webContents.loadURL('data:text/html,<body style="background:green">Native Chat</body>')
    ipcMain.handle('overlay:present', (_event, value) => { native.setBounds(value.bounds); native.setVisible(value.visible); return {} })
    ipcMain.handle('overlay:capture', async () => ({ dataURL: (await native.webContents.capturePage()).toDataURL(), bounds: native.getBounds() }))
    ipcMain.handle('overlay:visible', () => native.getVisible())
    ipcMain.on('overlay:result', (_event, error) => { console.log(error ? 'NATIVE_OVERLAY_FAILURE ' + error : 'NATIVE_OVERLAY_SUCCESS'); host.destroy(); app.exit(error ? 1 : 0) })
    await host.loadFile(join(__dirname, 'page.html'))
    // The host can composite screenshots even though the fixture never takes foreground focus.
    host.showInactive()
    await host.webContents.executeJavaScript(require('node:fs').readFileSync(join(__dirname, 'client.cjs'), 'utf8'))
  }).catch(error => { console.error(error); app.exit(1) })
}
function renderer() {
  const { ipcRenderer } = require('electron')
  window.React = require(process.env.OVERLAY_REACT)
  window.hostPalette = () => undefined
  window.dshEnterpriseChat = { present: value => ipcRenderer.invoke('overlay:present', value), capture: () => ipcRenderer.invoke('overlay:capture') }
  const { createRoot } = require(process.env.OVERLAY_REACT_DOM)
  const empty = { subscribe: () => () => {}, getSnapshot: () => null }
  const state = { mode: 'chat', phase: 'ready', connected: true, epoch: 1, conversationId: 'existing' }
  const project = { editor: null }
  const navigation = { snapshot: () => state, subscribe: () => () => {}, start: () => () => {}, projects: { snapshot: () => project, subscribe: () => () => {} }, deletion: empty, renaming: empty }
  const locale = { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} }
  const root = createRoot(document.getElementById('root'))
  root.render(React.createElement(DesktopModes, { work: null, navigation, t: key => key, locale }))
  const waitFor = async predicate => {
    const deadline = Date.now() + 5000
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error('Native visibility did not converge')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  const visible = value => async () => await ipcRenderer.invoke('overlay:visible') === value
  ;(async () => {
    await waitFor(visible(true))
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.textContent = 'Confirmation'
    document.body.append(modal); await waitFor(visible(false))
    modal.remove(); await waitFor(visible(true))
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.style.cssText = 'position:fixed;inset:100px auto auto 100px;width:200px;height:100px;background:white'; menu.textContent = 'Menu'
    document.body.append(menu); await waitFor(visible(false))
    await waitFor(() => !menu.hasAttribute('data-dsh-native-overlay-pending'))
    if (!document.querySelector('[data-dsh-native-frame]')) throw new Error('Native screenshot backing missing')
    menu.remove(); await waitFor(visible(true))
    document.querySelector('.dshModes').hidden = true; await waitFor(visible(false))
    document.querySelector('.dshModes').hidden = false; await waitFor(visible(true))
    root.unmount(); await waitFor(visible(false))
    ipcRenderer.send('overlay:result')
  })().catch(error => ipcRenderer.send('overlay:result', error.stack))
}
