import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const adapter = await readFile(path.resolve('packages/ppt-runtime/adapter/lib/client.js'), 'utf8')
const core = await readFile(path.resolve('packages/ppt-runtime/core/lib/client.js'), 'utf8')

function slice(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`missing ${start}`)
  return source.slice(from, to)
}

function normalizedStoreSource(source) {
  return slice(source, 'const STAGED_MODE_KEY', 'function useMode')
    .replace(/\r\n/g, '\n')
    .replace(
      /^([ \t]*)constructor\(\) \{\n\1[ \t]+this\.states = \/\* @__PURE__ \*\/ new Map\(\);\n\1[ \t]+this\.listeners = \/\* @__PURE__ \*\/ new Map\(\);\n\1\}/m,
      '$1states = /* @__PURE__ */ new Map();\n$1listeners = /* @__PURE__ */ new Map();'
    )
}

// Run the actual store with its production loader, including the browser timer boundary.
const stores = [adapter, core].map(source => new Function('window', 'en', `
  ${slice(source, 'const TEMPLATE_LOAD_TIMEOUT_MS', 'const FALLBACK_TEMPLATE_PREVIEW_PAGE_COUNT')}
  ${slice(source, 'const STAGED_MODE_KEY', 'function useMode')}
  ${slice(source, 'function loadTemplateState', 'function deselectTemplate')}
  return OfficePptHeroStore;
`)({ setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer) }, {
  'templates.loadTimeout': 'Template loading timed out. Try again.'
}))

afterEach(() => vi.useRealTimers())
const [Store] = stores

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const createOfficePptClient = new Function(`${slice(adapter, 'function createOfficePptClient', 'const standardInject')}\nreturn createOfficePptClient;`)()

function client(handler) {
  const calls = []
  return {
    calls,
    bound: true,
    async call(endpoint, payload) {
      calls.push({ endpoint, payload })
      return handler(endpoint, payload)
    }
  }
}

describe('unbound PPT mode', () => {
  it('keeps the staged store implementation aligned between the two clients', () => {
    expect(normalizedStoreSource(adapter)).toBe(normalizedStoreSource(core))
    const asWindowsCheckout = (source) => source.replace(/\r?\n/g, '\r\n')
    expect(normalizedStoreSource(asWindowsCheckout(adapter))).toBe(
      normalizedStoreSource(asWindowsCheckout(core))
    )
  })

  it('selects a template locally and writes it once when a blank session appears', async () => {
    const mode = new Store()
    let selected = null
    const rpc = client(() => ({
      templates: [{ id: 'built-in-a' }],
      presentationMode: selected === null ? null : 'ppt',
      selectedTemplateId: selected
    }))
    rpc.call = async (endpoint, payload) => {
      rpc.calls.push({ endpoint, payload })
      if (endpoint === 'template/select') selected = payload.templateId
      return {
        templates: [{ id: 'built-in-a' }],
        presentationMode: selected === null ? null : 'ppt',
        selectedTemplateId: selected
      }
    }
    mode.setMode(undefined, 'ppt')
    mode.select(undefined, { id: 'built-in-a' }, 'ppt')
    expect(rpc.calls).toEqual([])
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state', 'template/select', 'state'])
    expect(rpc.calls[1].payload).toEqual({ templateId: 'built-in-a', mode: 'ppt' })
    expect(mode.snapshot('session-a').selectedId).toBe('built-in-a')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    const again = rpc.calls.length
    await mode.adopt('session-a', rpc)
    expect(rpc.calls).toHaveLength(again)
  })

  it('reads a phone-selected template when nothing was staged locally', async () => {
    const mode = new Store()
    const rpc = client(() => ({
      templates: [{ id: 'dsh-blue-professional', name: 'Blue Professional', supportedModes: ['ppt'] }],
      presentationMode: 'ppt',
      selectedTemplateId: 'dsh-blue-professional'
    }))
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state'])
    expect(mode.snapshot('session-a').selectedId).toBe('dsh-blue-professional')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    const again = rpc.calls.length
    await mode.adopt('session-a', rpc)
    expect(rpc.calls).toHaveLength(again)
  })

  it('refreshes a remote selection after an empty read', async () => {
    const mode = new Store()
    let selected = null
    const rpc = client(() => ({
      templates: [{ id: 'dsh-blue-professional', supportedModes: ['ppt'] }],
      presentationMode: selected === null ? null : 'ppt',
      selectedTemplateId: selected
    }))
    await mode.readRemote('session-a', rpc)
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    selected = 'dsh-blue-professional'
    await mode.readRemote('session-a', rpc, true)
    expect(mode.snapshot('session-a').selectedId).toBe('dsh-blue-professional')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
  })

  it('does not write when the staged choice was cancelled', async () => {
    const mode = new Store()
    const rpc = client(() => ({ templates: [], presentationMode: null }))
    mode.setMode(undefined, 'ppt')
    mode.setMode(undefined, null)
    await mode.adopt('session-a', rpc)
    expect(rpc.calls).toEqual([])
    expect(mode.snapshot(undefined).activeMode).toBeNull()
  })

  it('keeps an occupied session and discards the staged choice', async () => {
    const mode = new Store()
    const rpc = client(endpoint => {
      if (endpoint === 'state') return { templates: [{ id: 'existing' }], presentationMode: 'ppt', selectedTemplateId: 'existing' }
      throw new Error(endpoint)
    })
    mode.setMode(undefined, 'ppt')
    mode.select(undefined, { id: 'staged' }, 'ppt')
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state'])
    expect(mode.snapshot('session-a').selectedId).toBe('existing')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    expect(mode.snapshot(undefined).activeMode).toBeNull()
  })

  it('does not copy a Word or Excel id into the PPT field', async () => {
    const mode = new Store()
    const rpc = client(endpoint => {
      if (endpoint === 'state') return {
        templates: [{ id: 'built-in-a', supportedModes: ['ppt'] }, { id: 'coffee-market', supportedModes: ['word'] }],
        documentMode: 'word',
        selectedTemplateId: 'coffee-market',
        selectedDocumentTemplate: { id: 'coffee-market', mode: 'word', revision: 'b'.repeat(24) }
      }
      throw new Error(endpoint)
    })
    mode.setMode(undefined, 'ppt')
    mode.select(undefined, { id: 'built-in-a', supportedModes: ['ppt'] }, 'ppt')
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state'])
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    expect(mode.snapshot('session-a').activeMode).toBeNull()
  })

  it('does not write an Office catalog id when adopting a staged PPT choice', async () => {
    const mode = new Store()
    const rpc = client(endpoint => {
      if (endpoint === 'state') return { templates: [], presentationMode: null, selectedTemplateId: null }
      if (endpoint === 'presentation/mode') return { presentationMode: 'ppt', selectedTemplateId: null }
      throw new Error(endpoint)
    })
    mode.update(undefined, current => ({
      ...current,
      activeMode: 'ppt',
      engaged: true,
      selectedId: 'coffee-market',
      templates: [{ id: 'coffee-market', supportedModes: ['word'] }]
    }))
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state', 'presentation/mode'])
    expect(rpc.calls.some(call => call.endpoint === 'template/select')).toBe(false)
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
  })

  it('keeps a verified PPT id when a later response names another catalog', () => {
    const mode = new Store()
    const client = { bound: true }
    const request = { client, sessionId: 'session-a' }
    mode.select('session-a', { id: 'built-in-a', supportedModes: ['ppt'] }, 'ppt')
    const seenRevision = mode.revision('session-a')
    const applied = mode.applyLoadedTemplates('session-a', client, seenRevision, {
      templates: [{ id: 'built-in-a', supportedModes: ['ppt'] }, { id: 'coffee-market', supportedModes: ['word'] }],
      presentationMode: 'ppt',
      selectedTemplateId: 'coffee-market'
    }, request)
    expect(applied).toBe(true)
    expect(mode.snapshot('session-a').selectedId).toBe('built-in-a')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    mode.applyLoadedTemplates('session-a', client, mode.revision('session-a'), {
      templates: [{ id: 'built-in-a', supportedModes: ['ppt'] }],
      documentMode: 'word',
      selectedTemplateId: 'coffee-market'
    }, request)
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    expect(mode.snapshot('session-a').activeMode).toBeNull()
  })

  it('keeps PPT mode and surfaces an error when the staged template cannot be selected', async () => {
    const mode = new Store()
    const rpc = client(endpoint => {
      if (endpoint === 'template/select') throw new Error('template missing')
      if (endpoint === 'state') return { templates: [], presentationMode: null }
      return { presentationMode: 'ppt' }
    })
    mode.select(undefined, { id: 'missing' }, 'ppt')
    await mode.adopt('session-a', rpc)
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state', 'template/select', 'presentation/mode'])
    const next = mode.snapshot('session-a')
    expect(next.activeMode).toBe('ppt')
    expect(next.selectedId).toBeNull()
    expect(next.error).toContain('template missing')
  })

  it('keeps a staged template selected when an older catalog response arrives after migration', async () => {
    const mode = new Store()
    mode.select(undefined, { id: 'built-in-a' }, 'ppt')
    const seenRevision = mode.revision('session-a')
    let selected = null
    let releaseState
    let heldState = new Promise(resolve => {
      releaseState = () => resolve({ templates: [{ id: 'built-in-a' }], presentationMode: null, selectedTemplateId: null })
    })
    const rpc = {
      calls: [],
      bound: true,
      call(endpoint, payload) {
        this.calls.push({ endpoint, payload })
        if (endpoint === 'state' && heldState) {
          const pending = heldState
          heldState = null
          return pending
        }
        if (endpoint === 'template/select') {
          selected = payload.templateId
          return Promise.resolve({})
        }
        return Promise.resolve({
          templates: [{ id: 'built-in-a' }],
          presentationMode: selected === null ? null : 'ppt',
          selectedTemplateId: selected
        })
      }
    }
    const migration = mode.adopt('session-a', rpc)
    expect(mode.revision('session-a')).toBeGreaterThan(seenRevision)
    releaseState()
    await migration
    let deselected = 0
    const deselect = mode.deselect.bind(mode)
    mode.deselect = (...args) => {
      deselected += 1
      return deselect(...args)
    }
    const applied = mode.applyLoadedTemplates('session-a', rpc, seenRevision, {
      templates: [{ id: 'late-catalog' }],
      presentationMode: null,
      selectedTemplateId: null
    }, { client: rpc, sessionId: 'session-a' })
    expect(applied).toBe(false)
    expect(deselected).toBe(0)
    expect(mode.snapshot('session-a').selectedId).toBe('built-in-a')
    expect(mode.snapshot('session-a').templates.some(template => template.id === 'late-catalog')).toBe(false)
    expect(mode.snapshot('session-a').mutationRevision).toBeUndefined()
  })

  it('does not let an unbound catalog response write a session that has since bound', () => {
    const mode = new Store()
    mode.select(undefined, { id: 'built-in-a' }, 'ppt')
    const unbound = { bound: false }
    const bound = { bound: true }
    mode.bump('session-a')
    const seenRevision = mode.revision('session-a')
    const applied = mode.applyLoadedTemplates('session-a', bound, seenRevision, {
      templates: [{ id: 'late-catalog' }],
      presentationMode: null,
      selectedTemplateId: null
    }, { client: unbound, sessionId: undefined })
    expect(applied).toBe(false)
    expect(mode.snapshot('session-a').templates).toEqual([])
    expect(mode.snapshot(undefined).selectedId).toBe('built-in-a')
  })

  it('drops a catalog response invalidated by a mode click and accepts the reload', () => {
    const mode = new Store()
    const client = { bound: false }
    const request = { client, sessionId: undefined }
    mode.setLoading(undefined, true)
    const seenRevision = mode.revision(undefined)
    mode.setMode(undefined, 'ppt')
    const stale = mode.applyLoadedTemplates(undefined, client, seenRevision, {
      templates: [{ id: 'late-catalog', supportedModes: ['ppt'] }],
      presentationMode: null,
      selectedTemplateId: null
    }, request)
    expect(stale).toBe(false)
    expect(mode.snapshot(undefined).templates).toEqual([])
    expect(mode.snapshot(undefined).loading).toBe(true)
    const reloaded = mode.applyLoadedTemplates(undefined, client, mode.revision(undefined), {
      templates: [{ id: 'built-in-a', supportedModes: ['ppt'] }],
      presentationMode: null,
      selectedTemplateId: null
    }, request)
    expect(reloaded).toBe(true)
    expect(mode.snapshot(undefined).templates.map(template => template.id)).toEqual(['built-in-a'])
    expect(mode.snapshot(undefined).loading).toBe(false)
    expect(mode.snapshot(undefined).activeMode).toBe('ppt')
  })

  it('reloads the catalog when the mode revision changes and does not stop because loading is true', () => {
    // The opening-template card has its own catalog effect; compare the chooser's.
    const chooser = source => source.slice(source.indexOf('function OfficePptChooser('))
    const effect = slice(chooser(adapter), 'const catalogRevision = mode.revision(sessionId);', 'const deselect = () =>')
    expect(effect).toContain('if (!loadTemplates || state.templates.length > 0 || state.error !== "") return;')
    expect(effect).not.toContain('state.loading ||')
    expect(effect).toContain('catalogRevision,')
    expect(slice(chooser(core), 'const catalogRevision = mode.revision(sessionId);', 'const deselect = () =>')).toBe(effect)
  })

  it('leaves the revision unchanged for loading and error updates', () => {
    const mode = new Store()
    const before = mode.revision('session-a')
    mode.setLoading('session-a', true)
    mode.setError('session-a', 'try again')
    expect(mode.revision('session-a')).toBe(before)
    mode.setMode('session-a', 'ppt')
    expect(mode.revision('session-a')).toBe(before + 1)
  })

  it('routes an unbound catalog read without a session id and refuses writes', async () => {
    const calls = []
    const rpc = { async call(route, endpoint, payload) { calls.push({ route, endpoint, payload }); return { ok: true, value: { status: 'ok', data: { templates: [{ id: 'built-in-a', origin: 'built-in' }] } } } } }
    const unbound = createOfficePptClient(rpc, undefined)
    expect(unbound.bound).toBe(false)
    await expect(unbound.call('presentation/mode', { mode: 'ppt' })).rejects.toThrow('PPT session is not ready')
    const state = await unbound.call('state')
    expect(state.templates).toEqual([{ id: 'built-in-a', origin: 'built-in' }])
    expect(state.selectedTemplateId).toBeNull()
    expect(calls).toEqual([{ route: '/dsh-ppt', endpoint: 'template/catalog', payload: {} }])
  })
})

describe.each(stores.map((Store, index) => [index === 0 ? 'adapter' : 'core', Store]))('%s remote PPT hydration', (_name, Store) => {
  const remote = {
    templates: [{ id: 'remote-a' }, { id: 'local-b' }],
    presentationMode: 'ppt',
    selectedTemplateId: 'remote-a'
  }

  it.each(['chooser-first', 'adoption-first'])('shares initialization across both UI paths (%s)', async order => {
    const mode = new Store()
    const held = deferred()
    const rpc = client(() => held.promise)
    const chooser = () => mode.loadTemplates('session-a', rpc)
    const adoption = () => mode.adopt('session-a', rpc)
    const first = order === 'chooser-first' ? chooser() : adoption()
    const second = order === 'chooser-first' ? adoption() : chooser()
    // There is no independent A response left that can overwrite this B response.
    expect(rpc.calls).toHaveLength(1)
    held.resolve({ ...remote, selectedTemplateId: 'local-b' })
    await Promise.all([first, second])
    expect(mode.snapshot('session-a').selectedId).toBe('local-b')
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    expect(mode.revision('session-a')).toBe(0)
    expect(mode.adopted.has('session-a')).toBe(true)
    expect(mode.remoteReady.has('session-a')).toBe(true)
    await mode.loadTemplates('session-a', rpc)
    await mode.adopt('session-a', rpc)
    expect(rpc.calls).toHaveLength(1)
  })

  it.each(['chooser-first', 'adoption-first'])('rejects an older shared result after a fresh forced read (%s)', async order => {
    const mode = new Store()
    const old = deferred()
    const fresh = deferred()
    const rpc = client(() => rpc.calls.length === 1 ? old.promise : fresh.promise)
    const first = order === 'chooser-first' ? mode.loadTemplates('session-a', rpc) : mode.adopt('session-a', rpc)
    const joined = order === 'chooser-first' ? mode.adopt('session-a', rpc) : mode.loadTemplates('session-a', rpc)
    const forced = mode.readRemote('session-a', rpc, true)
    fresh.resolve({ ...remote, selectedTemplateId: 'local-b' })
    await forced
    old.resolve(remote)
    await expect(first).resolves.toBe(order === 'chooser-first' ? 'ready' : 'stale')
    await expect(joined).resolves.toBe(order === 'chooser-first' ? 'stale' : 'ready')
    expect(mode.snapshot('session-a').selectedId).toBe('local-b')
    expect(mode.remoteReady.has('session-a')).toBe(true)
    await mode.loadTemplates('session-a', rpc)
    expect(rpc.calls).toHaveLength(2)
  })

  it('shares staged adoption with a chooser mounted first', async () => {
    const mode = new Store()
    const held = deferred()
    let selected = null
    const rpc = client((endpoint, payload) => {
      if (endpoint === 'state' && rpc.calls.length === 1) return held.promise
      if (endpoint === 'template/select') selected = payload.templateId
      return { ...remote, selectedTemplateId: selected, presentationMode: selected ? 'ppt' : null }
    })
    mode.select(undefined, remote.templates[1], 'ppt')
    const chooser = mode.loadTemplates('session-a', rpc)
    const adoption = mode.adopt('session-a', rpc)
    held.resolve({ ...remote, presentationMode: null, selectedTemplateId: null })
    await Promise.all([chooser, adoption])
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state', 'template/select', 'state'])
    expect(mode.snapshot('session-a').selectedId).toBe('local-b')
  })

  it('caches an empty catalog without changing revision and refreshes after a local mode action', async () => {
    const mode = new Store()
    const rpc = client(() => ({ templates: [], presentationMode: null, selectedTemplateId: null }))
    await mode.loadTemplates('session-a', rpc)
    await mode.loadTemplates('session-a', rpc)
    expect(rpc.calls).toHaveLength(1)
    expect(mode.revision('session-a')).toBe(0)
    mode.setMode('session-a', 'ppt')
    await mode.loadTemplates('session-a', rpc)
    expect(rpc.calls).toHaveLength(2)
    expect(mode.revision('session-a')).toBe(1)
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    expect(mode.snapshot('session-a').loading).toBe(false)
  })

  it.each(['mode', 'deselect'])('reloads a shared catalog invalidated by local %s without losing the local intent', async action => {
    const mode = new Store()
    const old = deferred()
    const rpc = client(() => rpc.calls.length === 1 ? old.promise : { templates: [], presentationMode: null, selectedTemplateId: null })
    const initial = mode.loadTemplates('session-a', rpc)
    if (action === 'mode') mode.setMode('session-a', 'ppt')
    else mode.deselect('session-a', 'ppt')
    const reload = mode.loadTemplates('session-a', rpc)
    old.resolve(remote)
    await Promise.all([initial, reload])
    expect(rpc.calls).toHaveLength(2)
    expect(mode.snapshot('session-a').templates).toEqual([])
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    expect(mode.snapshot('session-a').activeMode).toBe('ppt')
    expect(mode.snapshot('session-a').loading).toBe(false)
    expect(mode.remoteReadyRevision.get('session-a')).toBe(mode.revision('session-a'))
  })

  it('retries failed shared chooser initialization and respects an active Office mode', async () => {
    const mode = new Store()
    const rpc = client(() => {
      if (rpc.calls.length === 1) throw new Error('temporary state failure')
      return { ...remote, documentMode: 'word', selectedTemplateId: 'document-template' }
    })
    await expect(mode.loadTemplates('session-a', rpc)).resolves.toBe('failed')
    expect(mode.remoteReady.has('session-a')).toBe(false)
    expect(mode.snapshot('session-a').error).toBe('temporary state failure')
    mode.setMode('session-a', 'ppt')
    await expect(mode.loadTemplates('session-a', rpc)).resolves.toBe('applied')
    expect(mode.snapshot('session-a').activeMode).toBeNull()
    expect(mode.snapshot('session-a').selectedId).toBeNull()
    expect(mode.snapshot('session-a').error).toBe('')
    expect(mode.snapshot('session-a').loading).toBe(false)
  })

  it('times out a stalled hydration, surfaces the error and permits a fresh adoption', async () => {
    vi.useFakeTimers()
    const mode = new Store()
    const held = deferred()
    const signals = []
    const rpc = {
      bound: true,
      call(endpoint, payload, signal) {
        expect(endpoint).toBe('state')
        expect(payload).toEqual({})
        signals.push(signal)
        return signals.length === 1 ? held.promise : Promise.resolve(remote)
      }
    }
    const initial = mode.adopt('session-a', rpc, '模板加载超时，请重试')
    expect(mode.adopt('session-a', rpc)).toBe(initial)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    await vi.advanceTimersByTimeAsync(7_999)
    expect(mode.inflight.get('session-a')).toBe(initial)
    expect(signals[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(initial).resolves.toBe('failed')
    expect(signals[0].aborted).toBe(true)
    expect(mode.snapshot('session-a').error).toBe('模板加载超时，请重试')
    expect(mode.inflight.has('session-a')).toBe(false)
    expect(mode.remoteInflight.has('session-a')).toBe(false)
    expect(mode.adopted.has('session-a')).toBe(false)
    expect(mode.remoteReady.has('session-a')).toBe(false)

    await expect(mode.adopt('session-a', rpc)).resolves.toBe('applied')
    expect(signals).toHaveLength(2)
    expect(mode.snapshot('session-a').selectedId).toBe('remote-a')
    expect(mode.snapshot('session-a').error).toBe('')
    // A transport ignoring abort must not replace the successful retry with stale data.
    held.resolve({ ...remote, selectedTemplateId: 'local-b' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mode.snapshot('session-a').selectedId).toBe('remote-a')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['select', 'mode', 'deselect'])('ignores late success after a local %s and permits recovery', async action => {
    const mode = new Store()
    const held = deferred()
    const rpc = client(() => held.promise)
    const initial = mode.adopt('session-a', rpc)
    // The chooser can finish its independent catalog read before initialization.
    mode.setTemplates('session-a', remote.templates)
    if (action === 'select') mode.select('session-a', remote.templates[1], 'ppt')
    if (action === 'mode') mode.setMode('session-a', null)
    if (action === 'deselect') mode.deselect('session-a', 'ppt')
    const local = mode.snapshot('session-a')
    held.resolve(remote)
    await expect(initial).resolves.toBe('stale')
    expect(mode.snapshot('session-a')).toBe(local)
    expect(mode.adopted.has('session-a')).toBe(false)
    expect(mode.remoteReady.has('session-a')).toBe(false)
    rpc.call = async () => remote
    await expect(mode.adopt('session-a', rpc)).resolves.toBe('applied')
    expect(mode.snapshot('session-a').selectedId).toBe('remote-a')
  })

  it.each(['select', 'mode', 'deselect'])('ignores late failure after a local %s and permits recovery', async action => {
    const mode = new Store()
    const held = deferred()
    const rpc = client(() => held.promise)
    const initial = mode.readRemote('session-a', rpc)
    if (action === 'select') mode.select('session-a', remote.templates[1], 'ppt')
    if (action === 'mode') mode.setMode('session-a', 'ppt')
    if (action === 'deselect') mode.deselect('session-a', 'ppt')
    const local = mode.snapshot('session-a')
    held.reject(new Error('late initialization failure'))
    await expect(initial).resolves.toBe('stale')
    expect(mode.snapshot('session-a')).toBe(local)
    expect(mode.adopted.has('session-a')).toBe(false)
    expect(mode.remoteReady.has('session-a')).toBe(false)
    rpc.call = async () => remote
    await expect(mode.adopt('session-a', rpc)).resolves.toBe('applied')
  })

  it.each(['success', 'failure'])('starts a fresh forced read and deduplicates it while an old %s settles', async outcome => {
    const mode = new Store()
    const old = deferred()
    const fresh = deferred()
    const rpc = client(() => rpc.calls.length === 1 ? old.promise : fresh.promise)
    const initial = mode.readRemote('session-a', rpc)
    expect(mode.readRemote('session-a', rpc)).toBe(initial)
    const forced = mode.readRemote('session-a', rpc, true)
    expect(forced).not.toBe(initial)
    expect(rpc.calls).toHaveLength(2)
    expect(mode.readRemote('session-a', rpc)).toBe(forced)
    if (outcome === 'success') old.resolve(remote)
    else old.reject(new Error('superseded failure'))
    await expect(initial).resolves.toBe('stale')
    expect(mode.readRemote('session-a', rpc)).toBe(forced)
    expect(mode.adopted.has('session-a')).toBe(false)
    expect(mode.remoteReady.has('session-a')).toBe(false)
    fresh.resolve({ ...remote, selectedTemplateId: 'local-b' })
    await expect(forced).resolves.toBe('applied')
    expect(mode.snapshot('session-a').selectedId).toBe('local-b')
    expect(mode.inflight.has('session-a')).toBe(false)
    expect(mode.remoteInflight.has('session-a')).toBe(false)
    await expect(mode.readRemote('session-a', rpc)).resolves.toBe('ready')
    expect(rpc.calls).toHaveLength(2)
  })

  it('does not interrupt staged adoption with a forced read', async () => {
    const mode = new Store()
    const held = deferred()
    let selected = null
    const rpc = client((endpoint, payload) => {
      if (endpoint === 'state' && rpc.calls.length === 1) return held.promise
      if (endpoint === 'template/select') selected = payload.templateId
      return { ...remote, selectedTemplateId: selected, presentationMode: selected ? 'ppt' : null }
    })
    mode.select(undefined, remote.templates[1], 'ppt')
    const migration = mode.adopt('session-a', rpc)
    expect(mode.readRemote('session-a', rpc, true)).toBe(migration)
    expect(rpc.calls).toHaveLength(1)
    held.resolve({ ...remote, presentationMode: null, selectedTemplateId: null })
    await expect(migration).resolves.toBe('applied')
    expect(rpc.calls.map(call => call.endpoint)).toEqual(['state', 'template/select', 'state'])
    expect(mode.snapshot('session-a').selectedId).toBe('local-b')
    expect(mode.snapshot(undefined).selectedId).toBeNull()
  })
})

describe('PPT hero and session dock routing', () => {
  it('mounts only the hero dock without a session and only the shared dock with input', async () => {
    const runtime = await readFile(path.resolve('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), 'utf8')
    const expression = /children: \[([^\n]+), activity \?/.exec(runtime)?.[1]
    expect(expression).toBeDefined()
    const render = new Function('sessionId', 'input', 'extensionZone', 'renderSlot', `return ${expression}`)
    const zone = { marker: 'owner' }
    const calls = []
    const renderSlot = (name, owner) => { calls.push({ name, owner }); return name }
    const heroExpression = /sessionId === void 0 \? renderSlot\("conversation.hero.dock", zone \?\? \{\}\) : null/.exec(runtime)?.[0]
    expect(heroExpression).toBeDefined()
    const hero = new Function('sessionId', 'zone', 'renderSlot', `return ${heroExpression}`)
    expect(hero(undefined, zone, renderSlot)).toBe('conversation.hero.dock')
    expect(render(undefined, undefined, zone, renderSlot)).toBeNull()
    expect(hero('session-a', zone, renderSlot)).toBeNull()
    expect(render('session-a', {}, zone, renderSlot)).toBe('conversation.composer.dock')
    expect(render('session-a', undefined, zone, renderSlot)).toBeNull()
    expect(calls).toEqual([
      { name: 'conversation.hero.dock', owner: zone },
      { name: 'conversation.composer.dock', owner: zone }
    ])
  })

  it('registers the same chooser and shared mode store for both mutually exclusive docks', () => {
    const registered = new Map()
    const dock = () => null
    const mode = new Store()
    const injectHero = sessionId => ({ mode, sessionId })
    const openingCard = () => null
    const apply = new Function('officePptHeroInjection', 'OfficePptStandardModeAction', 'OfficePptStandardInputAccessory', 'OfficePptOpeningTemplateCard', 'OfficePptStandardComposerDock', 'NS',
      `${slice(adapter, 'function applyStandard(ctx)', '//#endregion')}\nreturn applyStandard;`
    )(() => injectHero, () => null, () => null, openingCard, dock, 'dsh-ppt')
    apply({ slots: { inject: (_name, register) => register(), register: (config, component) => registered.set(config.name, { config, component }) } })
    for (const name of ['conversation.hero.dock', 'conversation.composer.dock']) {
      expect(registered.get(name).component).toBe(dock)
      expect(registered.get(name).config.inject(undefined).mode).toBe(mode)
    }
    expect(registered.get('conversation.chat.userMessageFooter').component).toBe(openingCard)
    expect(registered.get('conversation.chat.userMessageFooter').config.inject(undefined).mode).toBe(mode)
    mode.setMode(undefined, 'ppt')
    expect(registered.get('conversation.hero.modeActions').config.inject(undefined).mode).toBe(mode)
  })
})

describe('PPT panel geometry', () => {
  it('uses the composer width instead of the shrink-wrapped dock width and clamps to the viewport', () => {
    const values = new Map()
    const source = slice(adapter, 'const syncGeometry = () => {', 'const resizeObserver =')
    const sync = new Function('root', 'scrollBody', 'composerCard', 'panel', 'TEMPLATE_PANEL_MIN_HEIGHT_PX', 'TEMPLATE_DOCK_BOTTOM_PX', `${source}\nreturn syncGeometry;`)(
      { style: { setProperty: (name, value) => values.set(name, value) } },
      { getBoundingClientRect: () => ({ width: 720, bottom: 900 }) },
      { getBoundingClientRect: () => ({ width: 900 }) },
      { getBoundingClientRect: () => ({ top: 500, width: 32 }) },
      120, 16
    )
    sync()
    expect(values.get('--office-ppt-template-panel-width')).toBe('720px')
    expect(values.get('--office-ppt-template-panel-height')).toBe('384px')
  })
})
