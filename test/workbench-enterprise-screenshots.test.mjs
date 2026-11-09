import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import React, { act } from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWorkbenchListItem, parseWorkbenchDetail, createWorkbenchMarketController, applyEnterpriseWorkbenchMarket } from '../packages/dsh-desktop-enterprise/workbench-market.js'
import { readScreenshotResponse } from '../packages/dsh-desktop-enterprise/workbench-screenshots.js'

const id = 'a'.repeat(32)
const versionId = 'b'.repeat(32)
const imageId = 'c'.repeat(64)
const bytes = Buffer.from('protected-image')
const image = { id: imageId, url: '/api/v1/dsh/market/workbenches/' + id + '/versions/' + versionId + '/screenshots/' + imageId,
  sha256: createHash('sha256').update(bytes).digest('hex'), media_type: 'image/png', width: 800, height: 600, bytes: bytes.length, alt: '概览' }
const item = { id, identity_kind: 'repository', workbench_key: 'company/workbench', legacy_id: null,
  package_name: 'company-workbench', display_name: '企业工作台', description: '工作说明', current_version: { id: versionId, version: '1.0.0' }, screenshots: [image] }
function controller(extra = {}) {
  return createWorkbenchMarketController({ state: () => ({ connected: true, connectionKey: 'account-a' }),
    marketRequest: async () => ({ status_code: 200, data: item }), workbenchScreenshotRequest: async () => bytes, ...extra })
}

describe('enterprise screenshot metadata and scoped resource', () => {
  it('preserves list/detail metadata and keeps old packages compatible', () => {
    expect(parseWorkbenchListItem(item).screenshots).toEqual([image])
    expect(parseWorkbenchDetail(item, id).screenshots).toEqual([image])
    expect(parseWorkbenchListItem({ ...item, screenshots: undefined }).screenshots).toEqual([])
    expect(parseWorkbenchListItem({ ...item, cover: { url: 'https://evil.invalid/x' }, screenshots: [] }).screenshots).toEqual([])
  })
  it.each([
    { url: 'https://evil.invalid/x' }, { url: image.url + '?token=x' }, { url: image.url + '#x' },
    { url: image.url.replace(versionId, 'd'.repeat(32)) }, { url: image.url.replace(id, 'd'.repeat(32)) },
    { url: image.url.replace('/screenshots/', '/screenshots/%2e%2e/') }, { id: '../x' },
    { media_type: 'image/svg+xml' }, { sha256: 'bad' }, { bytes: 5 * 1024 * 1024 + 1 }, { width: 16000001 }, { height: 0 }
  ])('drops an invalid image scope or descriptor %o', patch => {
    expect(parseWorkbenchListItem({ ...item, screenshots: [{ ...image, ...patch }] }).screenshots).toEqual([])
  })
  it('enforces count, aggregate bytes and unique IDs', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({ ...image, id: String(index).repeat(64), url: image.url.slice(0, -64) + String(index).repeat(64) }))
    expect(parseWorkbenchListItem({ ...item, screenshots: images }).screenshots).toEqual([])
    expect(parseWorkbenchListItem({ ...item, screenshots: images.slice(0, 5).map(x => ({ ...x, bytes: 5 * 1024 * 1024 })) }).screenshots).toEqual([])
    expect(parseWorkbenchListItem({ ...item, screenshots: [image, image] }).screenshots).toEqual([])
  })
  it('only reads a current-version declared screenshot and verifies original bytes', async () => {
    const read = vi.fn(async () => bytes)
    const market = controller({ workbenchScreenshotRequest: read })
    expect((await market.screenshot(id, versionId, imageId, undefined, 'account-a')).bytes).toEqual(bytes)
    expect(read).toHaveBeenCalledWith(image.url, expect.any(AbortSignal), image)
    await expect(market.screenshot(id, 'd'.repeat(32), imageId, undefined, 'account-a')).rejects.toMatchObject({ status: 404 })
    await expect(market.screenshot(id, versionId, 'd'.repeat(64), undefined, 'account-a')).rejects.toMatchObject({ status: 404 })
    await expect(market.screenshot(id, versionId, imageId, undefined, 'account-b')).rejects.toMatchObject({ status: 409 })
    expect(read).toHaveBeenCalledTimes(1)
    await expect(controller({ workbenchScreenshotRequest: async () => Buffer.from('wrong') }).screenshot(id, versionId, imageId, undefined, 'account-a')).rejects.toMatchObject({ status: 502 })
  })
  it('discards late bytes on account switch and cancels stopped resources', async () => {
    let accountKey = 'account-a', release, began
    const started = new Promise(resolve => { began = resolve })
    const market = controller({ state: () => ({ connected: true, connectionKey: accountKey }), workbenchScreenshotRequest: async () => { began(); return new Promise(resolve => { release = resolve }) } })
    const pending = market.screenshot(id, versionId, imageId, undefined, accountKey)
    await started
    accountKey = 'account-b'; release(bytes)
    await expect(pending).rejects.toMatchObject({ status: 409 })
    const cancel = new AbortController(); cancel.abort()
    await expect(controller().screenshot(id, versionId, imageId, cancel.signal, 'account-a')).rejects.toMatchObject({ name: 'AbortError' })
    let transportSignal
    const stopped = controller({ workbenchScreenshotRequest: async (_path, signal) => { transportSignal = signal; stopped.stop(); return bytes } })
    await expect(stopped.screenshot(id, versionId, imageId, undefined, 'account-a')).rejects.toMatchObject({ name: 'AbortError' })
    expect(transportSignal.aborted).toBe(true)
  })
  it('returns no-store binary via the existing authenticated connection route', async () => {
    const routes = new Map()
    applyEnterpriseWorkbenchMarket({ connection: { fetch: { register: route => routes.set(route.path, route) } } }, {
      state: () => ({ connected: true, connectionKey: 'account-a' }), refreshState: async () => {}, marketRequest: async () => ({ status_code: 200, data: item }), workbenchScreenshotRequest: async () => bytes
    })
    const route = routes.get('/api/enterprise.workbenches/screenshot')
    const url = 'http://localhost/api/enterprise.workbenches/screenshot?id=' + id + '&versionId=' + versionId + '&imageId=' + imageId
    const response = await route.fetch(new Request(url, { headers: { 'x-enterprise-account': 'account-a' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect((await route.fetch(new Request(url))).status).toBe(409)
  })
  it('rejects remote wrong type, failure, oversized chunks and corrupt hashes', async () => {
    await expect(readScreenshotResponse(new Response(bytes, { headers: { 'content-type': 'image/png' } }), undefined, image)).resolves.toEqual(bytes)
    await expect(readScreenshotResponse(new Response(bytes, { status: 403 }), undefined, image)).rejects.toMatchObject({ status: 403 })
    await expect(readScreenshotResponse(new Response(bytes, { headers: { 'content-type': 'text/html' } }), undefined, image)).rejects.toMatchObject({ status: 502 })
    await expect(readScreenshotResponse(new Response(Buffer.alloc(100), { headers: { 'content-type': 'image/png' } }), undefined, image)).rejects.toThrow('size limit')
    await expect(readScreenshotResponse(new Response(Buffer.alloc(bytes.length), { headers: { 'content-type': 'image/png' } }), undefined, image)).rejects.toThrow('integrity')
  })
})

const source = await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8')
let cleanup
 afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })
async function clientFixture(request = async () => new Response(bytes, { headers: { 'content-type': 'image/png' } })) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.localStorage.setItem('dsh-workbench-enabled', 'true')
  dom.window.URL.createObjectURL = vi.fn(() => 'blob:protected-' + Math.random())
  dom.window.URL.revokeObjectURL = vi.fn()
  let definition
  dom.window.__ModuleLoader__ = { load: value => { definition = value } }
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, setTimeout, clearTimeout, AbortController })
  const client = definition.factory(name => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    if (name === '@deepseek-ai/cordis') return { Service: { tracker: Symbol('tracker') } }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: () => null, Toast: () => null }
    throw Error('Unexpected module ' + name)
  })
  const service = new client.Workbenches({}, request)
  service.enterpriseAccountKey = 'account-a'
  service.ready = true
  const entry = { id, versionId, screenshots: [image], enterprise: true, title: '企业工作台', packageName: item.package_name, version: '1.0.0' }
  const root = createRoot(document.getElementById('root'))
  cleanup = async () => { await act(async () => root.unmount()); service.dispose(); dom.window.close() }
  return { client, service, entry, root, dom, render: element => act(async () => root.render(element)) }
}

describe('enterprise image browser lifecycle', () => {
  it('shares authenticated fetches, releases only the final reference, and retries after failure', async () => {
    const request = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
    const f = await clientFixture(request)
    const a = f.service.acquireEnterpriseImage(f.entry, image), b = f.service.acquireEnterpriseImage(f.entry, image)
    expect(await a.promise).toBe(await b.promise)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].startsWith('/api/enterprise.workbenches/screenshot?')).toBe(true)
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', headers: { 'x-enterprise-account': 'account-a' } })
    a.release(); expect(f.dom.window.URL.revokeObjectURL).not.toHaveBeenCalled()
    b.release(); expect(f.dom.window.URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    const c = f.service.acquireEnterpriseImage(f.entry, image); await c.promise; c.release()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not retain a failed image as a negative cache entry', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockImplementationOnce(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
    const f = await clientFixture(request)
    const first = f.service.acquireEnterpriseImage(f.entry, image)
    await expect(first.promise).rejects.toThrow('unavailable')
    const retry = f.service.acquireEnterpriseImage(f.entry, image)
    expect(await retry.promise).toMatch(/^blob:/)
    expect(request).toHaveBeenCalledTimes(2)
    first.release(); retry.release()
  })
  it('aborts cancelled loads and does not create URLs after account switch or disposal', async () => {
    let finish
    const request = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const f = await clientFixture(request)
    const a = f.service.acquireEnterpriseImage(f.entry, image)
    const failed = expect(a.promise).rejects.toThrow('account changed')
    f.service.enterpriseAccountKey = 'account-b'
    f.service.clearEnterpriseImages()
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    finish(new Response(bytes, { headers: { 'content-type': 'image/png' } }))
    await failed
    expect(f.dom.window.URL.createObjectURL).not.toHaveBeenCalled()
    a.release()
  })
  it('renders protected card and detail images and revokes URLs on unmount', async () => {
    const f = await clientFixture()
    await f.render(React.createElement(React.Fragment, null, React.createElement(f.client.Preview, { entry: f.entry, service: f.service }), React.createElement(f.client.ScreenshotGallery, { entry: f.entry, service: f.service })))
    expect(document.querySelectorAll('img').length).toBe(2)
    expect([...document.querySelectorAll('img')].every(img => img.src.startsWith('blob:'))).toBe(true)
    expect(f.dom.window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    await f.render(null)
    expect(f.dom.window.URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
  it('keeps no-screenshot compatibility and shows localized image failure placeholders', async () => {
    const f = await clientFixture(async () => new Response('', { status: 403 }))
    await f.render(React.createElement(f.client.Preview, { entry: f.entry, service: f.service }))
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('截图暂时无法加载')
    await f.render(React.createElement(f.client.Preview, { entry: { ...f.entry, screenshots: [] }, service: f.service }))
    expect(document.body.textContent).toContain('暂无截图')
  })
  it.each(['zh', 'en'])('presents optional homepage and translated technical details, separate install/activation/integrity in %s', async language => {
    const f = await clientFixture()
    const copy = { technical: language === 'en' ? 'Technical information' : '技术信息', homepage: language === 'en' ? 'Project homepage' : '项目主页', enabled: language === 'en' ? 'Installed and enabled' : '已安装并启用', disabled: language === 'en' ? 'Installed, not enabled' : '已安装，尚未启用', restart: language === 'en' ? 'Restart to use' : '重启后生效', verified: language === 'en' ? 'The package integrity check passed.' : '原包完整性核对通过。' }
    f.service.ctx.locale = { getSnapshot: () => ({ active: language }), bind: () => key => copy[key] || key }
    f.service.enterpriseDetail = { id, currentVersion: { id: versionId, version: '1.0.0' }, screenshots: [image], verifiable: true, packageMetadata: { repositoryUrl: 'https://example.invalid/project', patchEntryId: 'internal-id', clientEntry: './client.js', dependencies: ['peer'] } }
    f.service.native = { status: 'ready', bundles: { [item.package_name]: { installed: true, enabled: false, version: '1.0.0' } } }
    f.service.activationFor = () => 'off'
    f.service.publish()
    const element = () => React.createElement(f.client.DetailModal, { entry: f.entry, service: f.service, onClose() {} })
    await f.render(element())
    expect(document.querySelector('details').open).toBe(false)
    expect(document.querySelector('summary').textContent).toBe(copy.technical)
    expect(document.querySelector('a').textContent).toBe(copy.homepage)
    expect(document.body.textContent).toContain(copy.disabled)
    expect(document.querySelector('details').textContent).toContain('internal-id')
    f.service.activationFor = () => 'on'; f.service.enterpriseVerify = { id, status: 'ok' }
    await act(async () => f.service.publish())
    expect(document.body.textContent).toContain(copy.enabled)
    expect(document.body.textContent).toContain(copy.verified)
    f.service.pendingRestart.add(id)
    await act(async () => f.service.publish())
    expect(document.body.textContent).toContain(copy.restart)
    expect(document.body.textContent).not.toContain(copy.enabled)
  })
})
