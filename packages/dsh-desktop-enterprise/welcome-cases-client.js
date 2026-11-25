const NS = 'enterprise.welcomeCases'
export const welcomeCopy = {
  zh: { title: '从一个案例开始', next: '切换一批', quickUse: '使用案例', quickCreator: '创作模式', workspace: '请先选择工作区，案例会保留。', changed: '输入内容已变化，保留了你的草稿，请重新选择案例。', loading: '正在准备…', missing: '案例模板暂不可用，请先导入对应模板。', templatePrompt: '请使用「{name}」模板生成 {format} 文件。', clear: '取消选择', kept: '已选择模板；保留了你编辑的输入内容。' },
  en: { title: 'Start with an example', next: 'Try another set', quickUse: 'Use example', quickCreator: 'Creator mode', workspace: 'Select a workspace first. Your example is retained.', changed: 'Your draft changed and was preserved. Select the example again.', loading: 'Preparing…', missing: 'This example template is unavailable. Import the matching template first.', templatePrompt: 'Use the “{name}” template to generate a {format} file.', clear: 'Clear selection', kept: 'Template selected. Your edited draft was preserved.' }
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
  const iconPaths = {
    normal: 'M4 12h16m-6-6 6 6-6 6',
    word: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
    excel: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 9h18M3 15h18M9 3v18M15 3v18',
    ppt: 'M2 3h20M21 3v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-4 5 4M12 17v4',
    design: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 1 1 0 0 1 1-2h3a3 3 0 0 0 3-3 9 9 0 0 0-9-9ZM7 11h.01M9 7h.01M14 7h.01M17 10h.01',
    schedule: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
    code: 'M8 6 2 12l6 6m8-12 6 6-6 6m-3-15-2 18',
    analysis: 'M4 4v16h16M8 15l4-5 3 2 5-6',
    finance: 'M4 5h16v14H4zM7 9h4m-4 4h4m5-3h.01m0 4h.01',
    writing: 'M13 5H5v15h14v-8M10 15l1-4 7-7 3 3-7 7-4 1Z',
    next: 'M7 17 17 7M7 7h10v10'
  }
  const categoryIcons = { '设计': 'design', '定时任务': 'schedule', '开发': 'code', '分析数据': 'analysis', '金融服务': 'finance', '创作文档': 'writing', '创作模式': 'code' }
  function QuickIcon({ kind }) {
    return h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: iconPaths[kind] ?? iconPaths.normal }))
  }

  function QuickCaseCard({ item, index, language, t, selected, disabled, onSelect }) {
    const id = React.useId()
    const title = item.title[language]
    const description = item.description?.[language]
    const iconKind = categoryIcons[item.category] ?? item.officeMode
    return h('button', {
      type: 'button', className: 'bsw-quick-card', style: { '--bsw-row-delay': `${index * 100}ms` },
      'data-welcome-case': item.id, 'data-case-mode': item.officeMode,
      'aria-labelledby': `${id}-title`, 'aria-describedby': description ? `${id}-description` : undefined,
      'aria-pressed': selected, disabled, onClick: onSelect
    },
      h('span', { className: 'bsw-quick-watermark', 'aria-hidden': true }, h(QuickIcon, { kind: iconKind })),
      h('span', { className: 'bsw-quick-card-bar', 'aria-hidden': true },
        h('span', { className: 'bsw-quick-icon' }, h(QuickIcon, { kind: iconKind })),
        !selected && h('span', { className: 'bsw-quick-action' }, t('quickUse'), h(QuickIcon, { kind: 'normal' }))),
      h('span', { className: 'bsw-quick-copy' },
        h('span', { className: 'bsw-quick-title', id: `${id}-title`, title: item.preset === 'cordis' ? `${t('quickCreator')} · ${title}` : undefined }, title),
        description && h('span', { className: 'bsw-quick-description', id: `${id}-description` }, description)))
  }


  const CASE_BATCH_SIZE = 3
  function shuffle(items) {
    const shuffled = [...items]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const item = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = item
    }
    return shuffled
  }

  function firstCaseBatch(catalog) {
    const configured = (catalog.batches[0] ?? []).map(id => catalog.cases.find(item => item.id === id)).filter(Boolean)
    const first = configured.slice(0, CASE_BATCH_SIZE)
    const nonOffice = configured.find(item => item.officeMode === 'normal')
    // Keep a non-Office example when the configured opening has more cards than fit.
    return nonOffice && !first.includes(nonOffice) ? [...first.slice(0, -1), nonOffice] : first
  }

  function nextCaseBatch(cases, current, cards) {
    const modeRoll = Math.random()
    const previousIds = new Set(cards.map(item => item.id))
    const seen = current?.seen ?? previousIds
    const seenThisRound = seen.size < cases.length ? seen : new Set()
    const alternatives = cases.filter(item => !previousIds.has(item.id))
    const alternativeModes = new Set(alternatives.map(item => item.officeMode))
    const pool = shuffle(alternatives.length >= CASE_BATCH_SIZE && alternativeModes.size >= 2 ? alternatives : cases)
    const modes = shuffle([...new Set(pool.map(item => item.officeMode))])
    const maxModes = Math.min(modes.length, CASE_BATCH_SIZE)
    const modeCount = maxModes < 2 ? maxModes : 2 + Math.floor(modeRoll * (maxModes - 1))

    // Reserve a spot for an unseen case so every case comes up over time.
    const unseen = pool.filter(item => !seenThisRound.has(item.id))
    const preferred = [...unseen, ...pool.filter(item => seenThisRound.has(item.id))]
    const firstMode = modes.find(mode => unseen.some(item => item.officeMode === mode)) ?? modes[0]
    const selectedModes = new Set([firstMode, ...modes.filter(mode => mode !== firstMode).slice(0, modeCount - 1)])
    const selected = [...selectedModes].map(mode => preferred.find(item => item.officeMode === mode))
    const remaining = preferred.filter(item => !selected.includes(item))
    const sameModes = remaining.filter(item => selectedModes.has(item.officeMode))
    const otherModes = remaining.filter(item => !selectedModes.has(item.officeMode))
    // A smaller catalogue may need to fill the last slots from another mode.
    const nextCards = shuffle([...selected, ...sameModes, ...otherModes].slice(0, CASE_BATCH_SIZE))
    return { index: (current?.index ?? 0) + 1, cards: nextCards, seen: new Set([...seenThisRound, ...nextCards.map(item => item.id)]) }
  }


  function WelcomeCases({ sessionId, session, input, inputActions, inputFor }) {
    // Template choosers and examples share the composer dock. Give the active
    // chooser exclusive ownership, as V1.3.1 did, including staged sessions.
    const officeMode = React.useSyncExternalStore(
      listener => ctx.desktopOffice?.subscribe?.(sessionId, listener) || (() => {}),
      () => ctx.desktopOffice?.snapshot(sessionId)?.mode || null)
    const presentationMode = React.useSyncExternalStore(
      listener => ctx.desktopPresentation?.subscribe?.(sessionId, listener) || (() => {}),
      () => ctx.desktopPresentation?.snapshot(sessionId)?.activeMode || null)

    const [batch, setBatch] = React.useState(() => ({ index: 0, cards: firstCaseBatch({ cases: catalog.work, batches: catalog.batches.work }) })), [pending, setPending] = React.useState(() => stagedCase)
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
    if (session && !session.blank) return error ? h('p', { role: 'status' }, error) : null
    if (officeMode || presentationMode === 'ppt') return null
    return h('div', { className: 'bsw-dock-root' }, h('div', { className: 'bsw-dock' }, h('div', { className: 'bsw-viewport' },
      h('section', { className: 'bishengWelcomeCases bsw-quick', 'aria-label': t('title') },
        h('header', { className: 'bsw-dock-heading bsw-quick-heading' }, h('h3', null, t('title')),
          h('button', { type: 'button', className: 'bsw-quick-batch', disabled: busy, onClick: () => setBatch(value => nextCaseBatch(catalog.work, value, value.cards)) }, t('next'))),
        h('div', { className: 'bishengWelcomeCaseGrid bsw-quick-grid', key: batch.index }, batch.cards.map((item, index) => h(QuickCaseCard, {
          key: item.id, item, index, language, t, selected: selected === item.id, disabled: busy,
          onSelect: () => { void choose(item, selected === item.id) }
        }))),
        busy && h('p', { role: 'status' }, t('loading')), error && h('p', { role: 'alert' }, error)))))
  }
  const style = document.createElement('style')
  style.dataset.pluginCss = 'enterprise-welcome-cases'
  // Layout and card presentation restored from V1.3.1; enterprise owns this copy.
  style.textContent = `/* Match the Chat case header and keep both dock headings on the same inset. */
.bsw-quick{padding:10px 0 0}
.bsw-dock-heading {
  margin-inline: -4px;
  padding-inline-start: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.bsw-dock-heading h3{margin:4px 0;font-size:13px;font-weight:600;line-height:20px}
.bsw-quick-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px 12px;
  margin-block: 0 10px;
}
.bsw-template-heading{margin-block:0 6px}
.bsw-quick-batch{flex:none;margin-inline-start:auto;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:5px 8px;white-space:nowrap;cursor:pointer}
.bsw-quick-batch:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bsw-quick-batch:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.bsw-quick-stage{position:relative}
.bsw-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.bsw-quick-grid[data-leaving]{position:absolute;inset:0 0 auto;pointer-events:none}
@keyframes bsw-case-enter{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@media(prefers-reduced-motion:no-preference){.bsw-quick-card{animation:bsw-case-enter 280ms cubic-bezier(.25,.55,.35,1) calc(var(--bsw-entry-delay) + var(--bsw-row-delay)) backwards}.bsw-quick-grid[data-leaving] .bsw-quick-card{animation-play-state:paused}}
.bsw-quick-card{
  --bsw-case-accent:var(--dsw-alias-label-secondary);
  --bsw-case-padding:14px;
  --bsw-case-border-width:1px;
  box-sizing:border-box;display:grid;grid-template-rows:auto 1fr;min-width:0;min-height:120px;row-gap:16px;padding:var(--bsw-case-padding);
  position:relative;isolation:isolate;overflow:hidden;
  border:var(--bsw-case-border-width) solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:var(--dsw-radius-panel);
  background:color-mix(in srgb,var(--bsw-case-accent) 4%,var(--dsw-alias-bg-layer-1));
  color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer;
}
.bsw-quick-card[data-case-mode=ppt]{--bsw-case-accent:var(--dsw-alias-state-warn-primary)}
.bsw-quick-card[data-case-mode=word]{--bsw-case-accent:var(--dsw-alias-state-business-primary)}
.bsw-quick-card[data-case-mode=excel]{--bsw-case-accent:var(--dsw-alias-state-success-primary)}
/* Keep the enlarged icon above the card surface and behind its content. */
.bsw-quick-watermark{
  position:absolute;z-index:-1;inset-inline-end:-18px;inset-block-end:-36px;width:100px;height:100px;
  pointer-events:none;color:var(--bsw-case-accent);opacity:0;transform:translateY(10px);
}
.bsw-quick-watermark svg{display:block;width:100%;height:100%;stroke-width:1.25}
@media(hover:hover){
  .bsw-quick-card:hover:not(:disabled) .bsw-quick-watermark{opacity:.16;transform:none}
  @media(prefers-reduced-motion:no-preference){
    .bsw-quick-watermark{transition:opacity 160ms ease-out,transform 200ms cubic-bezier(.2,.7,.25,1)}
  }
}
.bsw-quick-card-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.bsw-quick-icon{
  display:grid;place-items:center;flex:none;width:30px;height:30px;
  /* Match the center of the icon's top-start corner to the card's. */
  border-radius:max(0px,calc(var(--dsw-radius-panel) - var(--bsw-case-padding) - var(--bsw-case-border-width)));
  background:color-mix(in srgb,var(--bsw-case-accent) 15%,transparent);
  color:color-mix(in srgb,var(--bsw-case-accent) 76%,var(--dsw-alias-label-primary));
}
.bsw-quick-action{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:550;line-height:16px;color:var(--dsw-alias-label-secondary)}
.bsw-quick-action svg{width:13px;height:13px;flex:none}
.bsw-quick-copy{display:grid;align-content:start;gap:3px;min-width:0;overflow-wrap:anywhere}
.bsw-quick-title{font-size:14px;font-weight:600;line-height:20px}
.bsw-quick-description{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.bsw-quick-card:hover:not(:disabled),.bsw-quick-card[aria-pressed=true]{background:color-mix(in srgb,var(--bsw-case-accent) 9%,var(--dsw-alias-bg-layer-1))}
.bsw-quick-card[aria-pressed=true]{border-color:color-mix(in srgb,var(--bsw-case-accent) 58%,var(--dsw-alias-border-l2))}
.bsw-quick-card:hover:not(:disabled) .bsw-quick-action{color:var(--dsw-alias-label-primary)}
.bsw-quick-card:disabled{opacity:.55;cursor:default}
.bsw-quick-card:focus-visible,.bsw-reference-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.bsw-quick-status{min-height:18px;padding-top:9px;font-size:11px;color:var(--dsw-alias-label-secondary)}.bsw-reference{margin-top:6px;padding-top:12px}.bsw-reference-toggle{border:0;background:transparent;padding:0;font:inherit;line-height:18px;font-size:11px;white-space:nowrap;color:var(--dsw-alias-label-secondary);cursor:pointer}.bsw-reference-toggle:hover{text-decoration:underline}

/* Match Chat's welcome scrollport and keep the title reachable in short windows. */
.dshWorkContent [data-content-phase=hero] > [data-conversation-scroll]:has(> [data-composer-seat]) {
  justify-content: safe center;
  padding-block-end: 96px;
}
/* Anchor the dock to the card without adding its height to the centered hero. */
.dshWorkContent [data-content-phase=hero] [data-composer-seat]:has(.bsw-dock-root) {
  position: relative;
  anchor-scope: --bsw-hero-composer;
}
.dshWorkContent [data-content-phase=hero] [data-composer-seat] [data-composer-card] {
  anchor-name: --bsw-hero-composer;
}
.dshWorkContent [data-content-phase=hero] [data-composer-seat] .bsw-dock-root {
  position: absolute;
  position-anchor: --bsw-hero-composer;
  top: anchor(bottom);
  left: anchor(left);
  right: anchor(right);
  width: auto;
  margin-block-start: 4px;
  padding-inline: 0;
}
/* The bound Composer dock is a centered flex row. Its slot uses display:contents,
   so a percentage on our contribution alone lets the row shrink to its content. */
.dshWorkContent [data-composer-seat] :has(> [data-slot="conversation.composer.dock"] > .bsw-dock-root){width:100%;max-width:var(--dsh-composer-card-max-width,100%)}
.bsw-dock-root{box-sizing:border-box;width:100%;min-width:0;padding-bottom:12px}
/* Only the sessionless hero dock sits outside the InputBar's side clearance. */
[data-slot="conversation.hero.dock"]>.bsw-dock-root{padding-inline:var(--dsh-composer-side-clearance)}
.bsw-dock{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,100%);margin:8px auto 0;container-type:inline-size;color:var(--dsw-alias-label-primary);font-size:12px}
.bsw-viewport{padding:4px 4px 12px}
.bsw-reference-panel{display:flow-root}
.bsw-reference-panel[data-closing]{overflow:clip}
@container (max-width:540px){.bsw-quick-grid{grid-template-columns:1fr}.bsw-quick-heading{gap:8px}}

.bsw-quick-card{--bsw-entry-delay:0ms}
`
  document.head.append(style)
  disposers.push(() => style.remove())
  disposers.push(ctx.slots.inject('conversation.hero.dock', () => ctx.slots.register({ name: 'conversation.hero.dock', id: NS, order: 20, locale: NS }, WelcomeCases)))
  disposers.push(ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: NS, order: 20, locale: NS }, WelcomeCases)))
  return () => { for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose() }
}
