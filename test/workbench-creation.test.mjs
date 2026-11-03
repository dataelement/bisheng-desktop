import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchConversation } from '../packages/dsh-desktop-workbenches/create-workbench.mjs'

function setup() {
  const listeners = new Set()
  const uploads = {}
  const state = { draft: '', attachmentIds: [], phase: 'plain' }
  const input = {
    state: { getSnapshot: () => state },
    setDraft: vi.fn(text => { state.draft = text }),
    addAttachments: vi.fn(ids => { state.attachmentIds.push(...ids); return true }),
    focus: vi.fn(), submit: vi.fn(), notify: vi.fn()
  }
  let file
  const ctx = {
    conversation: {
      input: { for: vi.fn(() => input) },
      createDrafts: vi.fn((_id, files) => { file = files[0]; uploads.guide = { status: 'uploading' }; return [{ id: 'guide', kind: 'file', file }] }),
      fileUploads: { getSnapshot: () => uploads, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
      releaseDraftAttachments: vi.fn()
    },
    sessions: {
      create: vi.fn(async () => 'fresh-development'),
      using: vi.fn(async (_id, _options, fn) => fn({ ready: Promise.resolve({ ctx: { sessionId: 'fresh-development' } }) }))
    }
  }
  const controller = new AbortController()
  ctx.get = vi.fn(name => name === 'conversation' ? ctx.conversation : undefined)
  const options = {
    ctx, signal: controller.signal, current: () => true, workspaceId: 'project-1',
    request: vi.fn(async () => new Response('# Workbench guide\n\nCloud, local and shared records.')),
    activate: vi.fn(), prompt: 'Read the attached guide and ask me about my idea.',
    filename: 'Workbench development guide.md', guideUrl: '/api/desktop-workbenches/development-guide-en', errorText: key => key
  }
  const upload = status => { uploads.guide = { status }; for (const fn of [...listeners]) fn() }
  const staged = async () => { await vi.waitFor(() => expect(options.activate).toHaveBeenCalledOnce()) }
  return { options, ctx, input, state, controller, listeners, upload, staged, file: () => file }
}

afterEach(() => { vi.useRealTimers() })

describe('new workbench conversation', () => {
  it('creates a fresh session with the exact Markdown file and leaves the template unsent after upload', async () => {
    const f = setup()
    const flow = createWorkbenchConversation(f.options)
    await f.staged()
    expect(f.ctx.sessions.create).toHaveBeenCalledWith({ workspaceId: 'project-1' })
    expect(f.options.activate).toHaveBeenCalledWith('fresh-development')
    expect(f.file().name).toBe('Workbench development guide.md')
    expect(f.file().type).toBe('text/markdown')
    expect(await f.file().text()).toContain('Cloud, local and shared records.')
    expect(f.state).toMatchObject({ draft: f.options.prompt, attachmentIds: ['guide'] })
    expect(f.input.submit).not.toHaveBeenCalled()
    f.upload('ready')
    expect(await flow).toBe('fresh-development')
    expect(f.input.submit).not.toHaveBeenCalled()
    expect(f.state.draft).toBe(f.options.prompt)
    expect(f.state.attachmentIds).toEqual(['guide'])
    expect(f.listeners.size).toBe(0)
  })

  it.each([new Response('unavailable', { status: 503 }), new Response('<html>Login</html>')])('does not create an empty session when the guide cannot be loaded', async response => {
    const f = setup()
    f.options.request.mockResolvedValue(response)
    await expect(createWorkbenchConversation(f.options)).rejects.toThrow('guideFailed')
    expect(f.ctx.sessions.create).not.toHaveBeenCalled()
  })

  it('does not copy an existing conversation draft or overwrite unexpected new-session content', async () => {
    const f = setup()
    f.state.draft = 'A user draft that must survive'
    await expect(createWorkbenchConversation(f.options)).rejects.toThrow('draftChanged')
    expect(f.state.draft).toBe('A user draft that must survive')
    expect(f.ctx.conversation.createDrafts).not.toHaveBeenCalled()
    expect(f.input.setDraft).not.toHaveBeenCalled()
  })

  it('keeps the prompt and failed file available for native upload retry', async () => {
    const f = setup()
    const flow = createWorkbenchConversation(f.options)
    const result = expect(flow).rejects.toThrow('uploadFailed')
    await f.staged()
    f.upload('error')
    await result
    expect(f.state).toMatchObject({ draft: f.options.prompt, attachmentIds: ['guide'] })
    expect(f.input.notify).toHaveBeenCalledWith('error', 'uploadFailed')
    expect(f.input.submit).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  })

  it('does not automatically send later user edits', async () => {
    const f = setup()
    const flow = createWorkbenchConversation(f.options)
    await f.staged()
    f.state.draft += '\nMy actual idea'
    f.upload('ready')
    await flow
    expect(f.input.submit).not.toHaveBeenCalled()
    expect(f.state.draft).toContain('My actual idea')
  })

  it('does not send after navigation and unsubscribes from the upload', async () => {
    const f = setup()
    const flow = createWorkbenchConversation(f.options)
    const result = expect(flow).rejects.toThrow()
    await f.staged()
    f.controller.abort()
    await result
    expect(f.input.submit).not.toHaveBeenCalled()
    expect(f.input.notify).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  })

  it('releases unattached files when the composer rejects attachment admission', async () => {
    const f = setup()
    f.input.addAttachments.mockReturnValue(false)
    await expect(createWorkbenchConversation(f.options)).rejects.toThrow('draftChanged')
    expect(f.ctx.conversation.releaseDraftAttachments).toHaveBeenCalledOnce()
    expect(f.options.activate).not.toHaveBeenCalled()
  })

  it('fails before creating anything on an incompatible runtime', async () => {
    const f = setup()
    delete f.ctx.conversation.createDrafts
    await expect(createWorkbenchConversation(f.options)).rejects.toThrow('unsupported')
    expect(f.options.request).not.toHaveBeenCalled()
    expect(f.ctx.sessions.create).not.toHaveBeenCalled()
  })
})
