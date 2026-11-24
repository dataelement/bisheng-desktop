/** Cloud pages never execute in the Harness document or receive the host bridge. */
export async function readCloudCatalog(request, signal) {
  const items = new Map(), seen = new Set()
  let cursor, key
  for (let page = 0; page < 100; page++) {
    const result = await request('/api/enterprise.workbenches/cloud', { operation: 'list', ...(cursor ? { cursor } : {}) }, signal)
    if (!Array.isArray(result.items) || typeof result.connectionKey !== 'string' || (key && key !== result.connectionKey)) throw new Error('Invalid cloud catalog or account changed.')
    key = result.connectionKey
    for (const item of result.items) {
      if (typeof item.id !== 'string' || !/^[a-f0-9]{32}$/.test(item.id) || typeof item.name !== 'string') throw new Error('Invalid cloud workbench.')
      items.set(item.id, { ...item, displayName: item.name })
    }
    cursor = result.next_cursor
    if (!cursor) return { data: [...items.values()], accountKey: key }
    if (seen.has(cursor)) throw new Error('Repeated cloud catalog cursor.')
    seen.add(cursor)
  }
  throw new Error('Cloud catalog page limit exceeded.')
}
export function cloudSurface(React, t) {
  const h = React.createElement
  return function CloudSurface({ item, accountKey, close }) {
    const element = React.useRef(null)
    const [error, setError] = React.useState('')
    React.useEffect(() => {
      const bridge = window.dshDesktopEnterprise
      const owner = `cloud_${globalThis.crypto.randomUUID()}`
      let disposed = false
      const bounds = () => { const r = element.current.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      const update = () => { if (!disposed) void bridge.resizeCloudWorkbench(bounds(), owner).catch(reason => setError(reason.message)) }
      const access = bridge.onCloudAccessRequired?.(value => { if (value?.owner === owner && !disposed) setError(t('unavailable')) })
      const occlusion = () => {
        const hidden = document.visibilityState === 'hidden' || !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
        void bridge.setCloudHostOccluded(hidden).catch(reason => { if (!disposed) setError(reason.message) })
      }
      void bridge.openCloudWorkbench(item.id, bounds(), accountKey, owner).then(() => { if (disposed) return bridge.closeCloudWorkbench(owner); occlusion() }).catch(reason => { if (!disposed) setError(reason.message) })
      const observer = new ResizeObserver(update)
      observer.observe(element.current)
      const overlays = new MutationObserver(occlusion)
      overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal'] })
      document.addEventListener('visibilitychange', occlusion)
      window.addEventListener('resize', update)
      window.addEventListener('scroll', update, true)
      return () => { disposed = true; access?.(); observer.disconnect(); overlays.disconnect(); document.removeEventListener('visibilitychange', occlusion); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); void bridge.closeCloudWorkbench(owner).catch(reason => console.warn('[enterprise-cloud] Close failed', reason)) }
    }, [item.id, accountKey])
    return h('section', null, h('button', { onClick: close }, t('back')), error && h('p', { role: 'alert' }, error), h('div', { ref: element, style: { height: '65vh', minHeight: '300px', width: '100%' }, 'aria-label': item.displayName }))
  }
}

/** One unavailable source must not hide favorites from other sources. Identity changes fail closed. */
export async function readCombinedCatalog(request, accountKey, signal) {
  const results = await Promise.allSettled([
    request('/api/enterprise.workbenches/catalog', undefined, signal),
    readCloudCatalog(request, signal)
  ])
  signal?.throwIfAborted()
  const data = [], failedSources = []
  for (const [index, result] of results.entries()) {
    const kind = index === 0 ? 'enterprise' : 'cloud'
    if (result.status === 'rejected') {
      if ([401, 409].includes(result.reason?.status)) throw result.reason
      failedSources.push(kind)
      continue
    }
    if (result.value.accountKey !== accountKey) throw new Error('Enterprise account changed.')
    if (!Array.isArray(result.value.data)) throw new Error('Invalid workbench catalog.')
    data.push(...result.value.data.map(item => ({ ...item, kind })))
  }
  return { accountKey, data, failedSources }
}

/** The prototype stored only IDs; preserve unknown dates and remove it only after a durable write. */
export async function importLegacyFavorites(storage, saved, catalog, request, signal) {
  const key = `bisheng.enterprise-workbench-favorites:${saved.accountKey}`
  const raw = storage?.getItem(key)
  if (raw === null || raw === undefined) return saved
  let ids
  try { ids = JSON.parse(raw) } catch { throw new Error('Stored legacy favorites are invalid; the original value was preserved.') }
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('Stored legacy favorites are invalid; the original value was preserved.')
  const items = [...saved.items]
  for (const id of new Set(ids)) if (!items.some(item => item.kind === 'enterprise' && item.id === id)) {
    items.push({ kind: 'enterprise', id, title: catalog.find(item => item.id === id && item.kind !== 'cloud')?.displayName || id, at: 0 })
  }
  const result = items.length === saved.items.length ? saved : await request('/api/enterprise.workbenches/favorites/write', { accountKey: saved.accountKey, revision: saved.revision, items }, signal)
  signal?.throwIfAborted()
  if (result.accountKey !== saved.accountKey) throw new Error('Enterprise account changed.')
  if (storage.getItem(key) === raw) storage.removeItem(key)
  return result
}

export function mergeLegacyCloudCatalog(catalog, state) {
  const data = [...catalog.data]
  for (const [owner, record] of Object.entries(state.cloudWorkbenches || {})) {
    const position = data.findIndex(item => item.id === record.appId && (!item.kind || item.kind === 'cloud'))
    const local = { owner, added: state.added?.includes(owner) === true, active: state.active === owner, note: state.notes?.[owner] || '', sessions: Object.entries(state.sessionBindings || {}).filter(([, id]) => id === owner).map(([id]) => id), recentSession: state.recentSessions?.[owner] }
    if (position >= 0) data[position] = { ...data[position], ...local }
    else data.push({ id: record.appId, kind: 'cloud', displayName: record.title, description: record.description, unavailable: true, ...local })
  }
  return { ...catalog, data }
}

/** Track changes made through the public favorites service without taking over its membership store. */
export function watchMarketFavoriteTimes(service, request, now = Date.now, changed = () => {}) {
  let previous = new Set(service.getSnapshot().state?.favorites || [])
  let initialized = service.getSnapshot().ready !== false
  let pending = Promise.resolve(), disposed = false
  const lifetime = new AbortController()
  const unsubscribe = service.subscribe(() => {
    const snapshot = service.getSnapshot()
    const current = new Set(snapshot.state?.favorites || [])
    if (!initialized) { previous = current; initialized = snapshot.ready === true; return }
    const added = [...current].filter(id => !previous.has(id)).map(id => ({ id, title: snapshot.catalog?.find(item => (item.catalogId || item.id) === id)?.title || id, at: now() }))
    const removed = [...previous].filter(id => !current.has(id))
    previous = current
    if (!added.length && !removed.length) return
    pending = pending.then(async () => {
      if (disposed) return
      for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await request('/api/enterprise.workbenches/favorites', undefined, lifetime.signal)
        const market = { ...saved.market }
        for (const id of removed) delete market[id]
        for (const item of added) market[item.id] = { title: item.title, at: item.at }
        try {
          const result = await request('/api/enterprise.workbenches/favorites/write', { accountKey: saved.accountKey, revision: saved.revision, items: saved.items, market }, lifetime.signal)
          if (!disposed) changed(result)
          return
        } catch (error) { if (error.status !== 409 || attempt === 2) throw error }
      }
    }).catch(error => { if (!disposed) console.warn('[enterprise-favorites] Could not save favorite timestamps', error) })
  })
  return { dispose() { disposed = true; lifetime.abort(); unsubscribe() }, settled: () => pending }
}
