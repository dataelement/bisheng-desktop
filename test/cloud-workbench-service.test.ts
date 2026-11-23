import { expect, it } from 'vitest'
import { CloudWorkbenchService, type CloudFetch } from '../src/main/enterprise/cloud-workbench'

const appId = 'a'.repeat(32)
const otherId = 'b'.repeat(32)
const key = 'c'.repeat(16)
function envelope(data: unknown) { return Response.json({ status_code: 200, data }) }
function app(id: string, slug: string) {
  return { id, name: slug, slug, description: '', state: 'online', version_id: 'd'.repeat(32), entry_path: `/apps/${slug}/` }
}
function catalog(pages: Record<string, unknown>[], calls: string[] = [], base = 'http://enterprise.test/prefix'): CloudFetch {
  return async path => {
    calls.push(path)
    const cursor = new URL(path, 'http://host').searchParams.get('cursor')
    const page = cursor ? pages.find(item => item.cursor === cursor) : pages[0]
    if (!page) throw new Error(`Unexpected page ${cursor}`)
    const { cursor: _cursor, ...data } = page
    return { base, connectionKey: key, response: envelope(data) }
  }
}

it('reads the catalog for the host page and passes through what the server reports', async () => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([{ items: [app(appId, 'board')], next_cursor: null, runtime_enabled: true }], calls))
  await expect(service.request({ operation: 'list', managed: true, cursor: null })).resolves.toEqual({
    items: [app(appId, 'board')], next_cursor: null, runtime_enabled: true, connectionKey: key
  })
  // The editable-apps listing belonged to the retired Agent flow and is never requested.
  expect(calls).toEqual(['/api/v1/dsh/apps?'])
})

it.each(['guide', 'launch', 'create', 'checkout', 'resume', 'publish', 'progress', 'limits', 'project'])('rejects the retired %s operation before any request', async operation => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([], calls))
  await expect(service.request({ operation, appId })).rejects.toThrow('Unsupported cloud workbench operation.')
  expect(calls).toEqual([])
})

it('rejects a malformed cursor before requesting the catalog', async () => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([], calls))
  await expect(service.request({ operation: 'list', cursor: '../admin' })).rejects.toThrow('Invalid application or version identity.')
  expect(calls).toEqual([])
})

it('reports an absent collection API without treating it as an empty catalog', async () => {
  const service = new CloudWorkbenchService(async () => ({
    base: 'http://enterprise.test', connectionKey: key,
    response: Response.json({ detail: 'Not Found' }, { status: 404 })
  }))
  await expect(service.request({ operation: 'list' })).rejects.toThrow('CLOUD_WORKBENCH_API_UNAVAILABLE')
  await expect(service.entry(appId)).rejects.toThrow('CLOUD_WORKBENCH_API_UNAVAILABLE')
})

it('does not label an authentication or upstream failure as an unsupported server', async () => {
  for (const status of [401, 403, 500]) {
    const service = new CloudWorkbenchService(async () => ({
      base: 'http://enterprise.test', connectionKey: key,
      response: Response.json({ status_code: status, status_message: 'Request rejected' }, { status })
    }))
    await expect(service.request({ operation: 'list' })).rejects.toThrow('Request rejected')
  }
})

it('shows the server message when an older Desktop capability is refused', async () => {
  // BiSheng 3.1 answers the retired routes with 16149 and a readable status_message.
  const service = new CloudWorkbenchService(async () => ({
    base: 'http://enterprise.test', connectionKey: key,
    response: Response.json({ status_code: 16149, status_message: '请将毕昇桌面端升级到 1.3.1 或以上后使用此功能' }, { status: 400 })
  }))
  await expect(service.request({ operation: 'list' })).rejects.toThrow('1.3.1')
})

it('resolves where an app is served from the catalog, across pages and behind a path prefix', async () => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([
    { items: [app(otherId, 'other')], next_cursor: otherId },
    { cursor: otherId, items: [app(appId, 'board')], next_cursor: null }
  ], calls))
  await expect(service.entry(appId)).resolves.toEqual({
    appId, slug: 'board', entryUrl: 'http://enterprise.test/prefix/apps/board/', connectionKey: key
  })
  expect(calls).toEqual(['/api/v1/dsh/apps?', `/api/v1/dsh/apps?cursor=${otherId}`])
})

it('refuses an app the catalog no longer lists for this user', async () => {
  const service = new CloudWorkbenchService(catalog([{ items: [app(otherId, 'other')], next_cursor: null }]))
  await expect(service.entry(appId)).rejects.toThrow('no longer available')
})

it.each([
  ['a slug outside the hosted app pattern', { slug: '../admin', entry_path: '/apps/../admin/' }],
  ['an entry path that is not the app root', { slug: 'board', entry_path: '/workspace/' }],
  ['a missing slug', { slug: undefined, entry_path: '/apps/board/' }]
])('rejects %s instead of opening it', async (_case, fields) => {
  const service = new CloudWorkbenchService(catalog([{ items: [{ ...app(appId, 'board'), ...fields }], next_cursor: null }]))
  await expect(service.entry(appId)).rejects.toThrow('Invalid hosted application entry.')
})

it('rejects a renderer-supplied identity that is not an application id', async () => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([], calls))
  for (const value of [undefined, '', 'board', 'A'.repeat(32), { id: appId }]) {
    await expect(service.entry(value)).rejects.toThrow('Invalid application or version identity.')
  }
  expect(calls).toEqual([])
})

it('stops a lookup when the server returns a malformed cursor', async () => {
  const service = new CloudWorkbenchService(catalog([{ items: [], next_cursor: 'not-a-cursor' }]))
  await expect(service.entry(appId)).rejects.toThrow('Invalid application or version identity.')
})

it('bounds a lookup when the server keeps returning the same cursor', async () => {
  const calls: string[] = []
  const service = new CloudWorkbenchService(catalog([{ items: [], next_cursor: otherId }, { cursor: otherId, items: [], next_cursor: otherId }], calls))
  await expect(service.entry(appId)).rejects.toThrow('no longer available')
  expect(calls).toHaveLength(50)
})
