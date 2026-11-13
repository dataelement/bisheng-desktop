// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import catalog from '../packages/dsh-desktop-office/welcome-cases.json'
import { CHAT_WELCOME_CSS, chatWelcomeCasesScript } from '../src/main/enterprise/chat-welcome-cases'

const selector = '[data-dsh-chat-welcome-cases]'
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
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
function fixture({ hasResearch = true, closeDelay = 0 } = {}) {
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
    const close = () => {
      add.setAttribute('aria-expanded', 'false')
      if (closeDelay) setTimeout(() => menu.remove(), closeDelay)
      else menu.remove()
    }
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

const activeList = () => get(`${selector} .dsh-case-list:not(.dsh-case-list-outgoing)`)
const cards = () => [...document.querySelectorAll<HTMLButtonElement>(`${selector} .dsh-case-list:not(.dsh-case-list-outgoing) .dsh-case-button`)]
const choose = (id: string) => {
  const item = catalog.chat.find(item => item.id === id)
  if (!item) throw new Error(`Missing fixture case: ${id}`)
  const card = cards().find(button => Object.values(item.title).some(title => button.textContent === title))
  if (!card) throw new Error(`Missing fixture card: ${id}`)
  card.click()
  return item
}
const done = () => vi.waitFor(() => expect(get(selector).getAttribute('aria-busy')).not.toBe('true'))

function motionFixture(reduced = false) {
  const animations: {
    target: Element
    keyframes: Keyframe[]
    options: KeyframeAnimationOptions
    cancel: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    onfinish: (() => void) | null
  }[] = []
  const animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = { target: this, keyframes, options, cancel: vi.fn(), pause: vi.fn(), onfinish: null as (() => void) | null }
    animations.push(animation)
    return animation
  })
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  return { animate, animations }
}

beforeEach(() => { window.history.replaceState(null, '', '/workspace/c/new') })
afterEach(() => {
  deliver(false)
  Reflect.deleteProperty(window, '__dshChatWelcomeCases')
  document.body.replaceChildren()
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(Element.prototype, 'animate')
  vi.unstubAllGlobals()
})

it('overlaps batch fades, preserves the row stagger and keeps header focus through repeated clicks', async () => {
  const f = fixture()
  const motion = motionFixture()
  deliver()
  const header = get(`${selector} .dsh-case-header`)
  const next = get(`${selector} .dsh-case-batch`)
  const list = activeList()
  const original = cards()
  const firstEntrance = motion.animations.slice()
  expect(firstEntrance.map(animation => animation.target)).toEqual(original)
  firstEntrance.forEach(({ keyframes, options }, index) => {
    expect(keyframes[0]).toMatchObject({ opacity: 0, transform: expect.stringMatching(/^translateX\(-/) })
    expect(keyframes.at(-1)).toEqual({ opacity: 1, transform: 'translateX(0)' })
    expect(options.fill).toBe('backwards')
    expect(options.delay).toBe(index * 100)
  })
  deliver()
  expect(motion.animate).toHaveBeenCalledTimes(original.length)
  next.focus()
  next.click()
  const exit = motion.animations.find(animation => animation.target === list)
  const secondList = activeList()
  const secondEntrance = motion.animations.slice(original.length + 1)
  expect(exit?.target).toBe(list)
  firstEntrance.forEach(animation => {
    expect(animation.pause).toHaveBeenCalledOnce()
    expect(animation.cancel).not.toHaveBeenCalled()
  })
  expect(exit?.options.fill).toBe('forwards')
  expect(exit?.keyframes.at(-1)).toEqual({ opacity: 0 })
  expect(list.isConnected).toBe(true)
  expect(list.inert).toBe(true)
  expect(list.getAttribute('aria-hidden')).toBe('true')
  expect(secondList).not.toBe(list)
  expect(secondList.inert).toBe(true)
  expect(secondEntrance.map(animation => animation.target)).toEqual(cards())
  const startDelay = secondEntrance[0]?.options.delay ?? Infinity
  expect(startDelay).toBeLessThan(Number(exit?.options.duration))
  expect(secondEntrance.map(animation => (animation.options.delay ?? 0) - startDelay)).toEqual(firstEntrance.map(animation => animation.options.delay))
  original[0]?.click()
  expect(f.edit).not.toHaveBeenCalled()
  next.click()
  expect(motion.animate).toHaveBeenCalledTimes(original.length + 1 + secondEntrance.length)
  exit?.onfinish?.()
  expect(list.isConnected).toBe(false)
  expect(secondList.classList.contains('dsh-case-list-outgoing')).toBe(true)
  expect(cards().map(card => card.textContent)).toEqual(
    catalog.batches.chat[2]?.map(id => catalog.chat.find(item => item.id === id)?.title.zh)
  )
  firstEntrance.forEach(animation => expect(animation.cancel).toHaveBeenCalledOnce())
  motion.animations.find(animation => animation.target === secondList)?.onfinish?.()
  expect(secondList.isConnected).toBe(false)
  expect(activeList().inert).toBe(false)
  expect(get(`${selector} .dsh-case-header`)).toBe(header)
  expect(document.activeElement).toBe(next)
  choose(catalog.batches.chat[2]?.[0] ?? '')
  await done()
  expect(f.edit).toHaveBeenCalledOnce()
})

it('cancels a pending switch on locale changes, hiding, and re-entry', () => {
  fixture()
  const motion = motionFixture()
  deliver()
  const firstList = activeList()
  get(`${selector} .dsh-case-batch`).click()
  const exit = motion.animations.find(animation => animation.target === firstList)
  deliver(true, 'en')
  expect(exit?.cancel).toHaveBeenCalledOnce()
  expect(exit?.onfinish).toBeNull()
  expect(firstList.isConnected).toBe(false)
  expect(activeList().inert).toBe(false)
  expect(cards().map(card => card.textContent)).toEqual(
    catalog.batches.chat[1]?.map(id => catalog.chat.find(item => item.id === id)?.title.en)
  )
  const secondList = activeList()
  get(`${selector} .dsh-case-batch`).click()
  const interrupted = motion.animations.find(animation => animation.target === secondList)
  deliver(false, 'en')
  expect(interrupted?.cancel).toHaveBeenCalledOnce()
  expect(interrupted?.onfinish).toBeNull()
  expect(document.querySelector(selector)).toBeNull()
  deliver(true, 'en')
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  expect(cards().map(card => card.textContent)).toEqual(
    catalog.batches.chat[2]?.map(id => catalog.chat.find(item => item.id === id)?.title.en)
  )
  expect(activeList().inert).toBe(false)
  expect(motion.animations.at(-1)?.target.isConnected).toBe(true)
})

it('shows and switches cases immediately when reduced motion is enabled', () => {
  fixture()
  const motion = motionFixture(true)
  deliver()
  get(`${selector} .dsh-case-batch`).click()
  expect(motion.animate).not.toHaveBeenCalled()
  expect(cards().map(card => card.textContent)).toEqual(
    catalog.batches.chat[1]?.map(id => catalog.chat.find(item => item.id === id)?.title.zh)
  )
  expect(activeList().inert).toBe(false)
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
    cards().forEach((card, index) => {
      const item = catalog.chat.find(item => item.id === batch[index])
      expect(card.textContent).toBe(item?.title.zh)
      expect(card.querySelector('.dsh-case-icon')?.getAttribute('aria-hidden')).toBe('true')
      expect(card.children).toHaveLength(2)
      seen.add(card.querySelector('.dsh-case-title')?.textContent ?? '')
    })
    expect(batch).toHaveLength(4)
    get(`${selector} .dsh-case-batch`).click()
  }
  expect(seen.size).toBe(catalog.chat.length)
  deliver(true, 'en')
  expect(get(`${selector} h3`).textContent).toBe('Start with an example')
  expect(cards().map(card => card.textContent)).toEqual(
    catalog.batches.chat[0]?.map(id => catalog.chat.find(item => item.id === id)?.title.en)
  )
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  deliver(false)
  expect(cards()).toHaveLength(0)
})

it.each(['zh', 'en'] as const)('fills the editor and switches mode without success feedback or an undo button (%s)', async locale => {
  const f = fixture()
  f.editor.textContent = '原草稿'
  deliver(true, locale)
  const research = choose('enterprise-agents')
  await done()
  expect(f.mode()).toBe(true)
  expect(f.editor.textContent).toBe(research.prompt)
  expect(document.activeElement).toBe(f.editor)
  expect(get(`${selector} .dsh-case-feedback`).hidden).toBe(true)
  expect(get(`${selector} [role=status]`).textContent).toBe('')
  expect(document.querySelector(`${selector} .dsh-case-feedback button`)).toBeNull()
  const ordinary = choose('confirm-event')
  await done()
  expect(f.mode()).toBe(false)
  expect(f.editor.textContent).toBe(ordinary.prompt)
  expect(get(`${selector} .dsh-case-feedback`).hidden).toBe(true)
  expect(get(`${selector} [role=status]`).textContent).toBe('')
  expect(document.querySelector(`${selector} .dsh-case-feedback button`)).toBeNull()
  expect(f.submit).not.toHaveBeenCalled()
})

it.each([true, false])('keeps the automatic menu hidden through portal removal (research available=%s)', async hasResearch => {
  const f = fixture({ hasResearch, closeDelay: 35 })
  const style = document.createElement('style')
  style.textContent = CHAT_WELCOME_CSS
  document.body.append(style)
  deliver()
  const research = choose('enterprise-agents')
  const menu = get('.dsh-add-menu')
  expect(f.add.getAttribute('aria-expanded')).toBe('false')
  expect(getComputedStyle(menu).visibility).toBe('hidden')
  await done()
  expect(menu.isConnected).toBe(false)
  expect(f.mode()).toBe(hasResearch)
  expect(f.editor.textContent).toBe(hasResearch ? research.prompt : '')

  f.add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  expect(f.add.getAttribute('aria-expanded')).toBe('true')
  expect(getComputedStyle(get('.dsh-add-menu')).visibility).toBe('visible')
})

it('leaves an already open manual menu alone when a research case is requested', async () => {
  const f = fixture()
  deliver()
  f.add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  const menu = get('.dsh-add-menu')
  choose('enterprise-agents')
  await done()
  expect(get('.dsh-add-menu')).toBe(menu)
  expect(f.add.getAttribute('aria-expanded')).toBe('true')
  expect(f.mode()).toBe(false)
  expect(f.edit).not.toHaveBeenCalled()
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
  const research = choose('enterprise-agents')
  await done()
  expect(chip.isConnected).toBe(true)
  expect(f.editor.textContent).toBe(`用户引用已有草稿\n\n${research.prompt}`)
  expect(get(`${selector} .dsh-case-feedback`).hidden).toBe(true)
  expect(get(`${selector} [role=status]`).textContent).toBe('')
  expect(document.querySelector(`${selector} .dsh-case-feedback button`)).toBeNull()
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
