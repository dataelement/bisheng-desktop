// Keep file ownership in the installed Harness conversation service: uploads,
// retry controls and failed-submission recovery are the ordinary composer flow.
function waitForUpload(store, id, signal, message) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timer = setTimeout(() => finish(new Error(message)), 45000)
    const finish = error => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      error ? reject(error) : resolve()
    }
    const abort = () => finish(signal.reason || new Error(message))
    const check = () => {
      const upload = store.getSnapshot()[id]
      if (upload?.status === 'ready') finish()
      else if (upload?.status === 'error') finish(new Error(message))
    }
    unsubscribe = store.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else check()
  })
}

/** Start an isolated development conversation without touching an existing draft. */
export async function createWorkbenchConversation({ ctx, request, signal, current, workspaceId, activate, prompt, filename, guideUrl, errorText }) {
  const live = () => !signal.aborted && current()
  // Resolve the optional action capability when clicked. Navigation must not
  // be torn down or held pending by a composer service replacement.
  const conversation = ctx.get('conversation')
  // These public controller methods ship with the pinned Harness composer.
  // Fail before creating a session if an older runtime lacks file support.
  if (!conversation?.createDrafts || !conversation.fileUploads || !conversation.releaseDraftAttachments) throw new Error(errorText('unsupported'))
  const response = await request(guideUrl, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
  if (!response.ok) throw new Error(errorText('guideFailed'))
  const guide = await response.text()
  if (!guide.trimStart().startsWith('#') || guide.length > 512 * 1024) throw new Error(errorText('guideFailed'))
  if (!live()) return
  const sessionId = await ctx.sessions.create(workspaceId ? { workspaceId } : {})
  if (!live()) return
  await ctx.sessions.using(sessionId, { source: 'workbench-create', signal }, async reference => {
    const binding = await reference.ready
    if (!live()) return
    const input = conversation.input.for(binding.ctx)
    const snapshot = input.state.getSnapshot()
    if (snapshot.draft || snapshot.attachmentIds.length || snapshot.phase !== 'plain') throw new Error(errorText('draftChanged'))
    const drafts = conversation.createDrafts(sessionId, [new File([guide], filename, { type: 'text/markdown' })])
    if (!input.addAttachments(drafts.map(file => file.id))) {
      conversation.releaseDraftAttachments(drafts)
      throw new Error(errorText('draftChanged'))
    }
    input.setDraft(prompt)
    await activate(sessionId)
    if (!live()) return
    input.focus()
    try {
      await waitForUpload(conversation.fileUploads, drafts[0].id, signal, errorText('uploadFailed'))
    } catch (error) {
      // Keep the file and prompt in this new session, so native upload retry and
      // send recovery remain available. Never silently send without the guide.
      if (live()) input.notify('error', errorText('uploadFailed'))
      throw error
    }
    // Creation only prepares an editable draft. Sending always belongs to the
    // user, including when the template and guide upload are already ready.
  })
  return sessionId
}
