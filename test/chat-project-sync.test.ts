import { describe, expect, it, vi } from 'vitest'
import { EnterpriseChatProjects } from '../src/main/enterprise/chat-projects'
import { parseProjectAction, parseProjectSnapshot } from '../src/shared/chat-projects'

const projectId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const snapshot = (revision = '1', name = 'Research') => ({ protocol_version: 1, identity: { user_id: 7, tenant_id: 2 }, revision, projects: [{ id: projectId, name }], memberships: [{ chat_id: 'chat-one', project_id: projectId }], next_cursor: null })
const json = (data: unknown) => new Response(JSON.stringify({ status_code: 200, data }), { headers: { 'content-type': 'application/json' } })

describe('project protocol boundary', () => {
  it('rejects identity injection and arbitrary operations', () => {
    expect(() => parseProjectAction({ operation: 'create', request_id: requestId, name: 'A', user_id: 8 })).toThrow()
    expect(() => parseProjectAction({ operation: 'fetch', url: 'https://example.invalid' })).toThrow()
    expect(parseProjectAction({ operation: 'create', request_id: requestId, name: ' A ' })).toMatchObject({ name: 'A' })
  })
  it('rejects unsupported/malformed snapshots', () => {
    expect(() => parseProjectSnapshot({ ...snapshot(), protocol_version: 2 })).toThrow()
    expect(() => parseProjectSnapshot({ ...snapshot(), revision: 2 })).toThrow()
    expect(parseProjectSnapshot(snapshot()).identity).toEqual({ user_id: 7, tenant_id: 2 })
  })
})

it('updates automatically from the event stream and cancels its reader on disposal', async () => {
  let revision = '1'
  let name = 'Research'
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const cancelled = vi.fn()
  const transport = vi.fn(async (path: string) => path.endsWith('/events')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller }, cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } })
    : json(snapshot(revision, name)))
  const controller = new EnterpriseChatProjects({ epoch: 4, fetch: transport, renew: async () => {}, changed: vi.fn(), note: vi.fn(), expectedUserId: '7', expectedTenantId: '2' })
  controller.start()
  await vi.waitFor(() => expect(controller.state().phase).toBe('ready'))
  revision = '2'; name = 'Updated'
  stream?.enqueue(new TextEncoder().encode('event: changed\ndata: {"protocol_version":1,"revision":"2","notification":"live"}\n\n'))
  await vi.waitFor(() => expect(controller.state().projects[0]?.name).toBe('Updated'))
  controller.dispose()
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
})

it('checks epochs, sends one fixed operation and reads current state after replay', async () => {
  const calls: Array<{ path: string; body?: string }> = []
  const controller = new EnterpriseChatProjects({ epoch: 4, changed: vi.fn(), note: vi.fn(), renew: async () => {}, fetch: async (path, init) => {
    calls.push({ path, body: typeof init?.body === 'string' ? init.body : undefined })
    return path.endsWith('/actions') ? json({ revision: '3', applied_revision: '1', replayed: true, notification: 'live', outcome: { project_id: projectId } }) : json(snapshot('3', 'Current'))
  } })
  await expect(controller.action({ operation: 'create', name: 'A', request_id: requestId }, 3)).rejects.toThrow()
  await controller.action({ operation: 'create', name: 'A', request_id: requestId }, 4)
  expect(calls[0]?.path).toBe('/api/v1/chat/projects/actions')
  expect(controller.state().projects[0]?.name).toBe('Current')
  controller.dispose()
})

it('ignores a response completed after identity disposal', async () => {
  let finish: ((response: Response) => void) | undefined
  const controller = new EnterpriseChatProjects({ epoch: 4, changed: vi.fn(), note: vi.fn(), renew: async () => {}, fetch: () => new Promise(resolve => { finish = resolve }) })
  const pending = controller.refresh()
  controller.dispose()
  finish?.(json(snapshot()))
  await pending.catch(() => undefined)
  expect(controller.state().projects).toEqual([])
})

it('renews the current cookie session once after an HTTP authentication failure', async () => {
  const renew = vi.fn(async () => {})
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(json(snapshot()))
  const controller = new EnterpriseChatProjects({ epoch: 4, changed: vi.fn(), note: vi.fn(), renew, fetch })
  await controller.refresh()
  expect(renew).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(controller.state().projects).toHaveLength(1)
  controller.dispose()
})

it('refuses a snapshot from an identity other than the owning enterprise account', async () => {
  const controller = new EnterpriseChatProjects({ epoch: 4, expectedUserId: '8', expectedTenantId: '2', changed: vi.fn(), note: vi.fn(), renew: async () => {}, fetch: async () => json(snapshot()) })
  await expect(controller.refresh()).rejects.toThrow()
  expect(controller.state()).toMatchObject({ projects: [], assignments: {}, error: 'auth_required' })
  controller.dispose()
})
