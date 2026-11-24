import { StateError } from './cloud-workbench-state.js'

/** Only local entrances are removed. Hosted data, notes and immutable ownership survive. */
export async function changeCloudMembership(store, input, lookup, current) {
  const identity = current()
  const check = () => { if (current() !== identity) throw new StateError('Enterprise account changed.', 409) }
  const item = input.operation === 'add' ? await lookup(input.appId) : undefined
  check()
  if (input.operation === 'add' && !item) throw new StateError('Cloud workbench is unavailable.', 404)
  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await store.read()
    check()
    const state = structuredClone(saved.state)
    const connectionKey = saved.accountKey.slice(0, 16)
    const id = `cloud:${connectionKey}:${input.appId}`
    if (input.operation === 'add') {
      state.cloudWorkbenches ||= {}
      state.cloudWorkbenches[id] = { appId: input.appId, connectionKey, title: item.name, description: item.description || '', versionId: item.version_id || null }
      if (!state.added.includes(id)) state.added.push(id)
      if (!state.pinned.includes(id)) state.pinned.push(id)
    } else {
      if (!state.cloudWorkbenches?.[id]) throw new StateError('Cloud workbench was not added.', 404)
      if (input.operation === 'remove') {
        state.added = state.added.filter(value => value !== id)
        state.pinned = state.pinned.filter(value => value !== id)
        if (state.active === id) state.active = null
      } else if (input.operation === 'note') state.notes[id] = input.note
      else {
        if (!state.added.includes(id)) throw new StateError('Add the cloud workbench first.', 409)
        if (input.operation === 'activate') state.active = id
        else if (input.operation === 'bind') {
          const owner = state.sessionBindings[input.sessionId]
          if (owner && owner !== id) throw new StateError('Session already belongs to another workbench.', 409)
          state.sessionBindings[input.sessionId] = id
          state.recentSessions[id] = input.sessionId
        } else throw new StateError('Unsupported cloud mutation.')
      }
    }
    check()
    try { return await store.write({ ...saved, state }) }
    catch (error) { if (error.status !== 409 || attempt === 2) throw error }
  }
}
