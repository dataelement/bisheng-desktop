import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = await readFile('packages/dsh-desktop-client-ui/client.js', 'utf8')
const implementation = source.slice(source.indexOf('function createChatProjects()'), source.indexOf('function ChatProjectDialog('))
async function fixture() {
  const data = new Map(), accounts = new Map(), imports = new Map()
  let account = 'account-a', epoch = 4, failAfterCommit = false
  const storage = { getItem: vi.fn(key => data.get(key) ?? null), setItem: vi.fn((key, value) => data.set(key, value)) }
  const cloud = () => {
    if (!accounts.has(account)) accounts.set(account, { projects: [], assignments: {}, revision: 0 })
    return accounts.get(account)
  }
  const snapshot = () => structuredClone({ epoch, phase: 'ready', connection: 'live', revision: String(cloud().revision), projects: cloud().projects, assignments: cloud().assignments, identity: { user_id: 7, tenant_id: 2 } })
  const bridge = {
    projectsState: vi.fn(async () => snapshot()),
    projectConversations: vi.fn(async input => ({ epoch, revision: String(cloud().revision), items: [{ id: 'older-chat', title: 'Old history', updatedAt: '' }], nextCursor: null })),
    projectAction: vi.fn(async (input, expectedEpoch) => {
      if (expectedEpoch !== epoch) throw new Error('identity changed')
      const state = cloud()
      let result
      {
        const outcome = {}
        if (input.operation === 'create') {
          // Client-generated id: a retried create returns the same project.
          const id = input.project_id
          if (!state.projects.some(project => project.id === id)) state.projects.push({ id, name: input.name })
          outcome.project_id = id
          if (input.chat_id) state.assignments[input.chat_id] = id
        } else if (input.operation === 'rename') state.projects = state.projects.map(project => project.id === input.project_id ? { ...project, name: input.name } : project)
        else if (input.operation === 'delete') {
          state.projects = state.projects.filter(project => project.id !== input.project_id)
          state.assignments = Object.fromEntries(Object.entries(state.assignments).filter(([, id]) => id !== input.project_id))
        } else if (input.operation === 'assign') {
          if (input.project_id) state.assignments[input.chat_id] = input.project_id
          else delete state.assignments[input.chat_id]
        } else if (input.operation === 'import') {
          outcome.items = []
          for (const project of input.projects) {
            // Deterministic per account and legacy id, like the server's uuid5.
            const entry = account + ':' + project.legacy_id
            if (imports.has(entry)) { outcome.items.push({ kind: 'project', legacy_id: project.legacy_id, status: 'already_imported' }); continue }
            const id = randomUUID(); state.projects.push({ id, name: project.name }); imports.set(entry, id)
            outcome.items.push({ kind: 'project', legacy_id: project.legacy_id, status: 'imported' })
          }
          for (const member of input.memberships) {
            const id = imports.get(account + ':' + member.legacy_project_id)
            if (id && !state.assignments[member.chat_id]) state.assignments[member.chat_id] = id
            outcome.items.push({ kind: 'membership', status: 'imported' })
          }
        }
        state.revision++
        result = { epoch, outcome }
      }
      if (failAfterCommit) { failAfterCommit = false; throw new Error('response lost') }
      return structuredClone(result)
    })
  }
  const create = vm.runInNewContext('(' + implementation.trim() + ')', { window: { localStorage: storage, dshEnterpriseChat: bridge }, crypto: { randomUUID }, setTimeout, clearTimeout })
  const store = create()
  const select = async (next, nextEpoch) => { account = next; epoch = nextEpoch; store.setScope(next, nextEpoch); await store.reload() }
  await select(account, epoch)
  return { store, data, storage, bridge, cloud, select, snapshot, failAfterCommit: () => { failAfterCommit = true } }
}
async function createProject(store, name = 'Research') {
  store.edit('create'); await store.confirm(name)
  return store.snapshot().projects.at(-1).id
}
it('uses the shared service for CRUD and never writes local project truth', async () => {
  const { store, bridge, storage, select } = await fixture()
  const id = await createProject(store)
  expect(await store.assign('cloud-a', id)).toBe(true)
  store.edit('rename', id, 'Research'); await store.confirm('Updated')
  expect(store.snapshot()).toMatchObject({ projects: [{ id, name: 'Updated' }], assignments: { 'cloud-a': id } })
  expect(storage.setItem).not.toHaveBeenCalled()
  await select('account-b', 5)
  expect(store.snapshot().projects).toEqual([])
  await select('account-a', 6)
  expect(store.snapshot().projects[0].name).toBe('Updated')
  expect(bridge.projectAction).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create', project_id: expect.any(String) }), 4)
  expect(bridge.projectAction.mock.calls[0][0]).not.toHaveProperty('request_id')
})
it('preserves input and the draft project id when a committed response is lost', async () => {
  const { store, bridge, failAfterCommit, cloud } = await fixture()
  store.edit('create')
  failAfterCommit()
  await store.confirm('Retry research')
  expect(store.snapshot()).toMatchObject({ error: 'failed', editor: { mode: 'create' }, busy: false })
  await store.confirm('Retry research')
  expect(cloud().projects).toHaveLength(1)
  expect(store.snapshot().editor).toBeNull()
  expect(bridge.projectAction.mock.calls[0][0].project_id).toBe(bridge.projectAction.mock.calls[1][0].project_id)
})
it('applies live server changes and rejects stale epochs and versions', async () => {
  const { store, cloud, snapshot } = await fixture()
  const id = await createProject(store)
  cloud().projects[0].name = 'Other client'; cloud().revision++
  store.apply(snapshot())
  expect(store.snapshot().projects[0].name).toBe('Other client')
  store.apply({ ...snapshot(), revision: '0', projects: [{ id, name: 'Old response' }] })
  store.apply({ ...snapshot(), epoch: 3, projects: [{ id, name: 'Foreign account' }] })
  expect(store.snapshot().projects[0].name).toBe('Other client')
})
it('reads project conversations independently of global history pages', async () => {
  const { store, bridge } = await fixture()
  const id = await createProject(store)
  await store.assign('older-chat', id)
  store.toggle(id)
  await store.load(id)
  expect(store.snapshot().rows[id].items[0].id).toBe('older-chat')
  expect(bridge.projectConversations).toHaveBeenCalledWith({ project_id: id }, 4)
})
it('automatically migrates scoped history, retaining legacy keys and same-name cloud projects', async () => {
  const { store, data, select, storage, bridge } = await fixture()
  await createProject(store, 'Same name')
  const original = JSON.stringify({ projects: [{ id: 'local-a', name: 'Same name' }], assignments: { 'old-chat': 'local-a' } })
  data.set('desktop.chatProjects.v1:account-a', original)
  await select('account-b', 5); await select('account-a', 6)
  await vi.waitFor(() => expect(store.snapshot().migrationPhase).toBe('done'))
  expect(store.snapshot().editor).toBeNull()
  expect(store.snapshot().projects).toHaveLength(2)
  expect(data.get('desktop.chatProjects.v1:account-a')).toBe(original)
  expect(store.snapshot().assignments['old-chat']).toBeTruthy()
  await select('account-b', 7); await select('account-a', 8)
  expect(store.snapshot().projects).toHaveLength(2)
  expect(storage.setItem).toHaveBeenCalledWith('desktop.chatProjects.importDone.v1:account-a', '1')
  expect(bridge.projectAction.mock.calls.filter(([input]) => input.operation === 'import')).toHaveLength(1)
})
it('deletes projects without deleting chats and validates before sending', async () => {
  const { store, bridge } = await fixture()
  store.edit('create'); await store.confirm(' ')
  expect(bridge.projectAction).not.toHaveBeenCalled()
  store.close()
  const id = await createProject(store)
  await store.assign('cloud-a', id)
  store.edit('remove', id); await store.confirm()
  expect(store.snapshot()).toMatchObject({ projects: [], assignments: {} })
  expect(bridge.projectAction.mock.calls.map(([input]) => input.operation)).toEqual(['create', 'assign', 'delete'])
  expect(await store.assign('../path', id)).toBe(false)
})

it('automatically retries an interrupted legacy migration without duplicate projects', async () => {
  vi.useFakeTimers()
  let store
  try {
    const f = await fixture(); store = f.store
    f.data.set('desktop.chatProjects.v1:account-a', JSON.stringify({ projects: [{ id: 'legacy', name: 'History' }], assignments: {} }))
    await f.select('account-b', 5)
    f.failAfterCommit()
    await f.select('account-a', 6)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot().migrationPhase).toBe('error')
    expect(f.cloud().projects).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.snapshot().migrationPhase).toBe('done')
    expect(f.cloud().projects).toHaveLength(1)
    expect(store.snapshot().editor).toBeNull()
  } finally { store?.dispose(); vi.useRealTimers() }
})

it('automatically retries an expanded project page after transport recovery at the same revision', async () => {
  const { store, bridge, snapshot } = await fixture()
  const id = await createProject(store)
  bridge.projectConversations.mockRejectedValueOnce(new Error('offline'))
  await store.load(id)
  expect(store.snapshot().rows[id].phase).toBe('error')
  store.apply({ ...snapshot(), connection: 'offline' })
  store.apply(snapshot())
  await vi.waitFor(() => expect(store.snapshot().rows[id].phase).toBe('ready'))
})
