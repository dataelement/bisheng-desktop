import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { prepareWelcomeCase, welcomeBatch, welcomeCopy } from '../packages/dsh-desktop-enterprise/welcome-cases-client.js'
const catalog = JSON.parse(await readFile(new URL('../packages/dsh-desktop-enterprise/welcome-cases.json', import.meta.url), 'utf8'))
it('keeps the complete bilingual legacy catalog and rotates through every Work example', () => {
  expect(catalog.chat).toHaveLength(10)
  expect(catalog.work).toHaveLength(34)
  const seen = new Set()
  for (let index = 0; index < catalog.batches.work.length; index++) for (const item of welcomeBatch(catalog, index)) {
    expect(item.title.zh).toBeTruthy(); expect(item.title.en).toBeTruthy(); expect(item.promptEn).toBeTruthy(); seen.add(item.id)
  }
  expect(seen.size).toBe(catalog.work.length)
  expect(welcomeBatch(catalog, catalog.batches.work.length)).toEqual(welcomeBatch(catalog))
})
function fixture() {
  const call = vi.fn(async (channel, endpoint, body) => channel === '/dsh-ppt' ? { ok: true, value: { status: 'ok', data: {} } } : { ok: true, value: { templates: [{ id: 'minutes', mode: 'word', title: '会议纪要 · 发布会筹备', revision: 'v1' }] } })
  return { connection: { rpc: { call } }, remote: { agentPresets: { select: vi.fn(async () => ({ ok: true })) } }, locale: { bind: () => key => welcomeCopy.zh[key] } }
}
it('prepares a versioned Office template in the selected session', async () => {
  const ctx = fixture()
  await prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'event-minutes'), 'session', new AbortController().signal)
  expect(ctx.connection.rpc.call.mock.calls.map(call => call[2])).toEqual([
    { sessionId: 'session', endpoint: 'catalog' },
    { sessionId: 'session', endpoint: 'mode', mode: 'word' },
    { sessionId: 'session', endpoint: 'select', templateId: 'minutes', revision: 'v1' }
  ])
})
it('selects Creator through the existing preset API and PPT through its public RPC', async () => {
  const ctx = fixture(), signal = new AbortController().signal
  await prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'creator-pomodoro'), 'session', signal)
  expect(ctx.remote.agentPresets.select).toHaveBeenCalledWith('session', 'cordis')
  await prepareWelcomeCase(ctx, catalog.work[0], 'session', signal)
  expect(ctx.connection.rpc.call).toHaveBeenCalledWith('/dsh-ppt', 'presentation/mode', { sessionId: 'session', mode: 'ppt' }, signal)
})
it('does not change mode when a required template is missing or selection is cancelled', async () => {
  const ctx = fixture()
  ctx.connection.rpc.call.mockResolvedValue({ ok: true, value: { templates: [] } })
  await expect(prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'event-minutes'), 'session', new AbortController().signal)).rejects.toThrow('模板')
  expect(ctx.connection.rpc.call).toHaveBeenCalledTimes(1)
  const controller = new AbortController(); controller.abort()
  await expect(prepareWelcomeCase(ctx, catalog.work[0], 'session', controller.signal)).rejects.toThrow()
  expect(ctx.connection.rpc.call).toHaveBeenCalledTimes(1)
})

it('mounts through the existing hero slot and preserves drafts edited during template loading', async () => {
  const { JSDOM } = await import('jsdom')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { mountWelcomeCases } = await import('../packages/dsh-desktop-enterprise/welcome-cases-client.js')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let Component, release, root, dispose
  const ctx = fixture()
  ctx.locale.register = vi.fn(() => () => {})
  ctx.slots = { inject: (_seat, run) => run(), register: (definition, component) => { if (definition.name === 'conversation.hero.dock') Component = component; return () => {} } }
  const actions = { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: vi.fn(() => false), persistDraft: vi.fn() }
  try {
    dispose = mountWelcomeCases(React, ctx, catalog)
    ctx.connection.rpc.call.mockImplementation(() => new Promise(resolve => { release = () => resolve({ ok: true, value: { status: 'ok', data: {} } }) }))
    root = createRoot(document.getElementById('root'))
    await React.act(async () => { root.render(React.createElement(Component, { sessionId: 'session', session: { blank: true }, input: { phase: 'plain' }, inputActions: actions })) })
    await React.act(async () => document.querySelector('.bishengWelcomeCaseGrid button').click())
    await React.act(async () => release())
    expect(actions.insertText).toHaveBeenCalled()
    expect(actions.persistDraft).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('保留了你的草稿')
  } finally {
    if (root) await React.act(async () => root.unmount())
    dispose?.(); dom.window.close(); vi.unstubAllGlobals()
  }
})

it('uses the shared selectors and preserves an explicitly selected PPT template', async () => {
  const ctx = fixture()
  ctx.desktopOffice = { mutate: vi.fn(async () => true), snapshot: () => ({}) }
  ctx.desktopPresentation = { snapshot: () => ({ activeMode: 'ppt', selectedId: 'custom-ppt' }), change: vi.fn(async () => true) }
  const signal = new AbortController().signal
  await prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'data-infrastructure'), 'session', signal)
  expect(ctx.desktopPresentation.change).toHaveBeenCalledWith('session', { mode: 'ppt', templateId: 'custom-ppt', clearTemplate: false }, signal)
  await prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'luma-launch'), 'session', signal)
  expect(ctx.desktopPresentation.change).toHaveBeenLastCalledWith('session', { mode: 'ppt', clearTemplate: true }, signal)
  await prepareWelcomeCase(ctx, catalog.work.find(item => item.id === 'event-minutes'), 'session', signal)
  expect(ctx.desktopOffice.mutate).toHaveBeenLastCalledWith('session', 'select', { templateId: 'minutes', revision: 'v1' })
})

it('maps selected templates back to prompts without replacing manual text or inline references', async () => {
  const { templatePromptEdit } = await import('../packages/dsh-desktop-enterprise/welcome-cases-client.js')
  const item = catalog.work.find(item => item.id === 'event-minutes')
  const template = { mode: 'word', title: item.template, id: 'minutes' }
  expect(templatePromptEdit({ phase: 'plain', draft: '', draftRev: 1 }, template, [template], catalog.work).text).toBe(item.prompt)
  expect(templatePromptEdit({ phase: 'plain', draft: 'My independently edited draft', draftRev: 2 }, template, [template], catalog.work)).toBeUndefined()
  const input = { phase: 'plain', draft: '@file\n' + item.prompt, draftRev: 4, occurrences: [{ offset: 0, length: 5 }] }
  expect(templatePromptEdit(input, template, [template], catalog.work, 'en')).toMatchObject({ text: item.promptEn, span: { start: 2, draftRev: 4 } })
  expect(templatePromptEdit({ ...input, occurrences: [{ offset: 7, length: 5 }] }, template, [template], catalog.work)).toBeUndefined()
})

it('shows cases through the sessionless hero and blank-session composer outlets, then hides them after a message', async () => {
  const { JSDOM } = await import('jsdom')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { mountWelcomeCases } = await import('../packages/dsh-desktop-enterprise/welcome-cases-client.js')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const components = new Map(), ctx = fixture()
  ctx.locale.register = () => () => {}
  ctx.slots = { inject: (_seat, run) => run(), register: (definition, component) => { components.set(definition.name, component); return () => {} } }
  let root, dispose
  try {
    dispose = mountWelcomeCases(React, ctx, catalog)
    root = createRoot(document.getElementById('root'))
    const render = async (seat, props) => React.act(async () => root.render(React.createElement(components.get(seat), props)))
    await render('conversation.hero.dock', {})
    expect(document.querySelectorAll('.bishengWelcomeCases')).toHaveLength(1)
    await render('conversation.composer.dock', { sessionId: 'blank', session: { blank: true } })
    expect(document.querySelectorAll('.bishengWelcomeCases')).toHaveLength(1)
    expect(document.querySelectorAll('.bishengWelcomeCaseGrid > button')).toHaveLength(3)
    expect(document.querySelectorAll('.bsw-quick-icon svg')).toHaveLength(3)
    expect(document.querySelector('header h3').textContent).toBe('从一个案例开始')
    expect(document.querySelector('.bsw-dock-root .bsw-dock .bsw-viewport .bishengWelcomeCases')).not.toBeNull()
    const before = document.querySelector('.bishengWelcomeCaseGrid').textContent
    await React.act(async () => document.querySelector('.bishengWelcomeCases header button').click())
    expect(document.querySelector('.bishengWelcomeCaseGrid').textContent).not.toBe(before)
    await render('conversation.composer.dock', { sessionId: 'active', session: { blank: false } })
    expect(document.querySelector('.bishengWelcomeCases')).toBeNull()
  } finally {
    if (root) await React.act(async () => root.unmount())
    dispose?.(); dom.window.close(); vi.unstubAllGlobals()
  }
})

it('gives PPT, Word and Excel choosers exclusive dock ownership and restores examples on exit', async () => {
  const { JSDOM } = await import('jsdom')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { mountWelcomeCases } = await import('../packages/dsh-desktop-enterprise/welcome-cases-client.js')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const store = () => {
    const states = new Map(), listeners = new Map()
    return {
      snapshot: id => states.get(id) || { templates: [] },
      subscribe: (id, listener) => { const set = listeners.get(id) || new Set(); set.add(listener); listeners.set(id, set); return () => set.delete(listener) },
      update: (id, value) => { states.set(id, { templates: [], ...value }); for (const listener of listeners.get(id) || []) listener() },
      listeners
    }
  }
  const ctx = fixture(), components = new Map()
  ctx.desktopOffice = store(); ctx.desktopPresentation = store()
  ctx.locale.register = () => () => {}
  ctx.slots = { inject: (_seat, run) => run(), register: (definition, component) => { components.set(definition.name, component); return () => {} } }
  let root, dispose
  try {
    dispose = mountWelcomeCases(React, ctx, catalog)
    root = createRoot(document.getElementById('root'))
    for (const sessionId of [undefined, 'blank']) {
      const seat = sessionId ? 'conversation.composer.dock' : 'conversation.hero.dock'
      await React.act(async () => root.render(React.createElement(components.get(seat), { sessionId, session: sessionId ? { blank: true } : undefined })))
      expect(document.querySelector('.bsw-dock-root')).not.toBeNull()
      for (const mode of ['ppt', 'word', 'excel']) {
        const activeStore = mode === 'ppt' ? ctx.desktopPresentation : ctx.desktopOffice
        await React.act(async () => activeStore.update(sessionId, mode === 'ppt' ? { activeMode: mode, selectedId: 'template' } : { mode }))
        expect(document.querySelector('.bsw-dock-root')).toBeNull()
        await React.act(async () => activeStore.update(sessionId, {}))
        expect(document.querySelectorAll('.bishengWelcomeCases')).toHaveLength(1)
      }
    }
    await React.act(async () => root.unmount()); root = null
    for (const service of [ctx.desktopOffice, ctx.desktopPresentation]) for (const listeners of service.listeners.values()) expect(listeners.size).toBe(0)
  } finally {
    if (root) await React.act(async () => root.unmount())
    dispose?.(); dom.window.close(); vi.unstubAllGlobals()
  }
})

it('prepares Word and creator examples inside the declared Cordis injection boundary', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const source = await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')
  const declaration = source.match(/ctx\.inject\?\.\(\[([^\]]+)\], scoped => bindEnterpriseWelcomeCases\(scoped\)\)/)
  expect(declaration).not.toBeNull()
  const inject = [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  const services = fixture(), ctx = new Context()
  services.desktopOffice = { snapshot: () => ({}), mutate: vi.fn(async () => true) }
  services.desktopPresentation = { snapshot: () => ({}), change: vi.fn(async () => true) }
  for (const [name, service] of Object.entries(services)) ctx.provide(name, service)
  ctx.provide('remote.agentPresets', services.remote.agentPresets)
  let prepare
  try {
    await ctx.plugin({ inject, apply(scope) { prepare = async item => prepareWelcomeCase(scope, item, 'session', new AbortController().signal) } })
    expect(prepare).toBeTypeOf('function')
    await prepare(catalog.work.find(item => item.id === 'event-minutes'))
    expect(services.connection.rpc.call).toHaveBeenCalledWith('/api', 'office-templates', { sessionId: 'session', endpoint: 'catalog' }, expect.any(AbortSignal))
    await prepare(catalog.work.find(item => item.id === 'creator-pomodoro'))
    expect(services.remote.agentPresets.select).toHaveBeenCalledWith('session', 'cordis')
  } finally { await ctx.fiber.dispose() }
})
