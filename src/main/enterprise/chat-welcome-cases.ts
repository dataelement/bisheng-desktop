import catalog from '../../../packages/dsh-desktop-office/welcome-cases.json'

/** Presentation in the isolated enterprise Chat document, using its existing theme tokens. */
export const CHAT_WELCOME_CSS = `
.dsh-chat-input-shell > [data-dsh-chat-welcome-cases] { margin-block-start: 22px; color: rgb(var(--text-1)); }
[data-dsh-chat-welcome-cases] .dsh-case-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; margin-block-end:10px; }
[data-dsh-chat-welcome-cases] h3 { margin:0; font-size:13px; font-weight:600; line-height:20px; }
[data-dsh-chat-welcome-cases] .dsh-case-batch, [data-dsh-chat-welcome-cases] .dsh-case-undo { border:0; border-radius:6px; background:transparent; color:rgb(var(--text-2)); font:inherit; font-size:12px; padding:5px 8px; cursor:pointer; }
[data-dsh-chat-welcome-cases] .dsh-case-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
[data-dsh-chat-welcome-cases] .dsh-case-button { display:flex; min-width:0; min-height:62px; align-items:center; gap:12px; padding:10px 12px; border:1px solid rgb(var(--border-base)); border-radius:12px; background:rgb(var(--bg-page)); color:inherit; font:inherit; text-align:start; cursor:pointer; }
[data-dsh-chat-welcome-cases] .dsh-case-button:disabled { cursor:default; opacity:.65; }
[data-dsh-chat-welcome-cases] button:hover:not(:disabled) { background:rgb(var(--fill-2)); }
[data-dsh-chat-welcome-cases] button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
[data-dsh-chat-welcome-cases] .dsh-case-icon { display:grid; flex:none; place-items:center; width:30px; height:30px; border-radius:8px; background:rgb(var(--fill-2)); color:rgb(var(--text-2)); }
[data-dsh-chat-welcome-cases] .dsh-case-arrow { flex:none; margin-inline-start:auto; color:rgb(var(--text-2)); }
[data-dsh-chat-welcome-cases] .dsh-case-title, [data-dsh-chat-welcome-cases] .dsh-case-desc { display:block; overflow-wrap:anywhere; }
[data-dsh-chat-welcome-cases] .dsh-case-title { font-size:13px; font-weight:550; line-height:19px; }
[data-dsh-chat-welcome-cases] .dsh-case-desc, [data-dsh-chat-welcome-cases] .dsh-case-feedback { color:rgb(var(--text-2)); font-size:12px; line-height:18px; }
[data-dsh-chat-welcome-cases] .dsh-case-desc { margin-block-start:2px; }
[data-dsh-chat-welcome-cases] .dsh-case-feedback { display:flex; align-items:center; gap:8px; margin-block-start:6px; }
[data-dsh-chat-welcome-cases] .dsh-case-feedback[hidden] { display:none; }
@media (max-width:540px) { [data-dsh-chat-welcome-cases] .dsh-case-grid { grid-template-columns:minmax(0,1fr); } }
`

export const CHAT_WELCOME_WORLD = 1001
const COPY = {
  zh: { heading: '从一个案例开始', next: '切换一批', undo: '撤销', filled: '提示词已填入，可编辑后发送。', appended: '提示词已添加，原草稿和引用已保留。', research: '已开启深度研究，提示词已填入。', ordinary: '已关闭深度研究，提示词已填入。', restored: '已恢复原草稿。', stale: '输入内容已变化，请重新选择案例。', unavailable: '暂时无法填入，请确认输入框可编辑后重试。', researchUnavailable: '无法自动切换深度研究，请在「+」菜单中手动切换后重试。', keepAttachments: '当前草稿含有附件或引用，请先确认要退出深度研究。' },
  en: { heading: 'Start with an example', next: 'Try another set', undo: 'Undo', filled: 'Prompt added. Edit it before sending.', appended: 'Prompt added. Your existing draft and references are kept.', research: 'Deep research is on and the prompt is ready.', ordinary: 'Deep research is off and the prompt is ready.', restored: 'Previous draft restored.', stale: 'The draft changed. Select an example again.', unavailable: 'The prompt could not be added. Make sure the composer is editable and try again.', researchUnavailable: 'Could not change deep research. Change it in the + menu and try again.', keepAttachments: 'This draft contains attachments or references. Turn off deep research manually after reviewing them.' },
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
  const researchNames = new Set(['深度研究', 'Deep research', '詳細リサーチ'])
  const indexed = new Map(cases.map(item => [item.id, item]))
  // Stable case IDs keep intent icons consistent across locales and batches.
  const iconKinds = new Map([
    ['confirm-event', 'mail'], ['ai-brief', 'news'], ['headphones', 'compare'],
    ['team-event', 'compare'], ['booking-scope', 'plan'], ['support-feedback', 'notes'],
  ])
  const iconPaths = new Map([
    ['mail', 'M3 5h18v14H3zM3 6l9 7 9-7'],
    ['news', 'M5 3h14v18H5zM8 7h8m-8 5h8m-8 4h5'],
    ['compare', 'M3 5h7v14H3zM14 5h7v14h-7zM5 9h3m8 0h3'],
    ['plan', 'M4 6h16v14H4zM8 3v5m8-5v5M4 11h16m-12 4h2m4 0h2'],
    ['notes', 'M9 4H5v17h14V4h-4m-6-1h6v4H9zM8 11h8m-8 4h6'],
    ['research', 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 5 6 6'],
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
  const grid = document.createElement('div')
  grid.className = 'dsh-case-grid'
  const feedback = document.createElement('div')
  feedback.className = 'dsh-case-feedback'
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  feedback.append(status)
  feedback.hidden = true
  region.append(header, grid, feedback)

  let current = options
  let batch = 0
  let busy = false
  let epoch = 0
  let compose = false
  let shell: HTMLElement | undefined
  let observer: MutationObserver | undefined
  let frame = 0
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
  const say = (message: string, undo?: () => void) => {
    feedback.hidden = false
    status.textContent = message
    feedback.querySelector('button')?.remove()
    if (!undo) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-case-undo'
    button.textContent = text().undo
    button.addEventListener('click', undo)
    feedback.append(button)
  }
  const clearFeedback = () => {
    status.textContent = ''
    feedback.querySelector('button')?.remove()
    feedback.hidden = true
  }

  function render() {
    heading.textContent = text().heading
    region.setAttribute('aria-label', text().heading)
    nextButton.textContent = text().next
    grid.replaceChildren()
    const ids = batches[batch] ?? []
    for (const id of ids) {
      const item = indexed.get(id)
      if (!item) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-case-button'
      button.disabled = busy
      const copy = document.createElement('span')
      const title = document.createElement('strong')
      title.className = 'dsh-case-title'
      title.textContent = item.title[current.locale]
      const description = document.createElement('span')
      description.className = 'dsh-case-desc'
      description.textContent = item.description[current.locale]
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      arrow.setAttribute('class', 'dsh-case-arrow')
      arrow.setAttribute('viewBox', '0 0 16 16')
      arrow.setAttribute('width', '14')
      arrow.setAttribute('height', '14')
      arrow.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M4 12 12 4M5 4h7v7')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.2')
      arrow.append(path)
      copy.append(title, description)
      button.append(caseIcon(item), copy, arrow)
      button.addEventListener('click', () => { void apply(item.prompt, item.deepResearch) })
      grid.append(button)
    }
  }

  function setBusy(value: boolean) {
    busy = value
    region.setAttribute('aria-busy', String(value))
    nextButton.disabled = value
    for (const button of grid.querySelectorAll('button')) button.disabled = value
    const undo = feedback.querySelector('button')
    if (undo) undo.disabled = value
  }

  async function switchResearch(wanted: boolean, valid: () => boolean) {
    const active = activeResearch()
    if (Boolean(active) === wanted) return true
    if (active) {
      if (active.disabled || !valid()) return false
      active.click()
    } else {
      const add = findComposer()?.querySelector<HTMLButtonElement>('button.dsh-composer-add[aria-haspopup="menu"]')
      if (!add || add.disabled || add.getAttribute('aria-expanded') !== 'false' || !valid()) return false
      // Radix opens from the same keyboard action a user would invoke. Restrict portal lookup
      // to the trigger's aria-controls and the native Add-menu class; never click a loose match.
      add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      let menu: HTMLElement | null = null
      let selected = false
      try {
        for (let i = 0; i < 8 && valid(); i++) {
          const controls = add.getAttribute('aria-controls')
          const candidate = controls && document.getElementById(controls)
          if (candidate && candidate.matches('.dsh-add-menu[role="menu"]')) { menu = candidate; break }
          await pause()
        }
        if (!menu || !valid()) return false
        const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"][aria-checked="false"]')]
          .filter(item => researchNames.has(item.getAttribute('aria-label') ?? '') && item.getAttribute('aria-disabled') !== 'true' && !item.hasAttribute('data-disabled'))
        if (items.length !== 1) return false
        items[0]?.click()
        selected = true
      } finally {
        // Close only the menu this adapter opened, never one opened before selection.
        if (!selected && add.getAttribute('aria-expanded') === 'true') {
          (menu ?? add).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        }
      }
    }
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

  async function apply(prompt: string, wanted: boolean, undoing = false) {
    if (busy || !isLanding()) return
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
    try {
      if (!await switchResearch(wanted, valid)) {
        if (stillCurrent()) say(valid() ? text().researchUnavailable : text().stale)
        return
      }
      if (!valid()) { if (stillCurrent()) say(text().stale); return }
      const added = hasReferences && previous && !undoing ? `\n\n${prompt}` : prompt
      if (!insert(editor, added, hasReferences && !undoing)) { say(text().unavailable); return }
      const filled = readEditor(editor)
      if (filled === previous && !undoing && previous !== prompt) { say(text().unavailable); return }
      const undo = !undoing && !hasReferences && (previous !== filled || wasResearch !== wanted) ? () => {
        if (!stillCurrent() || readEditor(editor) !== filled || Boolean(activeResearch()) !== wanted || editor.querySelector(referenceSelector)) {
          say(text().stale)
          return
        }
        void apply(previous, wasResearch, true)
      } : undefined
      say(undoing ? text().restored : hasReferences ? text().appended : wasResearch !== wanted ? wanted ? text().research : text().ordinary : text().filled, undo)
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
    } else if (!next && shell) {
      epoch++
      shell = undefined
      region.remove()
    }
  }
  const onComposition = (event: Event) => {
    if (event.target === getEditor()) compose = event.type === 'compositionstart'
  }
  const stop = () => {
    epoch++
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
    if (languageChanged) { clearFeedback(); render() }
    if (!isLanding()) { stop(); return }
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
  nextButton.addEventListener('click', () => {
    if (!isLanding() || busy || batches.length < 2) return
    batch = (batch + 1) % batches.length
    render()
  })
  local.__dshChatWelcomeCases = { configure }
  render()
  configure(options)
}

export function chatWelcomeCasesScript(options: Options): string {
  return `(${installWelcomeCases.toString()})(${JSON.stringify(options)}, ${JSON.stringify(catalog.chat)}, ${JSON.stringify(catalog.batches.chat)}, ${JSON.stringify(COPY)})`
}
