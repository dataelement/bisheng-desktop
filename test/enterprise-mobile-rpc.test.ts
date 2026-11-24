import { expect, it, vi } from 'vitest'
import { EnterpriseMobileRpc, pageMobileSessions, transcriptFollowValue } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-rpc'

it('pages workspace sessions and omits archived sessions before crossing the gateway', async () => {
  const rows = ['b', 'a', 'hidden', 'other'].map(sessionId => ({ sessionId, updatedAt: 10, projections: { values: { title: sessionId, unused: 'x'.repeat(1000) } } }))
  const transport = { port: () => 0, channelToken: () => 'fixture', request: vi.fn(),
    forward: vi.fn(async () => ({ ok: true, value: { items: [{ workspaceId: 'work', sessionIds: ['a', 'b', 'hidden'] }], archivedSessionIds: ['hidden'] } })),
    invoke: vi.fn(async () => ({ ok: true, value: { items: rows } })) }
  const adapter = new EnterpriseMobileRpc(transport)
  const first = await adapter.dispatch({ method: 'session.listPage', payload: { workspaceId: 'work', limit: 1 } })
  const value = first?.value as { items: Array<{ sessionId: string }>; nextCursor: string }
  expect(value.items).toHaveLength(1)
  expect(JSON.stringify(value)).not.toContain('unused')
  const second = await adapter.dispatch({ method: 'session.listPage', payload: { workspaceId: 'work', limit: 1, cursor: value.nextCursor } })
  const next = second?.value as { items: Array<{ sessionId: string }>; hasMore: boolean }
  expect(new Set([...value.items, ...next.items].map(row => row.sessionId))).toEqual(new Set(['a', 'b']))
  expect(next.hasMore).toBe(false)
  adapter.dispose()
  expect((await adapter.dispatch({ method: 'session.listPage' }))?.ok).toBe(false)
})

it('translates only validated permission choices and cannot forward arbitrary command lines', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }))
  const adapter = new EnterpriseMobileRpc({ port: () => 0, channelToken: () => '', request: vi.fn(), forward: vi.fn(), invoke })
  const result = await adapter.dispatch({ method: 'permission.select', payload: { sessionId: 's', preset: 'workspace-write' } })
  expect(result).toEqual({ ok: true, value: { preset: 'workspace-write' } })
  expect(invoke).toHaveBeenCalledWith('commands/execute', { agentId: 's', line: '/permission workspace-write', submittedAttachments: [] })
  expect((await adapter.dispatch({ method: 'permission.select', payload: { sessionId: 's', preset: 'workspace-write', command: 'other' } }))?.ok).toBe(false)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(await adapter.dispatch({ method: 'plugin.install' })).toBeUndefined()
  expect(await adapter.dispatch({ method: 'interaction.pending' })).toBeUndefined()
})

it('builds deterministic bounded cursors for tied timestamps', () => {
  const result = pageMobileSessions({ items: [{ sessionId: 'a', updatedAt: 1 }, { sessionId: 'b', updatedAt: 1 }], limit: 1 })
  expect(result.items).toHaveLength(1)
  const next = pageMobileSessions({ items: [{ sessionId: 'b', updatedAt: 1 }, { sessionId: 'a', updatedAt: 1 }], limit: 1, cursor: result.nextCursor })
  expect(next.items).toHaveLength(1)
  expect(next.items[0]?.sessionId).not.toBe(result.items[0]?.sessionId)
  expect(transcriptFollowValue(null, true, {})).toBeUndefined()
})


it('serves phone Work and Chat cases from the enterprise catalog without a session', async () => {
  const catalog = { work: [{ id: 'work' }], chat: [{ id: 'chat' }], batches: { work: [['work']], chat: [['chat']] } }
  const request = vi.fn(async (_path: string, _init?: RequestInit) => Response.json(catalog))
  const adapter = new EnterpriseMobileRpc({ port: () => 0, channelToken: () => '', request, forward: vi.fn(), invoke: vi.fn() })
  expect(await adapter.dispatch({ method: 'office.call', payload: { endpoint: 'welcome-cases' } })).toEqual({ ok: true, value: {
    cases: catalog.work, batches: catalog.batches.work, chat: catalog.chat, chatBatches: catalog.batches.chat
  } })
  expect(request.mock.calls[0]?.[0]).toBe('/api/enterprise.workbenches/welcome-cases.json')
  adapter.dispose()
})
