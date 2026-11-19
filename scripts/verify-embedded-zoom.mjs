import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

// Keep the reusable zoom fixture as source; its bundles and userData are disposable.
const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-embedded-zoom-'))
try {
  await build({ entryPoints: [join(root, 'src/preload/enterprise-chat.ts')], outfile: join(temporary, 'preload/enterprise-chat.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const entry = join(temporary, 'main/index.cjs')
  await build({ stdin: { resolveDir: root, contents: `
    import assert from 'node:assert/strict'
    import { createServer } from 'node:http'
    import { app, BrowserWindow } from 'electron'
    import { EnterpriseChatView } from './src/main/enterprise/chat-view'

    app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))})
    async function verify() {
      await app.whenReady()
      const server = createServer((_req, res) => {
        res.setHeader('content-type', 'text/html')
        res.end('<html><body><button>Zoom fixture</button></body></html>')
      })
      let window, host
      try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
        await window.loadURL('data:text/html,<html><body>Host</body></html>')
        const base = 'http://127.0.0.1:' + server.address().port
        const enterprise = {
          snapshot: () => ({ connected: true, connectionKey: 'zoom-fixture' }),
          subscribe: () => () => {},
          webSession: async () => ({ base, cookieName: 'fixture', cookie: 'fixture', expiresAt: Date.now() + 300000 })
        }
        host = new EnterpriseChatView(enterprise, console.log)
        host.present(window, { visible: true, theme: 'light', bounds: { x: 120, y: 48, width: 480, height: 400 } })
        // Wait for actual Chromium load; no production account or Profile is used.
        await new Promise((resolve, reject) => {
          const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Fixture load timed out.')) }, 10000)
          const timer = setInterval(() => {
            if (host.snapshot().phase === 'ready') { clearInterval(timer); clearTimeout(deadline); resolve() }
          }, 20)
        })
        const view = window.contentView.children[0]
        assert.ok(view, 'Embedded native view is mounted')
        for (const level of [-1, 1, 0]) {
          window.webContents.setZoomLevel(level)
          host.syncZoom(window)
          assert.ok(Math.abs(view.webContents.getZoomFactor() - window.webContents.getZoomFactor()) < 0.00001)
          assert.equal(view.getBounds().x, Math.round(120 * window.webContents.getZoomFactor()))
          console.log(JSON.stringify({ level, hostZoom: window.webContents.getZoomFactor(), embeddedZoom: view.webContents.getZoomFactor(), bounds: view.getBounds() }))
        }
        console.log('REAL_ELECTRON_ZOOM_PASS')
      } finally {
        host?.dispose()
        window?.destroy()
        server.close()
      }
    }
    verify().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define: { 'import.meta.dirname': '__dirname' } })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [entry], { env, stdio: 'inherit', signal: AbortSignal.timeout(30_000) })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  assert.equal(code, 0, 'Native embedded zoom verification failed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
