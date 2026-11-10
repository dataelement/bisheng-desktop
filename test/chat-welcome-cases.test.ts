// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import catalog from '../packages/dsh-desktop-office/welcome-cases.json'
import { chatWelcomeCasesScript } from '../src/main/enterprise/chat-welcome-cases'

const selector = '[data-dsh-chat-welcome-cases]'
let revision = 0
function deliver(active = true, locale: 'zh' | 'en' = 'zh') {
  window.eval(chatWelcomeCasesScript({ origin: location.origin, active, locale, revision: ++revision }))
}
function get<T extends HTMLElement = HTMLElement>(query: string): T {
  const value = document.querySelector<T>(query)
  if (!value) throw new Error(`Missing fixture node: ${query}`)
  return value
}

/** Markup follows the enterprise ComposerEditor and Add menu contracts. */
function fixture({ hasResearch = true } = {}) {
  document.body.innerHTML = `<main class="dsh-chat-surface"><div class="dsh-chat-landing"><div class="dsh-chat-hero">
    <div class="dsh-chat-input-shell"><div class="dsh-chat-composer">
      <div role="textbox" contenteditable="true" data-testid="ai-chat-input"></div>
      <button class="dsh-composer-add" aria-haspopup="menu" aria-expanded="false">Add</button>
      <div class="dsh-active-capabilities"></div>
      <button data-testid="send-button">Send</button>
    </div></div></div></div></main>`
  const editor = get('[data-testid=ai-chat-input]')
  const add = get('.dsh-composer-add')
  const capabilities = get('.dsh-active-capabilities')
  const submit = vi.fn()
  get('[data-testid=send-button]').addEventListener('click', submit)
  let mode = false
  const setMode = (next: boolean) => {
    mode = next
    capabilities.replaceChildren()
    if (!mode) return
    const chip = document.createElement('button')
    chip.className = 'dsh-active-capability'
    chip.setAttribute('aria-pressed', 'true')
    chip.textContent = '深度研究'
    chip.addEventListener('click', () => setMode(false))
    capabilities.append(chip)
  }
  add.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return
    const menu = document.createElement('div')
    menu.id = 'fixture-menu'
    menu.className = 'dsh-add-menu'
    menu.setAttribute('role', 'menu')
    const close = () => { menu.remove(); add.setAttribute('aria-expanded', 'false') }
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') close() })
    if (hasResearch) {
      const item = document.createElement('div')
      item.setAttribute('role', 'menuitemcheckbox')
      item.setAttribute('aria-label', '深度研究')
      item.setAttribute('aria-checked', String(mode))
      item.addEventListener('click', () => { setMode(!mode); close() })
      menu.append(item)
    }
    document.body.append(menu)
    add.setAttribute('aria-controls', menu.id)
    add.setAttribute('aria-expanded', 'true')
  })
  // JSDOM has Range but not Chromium's native editor commands. The WebContentsView
  // smoke run exercises insertText itself; this fake only checks the chosen Range.
  const edit = vi.fn((_command: string, _showUI: boolean, value: string) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    range.deleteContents()
    if (value) range.insertNode(document.createTextNode(value))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: edit })
  return { editor, add, mode: () => mode, setMode, submit, edit }
}

const cards = () => [...document.querySelectorAll<HTMLButtonElement>(`${selector} .dsh-case-button`)]
const choose = (id: string) => {
  const item = catalog.chat.find(item => item.id === id)
  if (!item) throw new Error(`Missing fixture case: ${id}`)
  const card = cards().find(button => button.textContent?.startsWith(item.title.zh))
  if (!card) throw new Error(`Missing fixture card: ${id}`)
  card.click()
  return item
}
const done = () => vi.waitFor(() => expect(get(selector).getAttribute('aria-busy')).not.toBe('true'))

beforeEach(() => { window.history.replaceState(null, '', '/workspace/c/new') })
afterEach(() => {
  deliver(false)
  document.body.replaceChildren()
})

it('mounts four cases only for blank Chat and covers the catalog through manual batches', () => {
  fixture()
  window.history.replaceState(null, '', '/workspace/c/existing')
  deliver()
  expect(cards()).toHaveLength(0)
  window.history.replaceState(null, '', '/workspace/c/new')
  deliver()
  const seen = new Set<string>()
  for (const batch of catalog.batches.chat) {
    expect(cards()).toHaveLength(4)
    cards().forEach(card => seen.add(card.querySelector('strong')?.textContent ?? ''))
    expect(batch).toHaveLength(4)
    get(`${selector} .dsh-case-batch`).click()
  }
  expect(seen.size).toBe(catalog.chat.length)
  deliver(true, 'en')
  expect(get(`${selector} h3`).textContent).toBe('Start with an example')
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  deliver(false)
  expect(cards()).toHaveLength(0)
})

it('fills the controlled editor directly, switches real mode controls, and restores prior text and mode via undo', async () => {
  const f = fixture()
  f.editor.textContent = '原草稿'
  deliver()
  const research = choose('enterprise-agents')
  await done()
  expect(f.mode()).toBe(true)
  expect(f.editor.textContent).toBe(research.prompt)
  expect(document.activeElement).toBe(f.editor)
  const ordinary = choose('confirm-event')
  await done()
  expect(f.mode()).toBe(false)
  expect(f.editor.textContent).toBe(ordinary.prompt)
  get(`${selector} .dsh-case-undo`).click()
  await done()
  expect(f.mode()).toBe(true)
  expect(f.editor.textContent).toBe(research.prompt)
  expect(f.submit).not.toHaveBeenCalled()
})

it('keeps the draft when research is unavailable, and protects attachments from automatic mode exit', async () => {
  const f = fixture({ hasResearch: false })
  f.editor.textContent = '已有草稿'
  deliver()
  choose('enterprise-agents')
  await done()
  expect(f.editor.textContent).toBe('已有草稿')
  expect(f.add.getAttribute('aria-expanded')).toBe('false')
  expect(get(`${selector} [role=status]`).textContent).toContain('手动切换')
  f.setMode(true)
  const chip = document.createElement('span')
  chip.dataset.composerReference = 'skill'
  chip.textContent = '用户引用'
  f.editor.prepend(chip)
  choose('confirm-event')
  expect(f.mode()).toBe(true)
  expect(chip.isConnected).toBe(true)
  expect(f.editor.textContent).toBe('用户引用已有草稿')
  expect(f.edit).not.toHaveBeenCalled()
})

it('does not change the draft during an IME composition or after first send removes the landing', async () => {
  const f = fixture()
  f.editor.textContent = '我的草稿'
  deliver()
  f.editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  choose('confirm-event')
  expect(f.editor.textContent).toBe('我的草稿')
  f.editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  choose('enterprise-agents')
  deliver(false)
  await vi.waitFor(() => expect(document.querySelector(selector)).toBeNull())
  expect(f.editor.textContent).toBe('我的草稿')
  expect(f.submit).not.toHaveBeenCalled()
})
