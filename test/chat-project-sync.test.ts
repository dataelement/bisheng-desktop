import { describe, expect, it, vi } from 'vitest'
import { EnterpriseChatProjects } from '../src/main/enterprise/chat-projects'
import { parseProjectAction, parseProjectSnapshot } from '../src/shared/chat-projects'

const projectId = '11111111-1111-4111-8111-111111111111'
const snapshot = (name = 'Research') => ({ identity: { user_id: 7, tenant_id: 2 }, projects: [{ id: projectId, name }], memberships: [{ chat_id: 'chat-one', project_id: projectId }] })
const json = (data: unknown) => new Response(JSON.stringify({ status_code: 200, data }), { headers: { 'content-type': 'application/json' } })

describe('project protocol boundary', () => {
  it('rejects identity injection, retired fields and arbitrary operations', () => {
    expect(() => parseProjectAction({ operation: 'create', project_id: projectId, name: 'A', user_id: 8 })).toThrow()
    expect(() => parseProjectAction({ operation: 'create', project_id: projectId, name: 'A', request_id: projectId })).toThrow()
    expect(() => parseProjectAction({ operation: 'create', name: 'A' })).toThrow()
    expect(() => parseProjectAction({ operation: 'fetch', url: 'https://example.invalid' })).toThrow()
    expect(parseProjectAction({ operation: 'create', project_id: projectId, name: ' A ' })).toMatchObject({ project_id: projectId, name: 'A' })
  })
  it('accepts the whole legacy record in one import, within the server cap', () => {
    const memberships = Array.from({ length: 2000 }, (_, i) => ({ chat_id: `chat-${i}`, legacy_project_id: 'old' }))
    expect(parseProjectAction({ operation: 'import', projects: [{ legacy_id: 'old', name: 'Old' }], memberships })).toMatchObject({ operation: 'import' })
    expect(() => parseProjectAction({ operation: 'import', projects: [], memberships: [...memberships, memberships[0]] })).toThrow()
    expect(() => parseProjectAction({ operation: 'import', source_client_id: projectId, projects: [], memberships: [] })).toThrow()
  })
  it('rejects malformed snapshots', () => {
    expect(() => parseProjectSnapshot({ ...snapshot(), identity: { user_id: 0, tenant_id: 2 } })).toThrow()
    expect(parseProjectSnapshot(snapshot()).identity).toEqual({ user_id: 7, tenant_id: 2 })
  })
})

it('re-reads on focus and advances its local sequence only when content changes', async () => {
  let name = 'Research'
  const changed = vi.fn()
  const transport = vi.fn(async (path: string) => {
    expect(path).not.toContain('/events')
    return json(snapshot(name))
  })
  const controller = new EnterpriseChatProjects({ epoch: 4, fetch: transport, renew: async () => {}, changed, note: vi.fn(), expectedUserId: '7', expectedTenantId: '2' })
  controller.start()
  await vi.waitFor(() => expect(controller.state().phase).toBe('ready'))
  expect(controller.state().revision).toBe('1')
  await controller.refresh()
  expect(controller.state().revision).toBe('1')
  name = 'Updated'
  controller.refreshIfStale(0)
  await vi.waitFor(() => expect(controller.state().projects[0]?.name).toBe('Updated'))
  expect(controller.state().revision).toBe('2')
  controller.dispose()
})

it('skips a focus refresh inside the burst window but always retries a failed projection', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValue(json(snapshot()))
  const controller = new EnterpriseChatProjects({ epoch: 4, changed: vi.fn(), note: vi.fn(), renew: async () => {}, fetch })
  controller.start()
  await vi.waitFor(() => expect(controller.state()).toMatchObject({ phase: 'error', connection: 'offline' }))
  controller.refreshIfStale()
  await vi.waitFor(() => expect(controller.state()).toMatchObject({ phase: 'ready', connection: 'live' }))
  controller.refreshIfStale()
  expect(fetch).toHaveBeenCalledTimes(2)
  controller.dispose()
})

it('checks epochs, sends one fixed operation and reads current state after it', async () => {
  const calls: Array<{ path: string; body?: string }> = []
  const controller = new EnterpriseChatProjects({ epoch: 4, changed: vi.fn(), note: vi.fn(), renew: async () => {}, fetch: async (path, init) => {
    calls.push({ path, body: typeof init?.body === 'string' ? init.body : undefined })
    return path.endsWith('/actions') ? json({ outcome: { project_id: projectId } }) : json(snapshot('Current'))
  } })
  await expect(controller.action({ operation: 'create', project_id: projectId, name: 'A' }, 3)).rejects.toThrow()
  await controller.action({ operation: 'create', project_id: projectId, name: 'A' }, 4)
  expect(calls[0]).toEqual({ path: '/api/v1/chat/projects/actions', body: JSON.stringify({ operation: 'create', project_id: projectId, name: 'A' }) })
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
