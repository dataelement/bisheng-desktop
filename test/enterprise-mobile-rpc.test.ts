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

  it('pages the desktop sidebar order and leaves hidden rows off the page', () => {
    const items = [
      { sessionId: 'old', updatedAt: 1, blank: false, projections: { values: { title: '旧的' } } },
      { sessionId: 'child', updatedAt: 9, origin: 'subagent', projections: { values: { title: '子会话' } } },
      { sessionId: 'blank-other', updatedAt: 8, blank: true },
      { sessionId: 'blank-open', updatedAt: 2, blank: true },
      { sessionId: 'pinned-old', updatedAt: 3, blank: false, projections: { values: { title: '置顶旧' } } },
      { sessionId: 'pinned-new', updatedAt: 4, blank: false, projections: { values: { title: '置顶新' } } },
      { sessionId: 'fresh', updatedAt: 7, blank: false, origin: 'main', projections: { values: { title: '新的' } } },
      { sessionId: 'stray', updatedAt: 6, blank: false, projections: { values: { title: '未分组' } } }
    ]
    const membership = new Set(['old', 'child', 'blank-other', 'blank-open', 'pinned-old', 'pinned-new', 'fresh'])
    const first = pageMobileSessions({
      items,
      sessionIds: membership,
      archivedSessionIds: new Set(['old']),
      pinnedSessionIds: new Set(['pinned-old', 'pinned-new']),
      openSessionId: 'blank-open',
      limit: 2
    })
    expect(first.items.map((item) => item.sessionId)).toEqual(['blank-open', 'pinned-new'])
    expect(first.items[0]).toMatchObject({ blank: true, sessionId: 'blank-open' })
    expect(first.hasMore).toBe(true)

    const second = pageMobileSessions({
      items,
      sessionIds: membership,
      archivedSessionIds: new Set(['old']),
      pinnedSessionIds: new Set(['pinned-old', 'pinned-new']),
      openSessionId: 'blank-open',
      cursor: first.nextCursor,
      limit: 2
    })
    expect(second.items.map((item) => item.sessionId)).toEqual(['pinned-old', 'fresh'])
    expect(second.items[1]?.origin).toBe('main')
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeUndefined()

    const stray = pageMobileSessions({
      items,
      excludeSessionIds: membership,
      openSessionId: 'blank-open'
    })
    expect(stray.items.map((item) => item.sessionId)).toEqual(['stray'])
  })

it('forwards open/pinned ordering and pages ungrouped sessions independently', async () => {
  const items = [
    { sessionId: 'blank', blank: true, updatedAt: 1 },
    { sessionId: 'pin', updatedAt: 2, origin: 'main' },
    { sessionId: 'recent', updatedAt: 10 },
    { sessionId: 'other-workspace', updatedAt: 12 },
    { sessionId: 'stray', updatedAt: 11 },
    { sessionId: 'child', origin: 'subagent', updatedAt: 15 },
    { sessionId: 'closed-blank', blank: true, updatedAt: 16 }
  ]
  const adapter = new EnterpriseMobileRpc({ port: () => 0, channelToken: () => '', request: vi.fn(),
    forward: vi.fn(async () => ({ ok: true, value: { items: [
      { workspaceId: 'a', sessionIds: ['blank', 'pin', 'recent'] },
      { workspaceId: 'b', sessionIds: ['other-workspace'] }
    ], pinnedSessionIds: ['pin'] } })),
    invoke: vi.fn(async () => ({ ok: true, value: { items } })) })
  const first = await adapter.dispatch({ method: 'session.listPage', payload: { workspaceId: 'a', openSessionId: 'blank', limit: 2 } })
  expect(first?.value).toMatchObject({ items: [{ sessionId: 'blank' }, { sessionId: 'pin', origin: 'main' }], nextCursor: 'pinned:2:pin', hasMore: true })
  const next = await adapter.dispatch({ method: 'session.listPage', payload: { workspaceId: 'a', openSessionId: 'blank', cursor: 'pinned:2:pin', limit: 2 } })
  expect(next?.value).toMatchObject({ items: [{ sessionId: 'recent' }], hasMore: false })
  const stray = await adapter.dispatch({ method: 'session.listPage', payload: { ungrouped: true } })
  expect(stray?.value).toMatchObject({ items: [{ sessionId: 'stray' }], hasMore: false })
  const invalidCursor = pageMobileSessions({ items, openSessionId: 'blank', cursor: '10:recent' })
  expect(invalidCursor.items[0]?.sessionId).toBe('blank')
  adapter.dispose()
})
