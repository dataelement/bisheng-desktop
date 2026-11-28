import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(!['darwin', 'win32'].includes(process.platform)).each(['fallback', 'enterprise'])('reserves native resize strips and drags the real rightbar (%s)', async contribution => {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-resize-'))
  try {
    const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
    const start = source.indexOf('function reserveSidebarResizeBounds(')
    const end = source.indexOf('function DesktopModes(', start)
    expect(start, 'production resize helper missing').toBeGreaterThanOrEqual(0)
    expect(end, 'production resize helper boundary missing').toBeGreaterThan(start)
    const resolve = createRequire(import.meta.url)
    const layout = await readFile(resolve.resolve('@deepseek-ai/dsh-client-ui-layout').replace(/index.js$/, 'client.js'), 'utf8')
    expect(layout, 'real AppFrame bundle missing').toContain('function AppFrame(')
    await writeFile(join(directory, 'layout.cjs'), layout.replace('function AppFrame(', 'window.ResizeAppFrame=AppFrame;function AppFrame('))
    await writeFile(join(directory, 'client.cjs'), source.slice(start, end) + '\n(' + renderer.toString() + ')()')
    await writeFile(join(directory, 'main.cjs'), '(' + main.toString() + ')()')
    const selectors = ['.dshModes', '.dshModeStage', '.dshModeBody', '.dshWorkContent', '.dshWorkContent > [data-side="rightbar"]']
    const css = selectors.map(selector => { const index = source.indexOf(selector + '{'); return index < 0 ? '' : source.slice(index).split('}')[0] + '}' }).join('\n')
    await writeFile(join(directory, 'page.html'), '<div id="root"></div><style>html,body,#root{margin:0;width:100%;height:100%}' + css + '</style>')
    const environment = { ...process.env, RESIZE_CONTRIBUTION: contribution, RESIZE_REACT: resolve.resolve('react'), RESIZE_JSX: resolve.resolve('react/jsx-runtime'), RESIZE_DOM: resolve.resolve('react-dom/client') }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(resolve('electron'), [join(directory, 'main.cjs')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', value => { output += value })
    child.stderr.on('data', value => { output += value })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25000)
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timeout))
    expect(code, output).toBe(0)
    expect(output, output).toContain('NATIVE_RESIZE_SUCCESS')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

function main() {
  const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron')
  const { join } = require('node:path')
  app.setPath('userData', join(__dirname, 'profile'))
  app.whenReady().then(async () => {
    const host = new BrowserWindow({ width: 1400, height: 800, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
    const native = new WebContentsView()
    host.contentView.addChildView(native)
    await native.webContents.loadURL('data:text/html,<body style="background:green">Native Chat</body>')
    ipcMain.handle('resize:bounds', (_event, bounds) => { if (bounds) native.setBounds(bounds); return native.getBounds() })
    ipcMain.handle('resize:drag', async (_event, { x, y, dx }) => {
      host.webContents.debugger.attach('1.3')
      try {
        const send = (type, offset, buttons) => host.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: x + offset, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons, clickCount: 1 })
        const frame = () => host.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await send('mouseMoved', 0, 0); await frame()
        await send('mousePressed', 0, 1); await frame()
        await send('mouseMoved', dx / 2, 1); await frame()
        await send('mouseMoved', dx, 1); await frame()
        await send('mouseReleased', dx, 0); await frame()
      } finally { host.webContents.debugger.detach() }
    })
    ipcMain.on('resize:result', (_event, error) => {
      console.log(error ? 'NATIVE_RESIZE_FAILURE ' + error : 'NATIVE_RESIZE_SUCCESS')
      host.destroy(); app.exit(error ? 1 : 0)
    })
    host.webContents.on('render-process-gone', (_event, details) => { console.error('RESIZE_RENDERER_GONE', details); app.exit(1) })
    await host.loadFile(join(__dirname, 'page.html'))
    host.showInactive()
    await host.webContents.executeJavaScript(require('node:fs').readFileSync(join(__dirname, 'client.cjs'), 'utf8'))
  }).catch(error => { console.error('RESIZE_MAIN_FAILURE', error); app.exit(1) })
}

function renderer() {
  const { ipcRenderer } = require('electron')
  const React = require(process.env.RESIZE_REACT)
  const { createRoot } = require(process.env.RESIZE_DOM)
  const { readFileSync } = require('node:fs')
  window.__ModuleLoader__ = { load({ factory }) { factory(name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return require(process.env.RESIZE_JSX)
    if (name === '@deepseek-ai/dsh-client-store') return {}
    throw new Error('Unexpected layout dependency: ' + name)
  }) } }
  let stage = 'layout bundle', snapshot, pointerDowns = 0, pointerMoves = 0, pointerUps = 0
  const check = (value, message) => { if (!value) throw new Error(message + '; ' + JSON.stringify(snapshot)) }
  const rect = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height } }
  const root = createRoot(document.getElementById('root'))
  ;(async () => {
    window.eval(readFileSync(require('node:path').join(__dirname, 'layout.cjs'), 'utf8'))
    let state = { layoutInfo: { viewportWidth: innerWidth, sidebar: 280, rightbar: 360, rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false } }
    const listeners = new Set()
    const update = patch => { state = { layoutInfo: { ...state.layoutInfo, ...patch } }; listeners.forEach(listener => listener()) }
    const actions = { setViewportWidth: value => { if (value !== state.layoutInfo.viewportWidth) update({ viewportWidth: value }) }, setSidebar: sidebar => update({ sidebar }), setRightbar: rightbar => update({ rightbar }) }
    const useStore = selector => selector(React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => state))
    const renderSlot = (name, props, options) => {
      if (name === 'main') return React.createElement('div', { id: 'center', style: { flex: 1 } })
      if (name !== 'desktop.mode.content' || process.env.RESIZE_CONTRIBUTION === 'fallback') return options?.fallback ?? null
      return React.createElement('div', { className: 'dshModes' }, React.createElement('div', { className: 'dshModeStage' }, React.createElement('section', { className: 'dshModeBody dshWorkContent', style: { gridTemplateColumns: props.columns } }, props.work, props.resizeHandle)))
    }
    root.render(React.createElement(window.ResizeAppFrame, { useStore, actions, renderSlot, usePanelInfo: fn => fn({ activePanelId: null }), useSessions: fn => fn({ byId: {} }), useFoldedLandscape: fn => fn(false), t: key => key }))
    const waitFor = async (label, predicate) => {
      stage = label
      const deadline = Date.now() + 5000
      while (!await predicate()) { check(Date.now() < deadline, 'Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 20)) }
    }
    await waitFor('AppFrame mount', () => document.querySelectorAll('[data-side]').length === 2 && document.getElementById('center')?.offsetHeight > 0)
    const measure = () => {
      const handle = document.querySelector('[data-side="rightbar"]'), bounds = rect(handle)
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return { center: rect(document.getElementById('center')), handles: [...document.querySelectorAll('[data-side]')].map(element => ({ side: element.dataset.side, ...rect(element) })), rightbar: rect(document.querySelector('[data-rightbar-col]')), stateRightbar: state.layoutInfo.rightbar, pointerDowns, pointerMoves, pointerUps, hit: hit?.outerHTML.slice(0, 400) }
    }
    for (const sidebar of [264, 420, 0, 280]) {
      actions.setSidebar(sidebar)
      await waitFor('rightbar alignment with sidebar=' + sidebar, () => {
        snapshot = measure()
        const handle = snapshot.handles.find(item => item.side === 'rightbar')
        return handle && Math.abs(handle.x + handle.width / 2 - snapshot.rightbar.x) < 1
      })
    }
    snapshot = measure()
    stage = 'rightbar handle alignment'
    const aligned = snapshot.handles.find(handle => handle.side === 'rightbar')
    check(aligned.x + aligned.width / 2 === snapshot.rightbar.x, 'Real rightbar handle center must equal rightbar left edge')
    stage = 'unreserved native bounds'
    const initial = await ipcRenderer.invoke('resize:bounds', snapshot.center)
    check(Object.keys(snapshot.center).every(key => initial[key] === snapshot.center[key]), 'Native view must initially cover the whole center')
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    check(snapshot.handles.every(handle => handle.width === 8 && overlaps(handle, initial)), 'Both real 8px strips must initially overlap native view')
    const present = async () => {
      snapshot = measure()
      const expected = reserveSidebarResizeBounds(snapshot.center)
      const actual = await ipcRenderer.invoke('resize:bounds', expected)
      snapshot.native = actual
      check(actual.width > 0 && Object.keys(expected).every(key => actual[key] === expected[key]), 'WebContentsView bounds differ from production helper')
      check(snapshot.handles.every(handle => !overlaps(handle, actual)), 'Resize strip intersects actual native bounds')
      return actual
    }
    stage = 'reserve both strips'
    const before = await present()
    const width = snapshot.rightbar.width
    const right = snapshot.handles.find(handle => handle.side === 'rightbar')
    const handle = document.querySelector('[data-side="rightbar"]')
    handle.addEventListener('pointerdown', event => { if (event.isTrusted) pointerDowns++ })
    handle.addEventListener('pointermove', event => { if (event.isTrusted && event.buttons === 1) pointerMoves++ })
    handle.addEventListener('pointerup', event => { if (event.isTrusted) pointerUps++ })
    stage = 'trusted rightbar drag'
    await ipcRenderer.invoke('resize:drag', { x: right.x + right.width / 2, y: right.y + right.height / 2, dx: -80 })
    await waitFor('rightbar width changes', () => { snapshot = measure(); return snapshot.rightbar.width === width + 80 })
    check(pointerDowns === 1 && pointerMoves >= 1 && pointerUps === 1 && state.layoutInfo.rightbar === width + 80, 'Real DragHandle did not receive trusted input or update width')
    stage = 'native bounds follow resized center'
    const after = await present()
    check(after.x === before.x && after.width === before.width - 80 && after.height === before.height, 'Native bounds did not follow rightbar resize')
    root.unmount()
    ipcRenderer.send('resize:result')
  })().catch(error => ipcRenderer.send('resize:result', stage + ': ' + error.stack + '; geometry=' + JSON.stringify(snapshot)))
}
