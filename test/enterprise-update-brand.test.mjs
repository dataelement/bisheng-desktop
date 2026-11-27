import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { build, loadConfigFromFile } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
const { document, Element, HTMLElement, MutationObserver, navigator, DOMParser, Event, KeyboardEvent } = window
const requestAnimationFrame = window.requestAnimationFrame.bind(window)
const cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
let unload
const roots = new Map()
const PRODUCT_NAME = JSON.parse(await readFile('package.json', 'utf8')).build.productName
afterEach(() => {
  unload?.()
  unload = undefined
  roots.clear()
  document.documentElement.querySelectorAll('#dsh-desktop-update-root, #dsh-desktop-about-root').forEach(node => node.remove())
  vi.restoreAllMocks()
})

it('renders the authoritative BiSheng mark in built About, manual update and notification surfaces', async () => {
  const config = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'electron.vite.config.ts')
  const bundle = await build({
    configFile: false, logLevel: 'silent', resolve: config.config.preload.resolve,
    build: { write: false, minify: false, lib: { entry: 'src/preload/desktop-update-ui.ts', formats: ['cjs'] },
      rollupOptions: { external: ['electron'] } }
  })
  const handlers = new Map()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (options) {
    const shadow = attachShadow.call(this, options)
    roots.set(this.id, shadow)
    return shadow
  })
  const ipcRenderer = {
    on: (name, fn) => handlers.set(name, fn), removeListener: name => handlers.delete(name),
    invoke: vi.fn(async () => ({ phase: 'idle', currentVersion: '1.0.0', manual: false }))
  }
  const exports = {}
  // The preload runs in Electron, where the shell passes the window identity through process.argv.
  const context = vm.createContext({ exports, require: () => ({ ipcRenderer }), window, document,
    HTMLElement, Element, ShadowRoot: window.ShadowRoot, MutationObserver, navigator, console, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, process: { argv: ['electron', '--dsh-product-name=' + encodeURIComponent(PRODUCT_NAME)] } })
  vm.runInContext((Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code, context)
  exports.mountDesktopUpdateUi()
  unload = () => window.dispatchEvent(new Event('unload'))
  await new Promise(resolve => setTimeout(resolve, 0))
  const asset = new DOMParser().parseFromString(await readFile('build/bisheng-logo-mark.svg', 'utf8'), 'image/svg+xml')
  const assertMark = id => {
    const shadow = roots.get(id)
    expect(document.getElementById(id).style.display).not.toBe('none')
    const icon = shadow.querySelector('.app-icon')
    expect(icon.querySelector('svg').getAttribute('viewBox')).toBe('0 0 2400 2400')
    expect([...icon.querySelectorAll('path')].map(path => path.getAttribute('d')))
      .toEqual([...asset.querySelectorAll('path')].map(path => path.getAttribute('d')))
    expect(icon.querySelector('rect').getAttribute('fill')).toBe('#000000')
    // The upstream shell sets all SVG paths to currentColor and adds a green pad.
    expect(icon.querySelector('style').textContent).toContain('padding:0; background:transparent')
    expect(icon.querySelector('style').textContent).toContain('fill:white')
  }
  let presentationId = 0
  for (const [locale, dark] of [['zh', false], ['zh', true], ['en', false], ['en', true]]) {
    document.body.toggleAttribute('data-ds-dark-theme', dark)
    handlers.get('desktop:show-about')({}, { desktopVersion: '1.0.0', locale })
    assertMark('dsh-desktop-about-root')
    expect(roots.get('dsh-desktop-about-root').querySelector('.about-title').textContent).toBe(PRODUCT_NAME)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    handlers.get('updates:status-changed')({}, { phase: 'unsupported', currentVersion: '1.0.0', manual: true, locale, presentationId: ++presentationId })
    assertMark('dsh-desktop-update-root')
    handlers.get('updates:status-changed')({}, { phase: 'checking', currentVersion: '1.0.0', manual: false, locale })
    handlers.get('updates:status-changed')({}, { phase: 'available', currentVersion: '1.0.0', availableVersion: `1.0.${presentationId + 1}`, manual: false, locale })
    assertMark('dsh-desktop-update-root')
    expect(roots.get('dsh-desktop-update-root').querySelector('.notification')).not.toBeNull()
  }
  exports.mountDesktopUpdateUi()
  expect(document.querySelectorAll('#dsh-desktop-update-root')).toHaveLength(1)
}, 30000)
