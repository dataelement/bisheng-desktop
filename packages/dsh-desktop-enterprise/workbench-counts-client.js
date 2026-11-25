/** Account-owned counts are separate from the host's native installation/favorite counts. */
export function createCollectionCounts(request) {
  let snapshot = { favorites: null, installed: null }, generation = 0, controller, disposed = false
  const listeners = new Set()
  const publish = value => { snapshot = value; for (const listener of listeners) listener() }
  const refresh = async ({ reset = false } = {}) => {
    const ticket = ++generation
    controller?.abort()
    controller = new AbortController()
    if (reset) publish({ favorites: null, installed: null })
    try {
      const [favorites, cloud] = await Promise.all([
        request('/api/enterprise.workbenches/favorites', undefined, controller.signal),
        request('/api/enterprise.workbenches/cloud', { operation: 'state' }, controller.signal)
      ])
      if (disposed || ticket !== generation) return
      if (favorites.accountKey !== cloud.connectionKey || !Array.isArray(favorites.items)) throw Object.assign(new Error('Workbench count identity mismatch.'), { status: 409 })
      const state = cloud.state || {}
      const installed = new Set((state.added || []).filter(id => state.cloudWorkbenches?.[id])).size
      publish({ favorites: favorites.items.length, installed })
    } catch (error) {
      if (disposed || ticket !== generation || controller.signal.aborted) return
      if (error.status === 401) { publish({ favorites: 0, installed: 0 }); return }
      if (error.status === 409) publish({ favorites: null, installed: null })
      console.warn('[enterprise-workbench] Counts unavailable', error)
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    refresh,
    dispose() { disposed = true; generation++; controller?.abort(); listeners.clear() }
  }
}
