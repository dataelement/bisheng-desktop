import { dirname, join } from 'node:path'
import { readLegacyCloudState, seedLegacyCloudState } from './legacy-cloud-state.js'
import { createHash } from 'node:crypto'
import { createStateStore } from './cloud-workbench-state.js'

// Use V1.3.1's complete state contract rather than another reduced schema.
// Account selection is enterprise-owned; the public workbench store is untouched.
export function createCloudSessionStore(root, identity = () => 'default', projectsRoot) {
  const stores = new Map()
  const adopted = new Set()
  const owner = () => createHash('sha256').update(identity()).digest('hex')
  const storeFor = key => {
    if (!stores.has(key)) stores.set(key, createStateStore(root, `cloud-sessions-${key}.json`))
    return stores.get(key)
  }
  const check = key => { if (owner() !== key) throw new Error('Enterprise account changed.') }
  return {
    async read() {
      const accountKey = owner()
      let saved = await storeFor(accountKey).read()
      if (!adopted.has(accountKey)) {
        const legacy = readLegacyCloudState(join(dirname(root), 'desktop-workbenches'), accountKey.slice(0, 16), projectsRoot)
        if (legacy && (Object.keys(legacy.cloudWorkbenches).length || Object.keys(legacy.cloudDevelopmentSessions).length)) {
          check(accountKey)
          if (saved.revision === 0) seedLegacyCloudState(root, `cloud-sessions-${accountKey}.json`, legacy)
          saved = await storeFor(accountKey).read()
          // Also upgrade stores seeded by the earlier migration. A newer resume
          // binding wins; replay never replaces it with an old project ID.
          for (let attempt = 0; attempt < 3; attempt++) {
            const missing = Object.entries(legacy.cloudDevelopmentSessions).filter(([session]) => !Object.hasOwn(saved.state.cloudDevelopmentSessions || {}, session))
            if (!missing.length) break
            check(accountKey)
            try {
              saved = await storeFor(accountKey).write({ ...saved, state: { ...saved.state, cloudDevelopmentSessions: { ...saved.state.cloudDevelopmentSessions, ...Object.fromEntries(missing) } } })
              break
            } catch (error) {
              if (error.status !== 409 || attempt === 2) throw error
              saved = await storeFor(accountKey).read()
            }
          }
        }
        adopted.add(accountKey)
      }
      check(accountKey)
      return { ...saved, accountKey, state: { cloudWorkbenches: {}, cloudDevelopmentSessions: {}, ...saved.state } }
    },
    async write(input) {
      const accountKey = owner()
      if (input?.accountKey !== accountKey) throw new Error('Enterprise account changed.')
      const saved = await storeFor(accountKey).write(input)
      check(accountKey)
      return { ...saved, accountKey }
    }
  }
}
