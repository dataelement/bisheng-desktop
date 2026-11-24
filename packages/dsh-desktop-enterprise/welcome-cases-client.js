const NS = 'enterprise.welcomeCases'
export const welcomeCopy = {
  zh: { title: '试试这些任务', next: '换一批', workspace: '请先选择工作区，案例会保留。', changed: '输入内容已变化，保留了你的草稿，请重新选择案例。', loading: '正在准备…', missing: '案例模板暂不可用，请先导入对应模板。', templatePrompt: '请使用「{name}」模板生成 {format} 文件。', clear: '取消选择', kept: '已选择模板；保留了你编辑的输入内容。' },
  en: { title: 'Try these tasks', next: 'More ideas', workspace: 'Select a workspace first. Your example is retained.', changed: 'Your draft changed and was preserved. Select the example again.', loading: 'Preparing…', missing: 'This example template is unavailable. Import the matching template first.', templatePrompt: 'Use the “{name}” template to generate a {format} file.', clear: 'Clear selection', kept: 'Template selected. Your edited draft was preserved.' }
}
export function welcomeBatch(catalog, index = 0) {
  const ids = catalog.batches.work[index % catalog.batches.work.length]
  return ids.map(id => catalog.work.find(item => item.id === id)).filter(Boolean)
}
/** Keep revision-bound insertion separate from asynchronous preset/template selection. */
export async function prepareWelcomeCase(ctx, item, sessionId, signal) {
  const call = async (channel, endpoint, body = {}) => {
    signal.throwIfAborted()
    if (channel === '/api' && body.endpoint !== 'catalog' && ctx.desktopOffice) {
      const { endpoint: operation, ...payload } = body
      if (!await ctx.desktopOffice.mutate(sessionId, operation, payload)) throw new Error(ctx.desktopOffice.snapshot(sessionId).error || ctx.locale.bind(NS)('changed'))
      signal.throwIfAborted()
      return ctx.desktopOffice.snapshot(sessionId)
    }
    if (channel === '/dsh-ppt' && ctx.desktopPresentation) {
      const current = ctx.desktopPresentation.snapshot(sessionId)
      const selected = item.template && current.activeMode === 'ppt' ? current.selectedId : undefined
      if (!await ctx.desktopPresentation.change(sessionId, { mode: 'ppt', ...(selected ? { templateId: selected } : {}), clearTemplate: !selected }, signal)) throw new Error(ctx.locale.bind(NS)('changed'))
      return ctx.desktopPresentation.snapshot(sessionId)
    }
    const result = await ctx.connection.rpc.call(channel, endpoint, { sessionId, ...body }, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error(result.error.message)
    if (channel === '/dsh-ppt') {
      if (result.value?.status !== 'ok') throw new Error(result.value?.error?.message || 'Invalid PPT response.')
      return result.value.data
    }
    return result.value
  }
  let template
  if (item.template && ['word', 'excel'].includes(item.officeMode)) {
    const state = await call('/api', 'office-templates', { endpoint: 'catalog' })
    template = state.templates.find(entry => entry.mode === item.officeMode && [entry.title, entry.titleEn].includes(item.template))
    if (!template) throw new Error(ctx.locale.bind(NS)('missing'))
  }
  if (item.preset) {
    const selected = await ctx.remote.agentPresets.select(sessionId, item.preset)
    signal.throwIfAborted()
    if (!selected.ok) throw new Error(selected.error.message)
  }
  if (item.officeMode === 'ppt') await call('/dsh-ppt', 'presentation/mode', { mode: 'ppt' })
  else {
    await call('/api', 'office-templates', { endpoint: 'mode', mode: item.officeMode === 'normal' ? null : item.officeMode })
    if (template) await call('/api', 'office-templates', { endpoint: 'select', templateId: template.id, revision: template.revision })
  }
}
export function caseForTemplate(template, templates, cases) {
  const matches = cases.filter(item => item.officeMode === template.mode && item.template === template.title)
  return matches.length === 1 && templates.filter(item => item.mode === template.mode && item.title === template.title).length === 1 ? matches[0] : undefined
}
export function promptSpan(input, prompt) {
  if (!prompt || typeof input?.draft !== 'string') return
  const start = input.draft.indexOf(prompt), end = start + prompt.length
  if (start < 0 || input.draft.lastIndexOf(prompt) !== start || start > 0 && input.draft[start - 1] !== '\n' || end < input.draft.length && input.draft[end] !== '\n') return
  let expansion = 0
  for (const { offset, length } of input.occurrences || []) {
    if (offset < end && offset + length > start) return
    if (offset + length <= start) expansion += length - 1
  }
  return { start: start - expansion, end: end - expansion, draftRev: input.draftRev }
}
export function templatePromptEdit(input, template, templates, cases, language = 'zh') {
  if (input?.phase !== 'plain') return
  const format = item => welcomeCopy[language].templatePrompt.replace('{name}', language === 'en' ? item.titleEn || item.title : item.title).replace('{format}', item.mode === 'word' ? 'DOCX' : 'XLSX')
  const example = caseForTemplate(template, templates, cases)
  const text = example ? language === 'en' ? example.promptEn || example.prompt : example.prompt : format(template)
  if (!input.draft && !input.occurrences?.length) return { text, span: { start: 0, end: 0, draftRev: input.draftRev } }
  const prompts = new Set(cases.flatMap(item => [item.prompt, item.promptEn]).filter(Boolean))
  for (const item of templates) for (const lang of ['zh', 'en']) prompts.add(welcomeCopy[lang].templatePrompt.replace('{name}', lang === 'en' ? item.titleEn || item.title : item.title).replace('{format}', item.mode === 'word' ? 'DOCX' : 'XLSX'))
  let edit
  for (const previous of prompts) {
    const span = promptSpan(input, previous)
    if (!span) continue
    if (edit) return
    edit = { text, span, previous }
  }
  return edit
}
export function mountWelcomeCases(React, ctx, catalog) {
  const h = React.createElement, disposers = []
  disposers.push(ctx.locale.register(NS, welcomeCopy))
  const t = ctx.locale.bind(NS)
  const selections = new Map()
  let stagedCase = null
  function WelcomeCases({ sessionId, session, input, inputActions, inputFor, composer = false }) {
    const [batch, setBatch] = React.useState(0), [pending, setPending] = React.useState(() => stagedCase)
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
    const active = React.useRef(null)
    const latest = React.useRef(null)
    latest.current = { input: inputFor?.(sessionId)?.state.getSnapshot() || input, inputActions }
    const [selected, setSelected] = React.useState(null)
    const language = t('title') === welcomeCopy.en.title ? 'en' : 'zh'
    React.useEffect(() => { setSelected(selections.get(sessionId)?.id || null) }, [sessionId])
    React.useEffect(() => {
      const store = ctx.desktopOffice
      if (!store || !sessionId) return
      let previous = store.snapshot(sessionId).selectedTemplateId
      return store.subscribe(sessionId, () => {
        const state = store.snapshot(sessionId), next = state.selectedTemplateId
        if (next === previous) return
        previous = next
        if (active.current || state.busy || !next) return
        const template = state.templates.find(item => item.id === next)
        const current = latest.current
        if (!template || !current?.inputActions) return
        const edit = templatePromptEdit(current.input, template, state.templates, catalog.work, language)
        if (edit && edit.previous !== edit.text && current.inputActions.insertText(edit.text, edit.span)) {
          current.inputActions.persistDraft()
          const example = caseForTemplate(template, state.templates, catalog.work)
          selections.set(sessionId, { id: example?.id || null, prompt: edit.text })
          setSelected(example?.id || null)
        } else if (!edit && current.input?.draft) setError(t('kept'))
      })
    }, [sessionId, language])
    const choose = async (item, clear = false) => {
      if (!sessionId || !inputActions || !input) { stagedCase = item; setPending(item); setError(t('workspace')); return }
      const currentInput = latest.current.input
      if (active.current || currentInput.phase !== 'plain') return
      const controller = new AbortController()
      active.current = controller
      const previous = selections.get(sessionId)
      const english = language === 'en', prompt = english ? item.promptEn || item.prompt : item.prompt
      const end = typeof currentInput.draft === 'string' ? currentInput.draft.length - (currentInput.occurrences || []).reduce((sum, item) => sum + item.length - 1, 0) : undefined
      const retained = promptSpan(currentInput, previous?.prompt)
      const span = clear ? retained : retained || (end === undefined ? inputActions.captureInsertion() : { start: currentInput.occurrences?.length ? end : 0, end, draftRev: currentInput.draftRev })
      if (!span) { active.current = null; setError(t('changed')); return }
      const text = clear ? '' : currentInput.occurrences?.length && !retained && end ? '\n\n' + prompt : prompt
      setBusy(true); setError('')
      try {
        if (previous?.creator && (clear || item.preset !== 'cordis')) {
          const reset = await ctx.remote.agentPresets.select(sessionId, 'standard')
          controller.signal.throwIfAborted()
          if (!reset.ok) throw new Error(reset.error.message)
        }
        await prepareWelcomeCase(ctx, clear ? { officeMode: 'normal' } : item, sessionId, controller.signal)
        if (controller.signal.aborted) return
        if (!inputActions.insertText(text, span)) setError(t('changed'))
        else { inputActions.persistDraft(); stagedCase = null; setPending(null); selections.set(sessionId, { id: clear ? null : item.id, prompt: clear ? '' : prompt, creator: !clear && item.preset === 'cordis' }); setSelected(clear ? null : item.id) }
      } catch (reason) { if (!controller.signal.aborted) setError(reason.message) }
      finally { if (active.current === controller) { active.current = null; setBusy(false) } }
    }
    React.useEffect(() => { setBusy(false); if (pending && sessionId && inputActions) { if (input?.draft || input?.attachmentIds?.length || input?.occurrences?.length) setError(t('changed')); else void choose(pending) }; return () => { active.current?.abort(); active.current = null } }, [sessionId, inputActions, pending])
    if (composer || session && !session.blank) return error ? h('p', { role: 'status' }, error) : null
    return h('section', { className: 'bishengWelcomeCases', 'aria-label': t('title') }, h('header', null, h('strong', null, t('title')), h('button', { disabled: busy, onClick: () => setBatch(value => value + 1) }, t('next'))),
      h('div', { className: 'bishengWelcomeCaseGrid', key: batch }, welcomeBatch(catalog, batch).map(item => h('button', { key: item.id, disabled: busy, 'aria-pressed': selected === item.id, onClick: () => { void choose(item, selected === item.id) } }, h('strong', null, item.title[language]), h('span', null, item.description[language])))),
      busy && h('p', { role: 'status' }, t('loading')), error && h('p', { role: 'alert' }, error))
  }
  const style = document.createElement('style')
  style.dataset.pluginCss = 'enterprise-welcome-cases'
  style.textContent = '.bishengWelcomeCases{color:var(--dsw-alias-label-primary);margin-block:16px}.bishengWelcomeCases header{display:flex;justify-content:space-between;align-items:center;margin-block:10px}.bishengWelcomeCases button{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;cursor:pointer}.bishengWelcomeCaseGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;animation:bishengCaseEnter .16s ease-out}.bishengWelcomeCaseGrid button{text-align:start;display:flex;flex-direction:column;gap:8px}.bishengWelcomeCaseGrid span{font-size:12px;color:var(--dsw-alias-label-secondary)}.bishengWelcomeCases button:disabled{opacity:.5;cursor:default}.bishengWelcomeCases button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}@keyframes bishengCaseEnter{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.bishengWelcomeCaseGrid{animation:none}}'
  document.head.append(style)
  disposers.push(() => style.remove())
  disposers.push(ctx.slots.inject('conversation.hero.dock', () => ctx.slots.register({ name: 'conversation.hero.dock', id: NS, order: 20, locale: NS }, WelcomeCases)))
  disposers.push(ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: NS, order: 20, locale: NS }, props => h(WelcomeCases, { ...props, composer: true }))))
  return () => { for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose() }
}
