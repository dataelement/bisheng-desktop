import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Office owns its fallback state, never the PPT officeModes provider or its files. */
/** @returns {import('../index.js').OfficeModes} */
export function createWebOfficeModes(root, getPptModes) {
  if (typeof root !== 'string' || !isAbsolute(root) || typeof getPptModes !== 'function') throw new Error('Office modes require an absolute state root and provider lookup')
  const tails = new Map()
  const providers = new Map()
  const key = id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 512) throw new Error('Choose an active session')
    return createHash('sha256').update(id).digest('hex')
  }
  const file = id => join(root, key(id) + '.json')
  const read = async id => {
    try { return JSON.parse(await readFile(file(id), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }
  const signature = state => createHash('sha256').update(JSON.stringify([state.documentMode, state.selectedDocumentTemplate, state.presentationMode, state.selectedTemplateId, state.activities])).digest('hex')
  const visible = ({ _handoff, ...state }) => state
  const save = async (id, state, handoff = state._handoff) => {
    const snapshot = { documentMode: state.documentMode, selectedDocumentTemplate: state.selectedDocumentTemplate, _handoff: handoff }
    await mkdir(root, { recursive: true, mode: 0o700 })
    const target = file(id), temporary = target + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
    return snapshot
  }
  const serial = (id, run) => {
    key(id)
    const result = (tails.get(id) ?? Promise.resolve()).catch(() => {}).then(run)
    tails.set(id, result)
    result.finally(() => { if (tails.get(id) === result) tails.delete(id) }).catch(() => {})
    return result
  }
  const active = async id => {
    const ppt = getPptModes()
    if (!ppt) {
      const previous = providers.get(id)
      if (previous) {
        // PPT's public state method reads its persistent store and remains usable after
        // Cordis removes the service. Read once at handoff to include external PPT RPC writes.
        const last = await previous.state(id)
        await save(id, last, { baseline: signature(last), dirty: false })
        providers.delete(id)
      }
      return { state: await read(id) }
    }
    let state = await ppt.state(id)
    if (providers.get(id) !== ppt) {
      const saved = await read(id)
      const unchangedDelegate = saved._handoff?.dirty && saved._handoff.baseline === signature(state)
      const firstSelection = !saved._handoff && !state.presentationMode && !state.documentMode && !state.activities?.length && saved.documentMode
      if (unchangedDelegate || firstSelection) {
        await ppt.select(id, saved.documentMode ?? null)
        if (saved.selectedDocumentTemplate) await ppt.selectTemplate(id, saved.selectedDocumentTemplate)
        state = await ppt.state(id)
      }
      providers.set(id, ppt)
    }
    await save(id, state, { baseline: signature(state), dirty: false })
    return { ppt, state }
  }
  const change = (id, method, args, mutate) => serial(id, async () => {
    const { ppt, state } = await active(id)
    if (ppt) {
      const result = await ppt[method](id, ...args)
      const latest = await ppt.state(id)
      await save(id, latest, { baseline: signature(latest), dirty: false })
      return result
    }
    await save(id, mutate(state), state._handoff ? { ...state._handoff, dirty: true } : undefined)
    return true
  })
  return {
    state: id => serial(id, async () => visible((await active(id)).state)),
    select(id, mode) {
      if (![null, 'word', 'excel'].includes(mode)) throw new Error('Choose Word, Excel or ordinary conversation')
      return change(id, 'select', [mode], () => mode === null ? {} : { documentMode: mode })
    },
    selectTemplate(id, template) {
      if (!template || !['word', 'excel'].includes(template.mode) || typeof template.id !== 'string' || typeof template.revision !== 'string' || !/^[a-z0-9-]{1,96}$/.test(template.id) || !/^[a-zA-Z0-9.-]{1,96}$/.test(template.revision)) throw new Error('Choose a versioned Office template')
      return change(id, 'selectTemplate', [template], state => {
        if (state.documentMode !== template.mode) throw new Error('Choose the matching document format')
        return { ...state, selectedDocumentTemplate: { id: template.id, mode: template.mode, revision: template.revision } }
      })
    },
    deselectTemplate: id => change(id, 'deselectTemplate', [], state => ({ documentMode: state.documentMode })),
    record: (id, operation, facts) => serial(id, async () => {
      const { ppt } = await active(id)
      if (ppt) return ppt.record(id, operation, facts)
      await mkdir(root, { recursive: true, mode: 0o700 })
      // Per-session audit files avoid a global queue and preserve plugin disposal independence.
      const { appendFile } = await import('node:fs/promises')
      await appendFile(join(root, key(id) + '.ndjson'), JSON.stringify({ operation, facts }) + '\n', { mode: 0o600 })
      return true
    })
  }
}
