// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { CHAT_LAYOUT_CSS } from '../src/main/enterprise/chat-layout'
import { chatLandingGeometryScript, parseChatLandingGeometry } from '../src/main/enterprise/chat-landing-geometry'
import { moduleThemePaletteCss } from '../src/main/enterprise/chat-module-theme'
import type { EnterprisePalette } from '../src/shared/enterprise-chat-view'

afterEach(() => { document.documentElement.removeAttribute('data-bisheng-surface'); document.head.replaceChildren(); document.body.replaceChildren() })

it('removes the desktop Chat section row and its reserved height without changing Work tabs', () => {
  const style = document.createElement('style')
  style.textContent = `.dsh-chat-surface .dsh-chat-header { display:grid; height:76px; grid-template-rows:30px 25.5px; row-gap:10px }
    .dsh-chat-surface .dsh-chat-section-row { display:flex }
    ${CHAT_LAYOUT_CSS}`
  document.head.append(style)
  document.body.innerHTML = `<main class="dsh-chat-surface"><header class="dsh-chat-header"><div class="dsh-chat-header-row">Title</div><div class="dsh-chat-section-row">Conversation</div></header><article>Messages</article></main><section id="work"><div role="tablist">Conversation / Trace</div></section>`
  const header = document.querySelector('.dsh-chat-header')!
  const row = document.querySelector('.dsh-chat-section-row')!
  expect(getComputedStyle(row).display).toBe('none')
  expect(getComputedStyle(header).height).toBe('48px')
  expect(getComputedStyle(header).userSelect).toBe('none')
  expect(getComputedStyle(header).gridTemplateRows).toBe('30px')
  expect(getComputedStyle(document.querySelector('#work [role=tablist]')!).display).not.toBe('none')
  expect(getComputedStyle(document.querySelector('article')!).display).not.toBe('none')
})

it('aligns the desktop Cascader shell to Work without restyling a different combobox', () => {
  document.documentElement.dataset.bishengSurface = 'desktop'
  const style = document.createElement('style')
  style.textContent = CHAT_LAYOUT_CSS
  document.head.append(style)
  document.body.innerHTML = `<main class="dsh-chat-surface"><div class="dsh-composer-toolbar"><div class="dsh-composer-trailing">
    <div data-state="closed" id="model"><span><input role="combobox"></span><span><svg></svg></span></div>
  </div><input id="other" role="combobox"></div></main>`
  const model = document.querySelector('#model')!
  const other = document.querySelector('#other')!
  expect(getComputedStyle(model).height).toBe('28px')
  expect(getComputedStyle(model).fontSize).toBe('13px')
  expect(getComputedStyle(model).padding).toBe('0px 4px 0px 8px')
  expect(getComputedStyle(other).height).not.toBe('28px')
})

it('samples the closed model caption and send opacity without reading search or draft text', () => {
  document.body.innerHTML = `<main class="dsh-chat-surface"><div class="dsh-chat-landing"><h2 class="dsh-chat-headline">Welcome</h2>
    <div class="dsh-chat-composer"><div contenteditable="true">Private draft</div><div class="dsh-composer-trailing">
      <div data-state="closed" id="model"><span><span aria-hidden="true" data-label="DeepSeek V3"></span><input role="combobox" value="Private search"></span><span></span></div>
      <button class="dsh-composer-send" data-testid="send-button" style="opacity:0.4"></button>
    </div></div></div></main>`
  const rect = (selector: string, x: number, y: number, w: number, h: number) => {
    document.querySelector(selector)!.getBoundingClientRect = () => new DOMRect(x, y, w, h)
  }
  rect('.dsh-chat-landing', 0, 0, 600, 480)
  rect('.dsh-chat-headline', 30, 50, 200, 30)
  rect('.dsh-chat-composer', 30, 120, 540, 100)
  rect('#model', 420, 175, 88, 28)
  rect('[data-testid="send-button"]', 520, 170, 34, 34)
  const href = 'https://enterprise.example/workspace/c/new'
  const read = new Function('location', 'innerWidth', 'innerHeight', `return ${chatLandingGeometryScript(href, 600, 480)}`)
  const sample = () => read({ href, pathname: '/workspace/c/new' }, 600, 480) as Record<string, unknown>
  const painted = sample()
  expect(parseChatLandingGeometry(painted, 600, 480)).toMatchObject({ model: { label: 'DeepSeek V3', width: 88 }, sendOpacity: 0.4 })
  expect(JSON.stringify(painted)).not.toContain('Private')
  document.querySelector('#model')!.setAttribute('data-state', 'open')
  expect(sample().model).toBeUndefined()
  expect(parseChatLandingGeometry({ ...painted, model: { label: 'Forged', width: 700 }, sendOpacity: NaN }, 600, 480)).toEqual({
    title: painted.title, composer: painted.composer
  })
})

it.each(['light', 'dark'] as const)('uses Work’s batch action ink only in desktop Chat for the %s theme', theme => {
  const palette: EnterprisePalette = {
    surface: [20, 20, 22], raised: [27, 27, 28], strong: [44, 44, 46],
    labelPrimary: [249, 250, 251], labelSecondary: theme === 'dark' ? [207, 211, 214] : [88, 94, 102],
    labelTertiary: [129, 133, 140], borderBase: [51, 51, 54], borderDeep: [83, 85, 91]
  }
  const style = document.createElement('style')
  // The page supplies its own local ink. The host changes only the shared batch action.
  style.textContent = `.chat-welcome-examples .chat-welcome-examples-next { color:rgb(182, 184, 190) }
    .chat-welcome-example { color:rgb(182, 184, 190) }
    ${moduleThemePaletteCss(palette)}`
  document.head.append(style)
  document.body.innerHTML = `<main class="dsh-chat-surface"><section class="chat-welcome-examples">
    <button class="chat-welcome-examples-next">Try another set</button>
    <button class="chat-welcome-example">Example</button>
  </section></main>`
  const batch = document.querySelector('.chat-welcome-examples-next')!
  const example = document.querySelector('.chat-welcome-example')!
  expect(getComputedStyle(batch).color).toBe('rgb(182, 184, 190)')
  document.documentElement.dataset.bishengSurface = 'desktop'
  expect(getComputedStyle(batch).color).toBe(`rgb(${palette.labelSecondary.join(', ')})`)
  expect(getComputedStyle(example).color).toBe('rgb(182, 184, 190)')
})
