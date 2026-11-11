import catalog from '../../../packages/dsh-desktop-office/welcome-cases.json'

/** Presentation in the isolated enterprise Chat document, using its existing theme tokens. */
export const CHAT_WELCOME_CSS = `
/* Reserve the same trailing space as Work when the examples need scrolling. */
.dsh-chat-column:has(> .dsh-chat-landing) { --dsh-chat-scroll-clearance: 2px; }
.dsh-chat-column > .dsh-chat-landing {
  position: relative;
  scrollbar-gutter: stable;
  anchor-scope: --dsh-chat-landing-tail;
  /* Override the web landing's padding shorthand and match Work's bottom spacing. */
  padding-block-end: 96px;
}
.dsh-chat-landing::-webkit-scrollbar { width: 5px; }
.dsh-chat-landing::-webkit-scrollbar-thumb { border-radius: 5px; background: rgb(var(--text-3) / 35%); }

/* Recommended apps follow the examples when present, or the hero on its own. */
.dsh-chat-landing > .dsh-chat-hero,
.dsh-chat-input-shell > [data-dsh-chat-welcome-cases] { anchor-name: --dsh-chat-landing-tail; }
.dsh-chat-landing > .dsh-chat-hero + * {
  position: absolute;
  position-anchor: --dsh-chat-landing-tail;
  top: anchor(bottom);
  inset-inline: 0;
}

/* The examples extend the landing scroll area without recentering the input. */
.dsh-chat-input-shell > [data-dsh-chat-welcome-cases] {
  position: absolute;
  inset-block-start: 100%;
  inset-inline: 0;
  margin-block-start: 22px;
  padding-block-end: 16px;
  color: rgb(var(--text-1));
}
[data-dsh-chat-welcome-cases] .dsh-case-header { display:flex; align-items:flex-start; justify-content:space-between; gap:6px 12px; margin-block-end:10px; padding-inline-start:12px; }
[data-dsh-chat-welcome-cases] h3 { margin:4px 0; font-size:13px; font-weight:600; line-height:20px; }
[data-dsh-chat-welcome-cases] .dsh-case-batch { border:0; border-radius:6px; background:transparent; color:rgb(var(--text-2)); font:inherit; font-size:12px; padding:5px 8px; cursor:pointer; }
[data-dsh-chat-welcome-cases] .dsh-case-batch { flex:none; margin-inline-start:auto; line-height:18px; white-space:nowrap; }
[data-dsh-chat-welcome-cases] .dsh-case-stage { position: relative; }
[data-dsh-chat-welcome-cases] .dsh-case-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
[data-dsh-chat-welcome-cases] .dsh-case-list-outgoing { position: absolute; inset: 0 0 auto; }
[data-dsh-chat-welcome-cases] .dsh-case-button {
  display: flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 40px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--dsw-radius-panel, 28px);
  corner-shape: var(--dsw-corner-shape, superellipse(1.5));
  background: transparent;
  color: rgb(var(--text-2));
  font: inherit;
  text-align: start;
  cursor: pointer;
}
[data-dsh-chat-welcome-cases] .dsh-case-button:disabled { cursor:default; opacity:.65; }
[data-dsh-chat-welcome-cases] button:hover:not(:disabled) { background:rgb(var(--fill-2)); }
[data-dsh-chat-welcome-cases] button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
[data-dsh-chat-welcome-cases] .dsh-case-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 20px;
  color: rgb(var(--text-3));
  color: oklch(var(--dsh-case-icon-lightness, 50%) var(--dsh-case-icon-tone, 0.028 247));
}
/* Keep the icon hues consistent across themes while leaving the row title more prominent. */
body[data-dsh-chat-theme="dark"] [data-dsh-chat-welcome-cases] { --dsh-case-icon-lightness: 63%; }
[data-dsh-chat-welcome-cases] [data-case-icon="mail"] { --dsh-case-icon-tone: 0.084 22; }
[data-dsh-chat-welcome-cases] [data-case-icon="news"] { --dsh-case-icon-tone: 0.071 251; }
[data-dsh-chat-welcome-cases] [data-case-icon="compare"] { --dsh-case-icon-tone: 0.087 307; }
[data-dsh-chat-welcome-cases] [data-case-icon="plan"] { --dsh-case-icon-tone: 0.072 132; }
[data-dsh-chat-welcome-cases] [data-case-icon="notes"] { --dsh-case-icon-tone: 0.061 62; }
[data-dsh-chat-welcome-cases] [data-case-icon="research"] { --dsh-case-icon-tone: 0.074 175; }
[data-dsh-chat-welcome-cases] .dsh-case-title { min-width:0; font-size:14px; font-weight:400; line-height:20px; overflow-wrap:anywhere; }
[data-dsh-chat-welcome-cases] .dsh-case-feedback { display:flex; align-items:center; gap:8px; margin-block-start:6px; color:rgb(var(--text-2)); font-size:12px; line-height:18px; }
[data-dsh-chat-welcome-cases] .dsh-case-feedback[hidden] { display:none; }
/* The programmatic Add menu still runs its native command, without painting its portal. */
html[data-dsh-chat-case-research] .dsh-add-menu[role="menu"] {
  visibility: hidden !important;
  animation: none !important;
  transition: none !important;
}
`

export const CHAT_WELCOME_WORLD = 1001
const COPY = {
  zh: { heading: '从一个案例开始', next: '切换一批', stale: '输入内容已变化，请重新选择案例。', unavailable: '暂时无法填入，请确认输入框可编辑后重试。', researchUnavailable: '无法自动切换深度研究，请在「+」菜单中手动切换后重试。', keepAttachments: '当前草稿含有附件或引用，请先确认要退出深度研究。' },
  en: { heading: 'Start with an example', next: 'Try another set', stale: 'The draft changed. Select an example again.', unavailable: 'The prompt could not be added. Make sure the composer is editable and try again.', researchUnavailable: 'Could not change deep research. Change it in the + menu and try again.', keepAttachments: 'This draft contains attachments or references. Turn off deep research manually after reviewing them.' },
}

type Locale = keyof typeof COPY
type Options = { origin: string; active: boolean; locale: Locale; revision: number }
type Case = (typeof catalog.chat)[number]

/**
 * This function is serialized into a private, non-privileged document world. The embedded
 * BISHENG React app owns the composer, settings and submission; the adapter only uses its
 * current landing/editor markers and normal edit/toggle actions. Remove the adapter when the
 * web app exposes a typed example/prefill extension point.
 */
function installWelcomeCases(options: Options, cases: Case[], batches: string[][], strings: typeof COPY) {
  type Controller = { configure(next: Options): void }
  const local = window as Window & { __dshChatWelcomeCases?: Controller }
  if (location.origin !== options.origin) return
  if (local.__dshChatWelcomeCases) {
    local.__dshChatWelcomeCases.configure(options)
    return
  }
  if (!options.active || location.pathname !== '/workspace/c/new') return

  const anchorSelector = '.dsh-chat-surface .dsh-chat-landing .dsh-chat-hero .dsh-chat-input-shell'
  const editorSelector = '[data-testid="ai-chat-input"]'
  const referenceSelector = '[data-composer-reference]'
  // Current enterprise Chat's portal has no per-command test id. Keep the compatibility
  // lookup in the verified Add menu and accept only the checkbox's known accessible names.
  const addMenuSelector = '.dsh-add-menu[role="menu"]'
  const researchMenuMask = 'data-dsh-chat-case-research'
  const researchNames = new Set(['深度研究', 'Deep research', '詳細リサーチ'])
  const indexed = new Map(cases.map(item => [item.id, item]))
  // Stable case IDs keep intent icons consistent across locales and batches.
  const iconKinds = new Map([
    ['confirm-event', 'mail'], ['ai-brief', 'news'], ['headphones', 'compare'],
    ['team-event', 'compare'], ['booking-scope', 'plan'], ['support-feedback', 'notes'],
  ])
  const iconPaths = new Map([
    ['mail', 'M6 5h12q3 0 3 3v8q0 3-3 3H6q-3 0-3-3V8q0-3 3-3z M3.7 7l7 5.4q1.3 1 2.6 0l7-5.4'],
    ['news', 'M7.5 3h9Q19 3 19 5.5v13Q19 21 16.5 21h-9Q5 21 5 18.5v-13Q5 3 7.5 3z M8.5 7.5h7m-7 4.5h7m-7 4.5h4.5'],
    ['compare', 'M5 5h3q2 0 2 2v10q0 2-2 2H5q-2 0-2-2V7q0-2 2-2z M16 5h3q2 0 2 2v10q0 2-2 2h-3q-2 0-2-2V7q0-2 2-2z M5.5 9h2m9 0h2'],
    ['plan', 'M7 6h10q3 0 3 3v8q0 3-3 3H7q-3 0-3-3V9q0-3 3-3z M8 3.5V8m8-4.5V8M4 10.5h16m-11.5 4.5H10m4 0h1.5'],
    ['notes', 'M8.5 5H7q-2 0-2 2v12q0 2 2 2h10q2 0 2-2V7q0-2-2-2h-1.5' +
      ' M10 3h4q1.5 0 1.5 1.5v1Q15.5 7 14 7h-4q-1.5 0-1.5-1.5v-1Q8.5 3 10 3z M8.5 11.5h7m-7 4h5'],
    ['research', 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14.25 14.25 20 20'],
  ])
  const caseIcon = (item: Case) => {
    const icon = document.createElement('span')
    icon.className = 'dsh-case-icon'
    icon.setAttribute('aria-hidden', 'true')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '17')
    svg.setAttribute('height', '17')
    svg.setAttribute('focusable', 'false')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const kind = iconKinds.get(item.id) ?? (item.deepResearch ? 'research' : 'notes')
    icon.dataset.caseIcon = kind
    path.setAttribute('d', iconPaths.get(kind) ?? '')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.6')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
    icon.append(svg)
    return icon
  }
  const region = document.createElement('section')
  region.dataset.dshChatWelcomeCases = ''
  const header = document.createElement('div')
  header.className = 'dsh-case-header'
  const heading = document.createElement('h3')
  const nextButton = document.createElement('button')
  nextButton.type = 'button'
  nextButton.className = 'dsh-case-batch'
  header.append(heading, nextButton)
  const stage = document.createElement('div')
  stage.className = 'dsh-case-stage'
  const createList = () => {
    const element = document.createElement('div')
    element.className = 'dsh-case-list'
    stage.prepend(element)
    return element
  }
  let list = createList()
  const feedback = document.createElement('div')
  feedback.className = 'dsh-case-feedback'
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  feedback.append(status)
  feedback.hidden = true
  region.append(header, stage, feedback)

  let current = options
  let batch = 0
  let visibleBatch = 0
  let busy = false
  let epoch = 0
  let compose = false
  let shell: HTMLElement | undefined
  let observer: MutationObserver | undefined
  let frame = 0
  let rowAnimations: Animation[] = []
  let outgoing: { list: HTMLElement; fade: Animation; rows: Animation[] } | undefined
  const reducedMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : undefined
  const text = () => strings[current.locale]
  const isLanding = () => current.active && location.origin === current.origin && location.pathname === '/workspace/c/new'
  const canEdit = (editor: HTMLElement) => editor.isConnected && editor.getAttribute('aria-disabled') !== 'true' &&
    (editor instanceof HTMLTextAreaElement ? !editor.disabled && !editor.readOnly : editor.getAttribute('contenteditable') === 'true')
  const readEditor = (editor: HTMLElement) => {
    if (editor instanceof HTMLTextAreaElement) return editor.value
    // Match ComposerEditor's plain text projection, retaining its inline references separately.
    const visit = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
      if (!(node instanceof HTMLElement) || node.matches(referenceSelector)) return ''
      if (node.tagName === 'BR') return node.nextSibling ? '\n' : ''
      const value = Array.from(node.childNodes).map(visit).join('')
      return /^(DIV|P)$/.test(node.tagName) && node !== editor && node.previousSibling ? `\n${value}` : value
    }
    return visit(editor)
  }
  const activeResearch = () => shell?.querySelector<HTMLButtonElement>('.dsh-active-capabilities > button.dsh-active-capability[aria-pressed="true"]') ?? null
  const getEditor = () => shell?.querySelector<HTMLElement>(editorSelector) ?? null
  const findComposer = () => getEditor()?.closest('.dsh-chat-composer')
  const pause = () => new Promise<void>(resolve => setTimeout(resolve, 16))
  const say = (message: string) => {
    feedback.hidden = false
    status.textContent = message
  }
  const clearFeedback = () => {
    status.textContent = ''
    feedback.hidden = true
  }

  function removeOutgoing() {
    if (!outgoing) return
    outgoing.list.remove()
    outgoing.fade.onfinish = null
    outgoing.fade.cancel()
    for (const animation of outgoing.rows) animation.cancel()
    outgoing = undefined
  }

  function cancelListMotion() {
    removeOutgoing()
    for (const animation of rowAnimations) animation.cancel()
    rowAnimations = []
    list.inert = false
  }

  function enterList(startDelay: number) {
    if (!region.isConnected || !isLanding() || reducedMotion?.matches || typeof list.animate !== 'function') return
    // Each row starts out hidden during its delay, then slides into its own fixed slot.
    rowAnimations = Array.from(list.children, (row, index) => row.animate([
      { opacity: 0, transform: 'translateX(-8px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ], {
      duration: 280,
      delay: startDelay + index * 100,
      easing: 'cubic-bezier(0.25, 0.55, 0.35, 1)',
      fill: 'backwards'
    }))
  }

  function render() {
    cancelListMotion()
    heading.textContent = text().heading
    region.setAttribute('aria-label', text().heading)
    nextButton.textContent = text().next
    renderBatch()
  }

  function renderBatch(startDelay = 0) {
    visibleBatch = batch
    list.replaceChildren()
    const ids = batches[visibleBatch] ?? []
    for (const id of ids) {
      const item = indexed.get(id)
      if (!item) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-case-button'
      button.disabled = busy
      const title = document.createElement('span')
      title.className = 'dsh-case-title'
      title.textContent = item.title[current.locale]
      button.append(caseIcon(item), title)
      button.addEventListener('click', () => { void apply(item.prompt, item.deepResearch) })
      list.append(button)
    }
    enterList(startDelay)
  }

  function changeBatch() {
    if (!isLanding() || busy || batches.length < 2) return
    batch = (batch + 1) % batches.length
    clearFeedback()
    transitionBatch()
  }

  function transitionBatch() {
    if (reducedMotion?.matches || typeof list.animate !== 'function') { render(); return }
    // Coalesce repeated clicks while the two lists overlap.
    if (outgoing) return
    // If the user switches mid-entrance, keep the outgoing rows at their current positions.
    for (const animation of rowAnimations) {
      if (animation.playState !== 'finished') animation.pause()
    }
    list.inert = true
    list.setAttribute('aria-hidden', 'true')
    list.classList.add('dsh-case-list-outgoing')
    const fade = list.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 140, easing: 'ease-in-out', fill: 'forwards'
    })
    outgoing = { list, fade, rows: rowAnimations }
    list = createList()
    list.inert = true
    // Start the first new row before the old list reaches zero opacity.
    renderBatch(40)
    fade.onfinish = () => {
      if (outgoing?.fade !== fade) return
      removeOutgoing()
      if (isLanding() && visibleBatch !== batch) transitionBatch()
      else list.inert = false
    }
  }

  function setBusy(value: boolean) {
    busy = value
    region.setAttribute('aria-busy', String(value))
    nextButton.disabled = value
    for (const button of list.querySelectorAll('button')) button.disabled = value
  }

  async function switchResearch(wanted: boolean, valid: () => boolean) {
    const active = activeResearch()
    if (Boolean(active) === wanted) return true
    if (active) {
      if (active.disabled || !valid()) return false
      active.click()
      return waitForResearch(wanted, valid)
    }

    const add = findComposer()?.querySelector<HTMLButtonElement>('button.dsh-composer-add[aria-haspopup="menu"]')
    const root = document.documentElement
    if (!add || add.disabled || add.getAttribute('aria-expanded') !== 'false' || !valid() ||
      root.hasAttribute(researchMenuMask) || document.querySelector(addMenuSelector)) return false

    // The portal mounts outside the composer. Mask it before the key event so
    // even a deferred React commit cannot paint the opening frame.
    root.setAttribute(researchMenuMask, '')
    let menu: HTMLElement | null = null
    const controlledMenu = () => {
      const controls = add.getAttribute('aria-controls')
      const candidate = controls ? document.getElementById(controls) : null
      return candidate?.matches(addMenuSelector) ? candidate : null
    }
    try {
      add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      // Even if the draft becomes stale, let a queued open settle so the
      // cleanup can dismiss it before removing the mask.
      for (let i = 0; i < 8 && add.isConnected; i++) {
        menu = controlledMenu()
        if (menu) break
        await pause()
      }
      if (!menu || !valid()) return false
      const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"][aria-checked="false"]')]
        .filter(item => researchNames.has(item.getAttribute('aria-label') ?? '') && item.getAttribute('aria-disabled') !== 'true' && !item.hasAttribute('data-disabled'))
      if (items.length !== 1) return false
      items[0]?.click()
      return await waitForResearch(wanted, valid)
    } finally {
      try {
        // A failed or canceled selection must also dismiss its own portal.
        menu ??= controlledMenu()
        if (add.getAttribute('aria-expanded') === 'true') {
          (menu?.isConnected ? menu : add).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        }
        // React may close the trigger before removing the portal. Keep masking it
        // through that commit so there is no visible exit frame either.
        for (let i = 0; i < 8 && (menu?.isConnected || add.getAttribute('aria-expanded') === 'true'); i++) await pause()
      } finally {
        root.removeAttribute(researchMenuMask)
      }
    }
  }

  async function waitForResearch(wanted: boolean, valid: () => boolean) {
    // Native React commits may be deferred. Do not claim or use a mode until its chip confirms it.
    for (let i = 0; i < 8 && valid(); i++) {
      if (Boolean(activeResearch()) === wanted) return true
      await pause()
    }
    return false
  }

  function insert(editor: HTMLElement, value: string, append: boolean): boolean {
    // Chromium's native editing command preserves selection, onInput and Ctrl/Cmd+Z.
    // For rich drafts with inline references, append without selecting/removing any chip.
    editor.focus({ preventScroll: true })
    if (editor instanceof HTMLTextAreaElement) {
      editor.setSelectionRange(append ? editor.value.length : 0, editor.value.length)
    } else {
      const selection = window.getSelection()
      if (!selection) return false
      const range = document.createRange()
      range.selectNodeContents(editor)
      if (append) range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    return document.execCommand(value ? 'insertText' : 'delete', false, value)
  }

  async function apply(prompt: string, wanted: boolean) {
    if (busy || outgoing || !isLanding()) return
    const editor = getEditor()
    if (!editor || !canEdit(editor) || compose) { say(text().unavailable); return }
    const previous = readEditor(editor)
    const wasResearch = Boolean(activeResearch())
    const hasReferences = Boolean(editor.querySelector(referenceSelector))
    // Leaving task mode can clear the upstream skill selection and task-only attachments.
    // Let the user use the native toggle deliberately rather than dropping them from a card.
    if (wasResearch && !wanted && (hasReferences || findComposer()?.querySelector('.dsh-composer-attachments'))) {
      say(text().keepAttachments)
      return
    }
    const ownEpoch = epoch
    const stillCurrent = () => isLanding() && ownEpoch === epoch && region.isConnected && getEditor() === editor && canEdit(editor) && !compose
    const valid = () => stillCurrent() && readEditor(editor) === previous
    setBusy(true)
    clearFeedback()
    try {
      if (!await switchResearch(wanted, valid)) {
        if (stillCurrent()) say(valid() ? text().researchUnavailable : text().stale)
        return
      }
      if (!valid()) { if (stillCurrent()) say(text().stale); return }
      const added = hasReferences && previous ? `\n\n${prompt}` : prompt
      if (!insert(editor, added, hasReferences)) { say(text().unavailable); return }
      const filled = readEditor(editor)
      if (filled === previous && previous !== prompt) { say(text().unavailable); return }
    } catch {
      if (stillCurrent()) say(text().unavailable)
    } finally {
      if (ownEpoch === epoch) setBusy(false)
    }
  }

  function mount() {
    frame = 0
    const next = isLanding() ? document.querySelector<HTMLElement>(anchorSelector) : null
    if (next && next.querySelector(editorSelector) && (next !== shell || region.parentElement !== next)) {
      epoch++
      compose = false
      setBusy(false)
      clearFeedback()
      shell = next
      next.append(region)
      render()
    } else if (!next && shell) {
      epoch++
      cancelListMotion()
      shell = undefined
      region.remove()
    }
  }
  const onComposition = (event: Event) => {
    if (event.target === getEditor()) compose = event.type === 'compositionstart'
  }
  const stop = () => {
    epoch++
    cancelListMotion()
    observer?.disconnect()
    observer = undefined
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    document.removeEventListener('compositionstart', onComposition, true)
    document.removeEventListener('compositionend', onComposition, true)
    region.remove()
    shell = undefined
    compose = false
    setBusy(false)
    clearFeedback()
  }
  const configure = (options: Options) => {
    if (options.revision < current.revision) return
    const languageChanged = options.locale !== current.locale
    current = options
    if (!isLanding()) { stop(); return }
    if (languageChanged && region.isConnected) { clearFeedback(); render() }
    if (!observer) {
      // Only blank, visible Chat observes mounting; the host disposes it on first send,
      // settings, navigation and hiding the native view. No observer runs during a turn.
      observer = new MutationObserver(records => {
        if (!frame && records.some(record => !region.contains(record.target))) frame = requestAnimationFrame(mount)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      document.addEventListener('compositionstart', onComposition, true)
      document.addEventListener('compositionend', onComposition, true)
    }
    mount()
  }
  nextButton.addEventListener('click', changeBatch)
  local.__dshChatWelcomeCases = { configure }
  configure(options)
}

export function chatWelcomeCasesScript(options: Options): string {
  return `(${installWelcomeCases.toString()})(${JSON.stringify(options)}, ${JSON.stringify(catalog.chat)}, ${JSON.stringify(catalog.batches.chat)}, ${JSON.stringify(COPY)})`
}
