// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const motion = source.slice(source.indexOf('function animateWorkLanding('), source.indexOf('function DesktopModes('))
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
function fixture(reduced = false) {
  document.body.innerHTML = `<main><section data-content-phase="hero"><header><i data-slot="conversation.hero.brand.mark"></i><span><span><span data-slot="conversation.hero.brand.title">Brand</span></span><span>Preview</span></span></header><nav><span data-slot="conversation.hero.workspace"></span><button>Mode</button></nav><div data-composer-card></div></section></main>`
  const work = document.querySelector('main'), title = work.querySelector('header'), controls = work.querySelector('nav'), card = work.querySelector('[data-composer-card]')
  const rect = (y, height, width = 600) => ({ x: 0, y, width, height, bottom: y + height, right: width })
  work.getBoundingClientRect = () => rect(0, 800)
  title.getBoundingClientRect = () => rect(200, 40)
  controls.getBoundingClientRect = () => rect(260, 40)
  card.getBoundingClientRect = () => rect(310, 120)
  const animations = []
  for (const el of [title, controls, card]) el.animate = vi.fn(() => {
    const animation = { finished: Promise.resolve(), cancel: vi.fn(), pause: vi.fn(), play: vi.fn() }
    animations.push(animation)
    return animation
  })
  const context = vm.createContext({ document, LANDING_MORPH_DURATION: 300, LANDING_MORPH_EASING: 'ease', landingMotionAllowed: () => !reduced, animateLandingFooter: () => {} })
  vm.runInContext(motion, context)
  return { work, controls, card, title, animations, run: () => context.animateWorkLanding(work, { to: 'work', chat: { seat: rect(0, 800), title: rect(240, 40), composer: rect(300, 120) } }) }
}
it('animates the rc.5 workspace row and shared brand headline without legacy markers', async () => {
  const f = fixture(), result = f.run()
  expect(result).toBeDefined()
  expect(f.controls.animate).toHaveBeenCalledTimes(1)
  expect(f.title.animate).toHaveBeenCalledTimes(1)
  expect(f.card.animate).toHaveBeenCalledTimes(1)
  result.play()
  await result.finished
  result.dispose()
  expect(f.work.querySelector('[data-dsh-landing-morph-placeholder]')).toBeNull()
  expect(f.card.hasAttribute('data-dsh-landing-morph-card')).toBe(false)
  expect(f.animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
})
it('does not animate when reduced motion is requested or the workspace row is absent', () => {
  const reduced = fixture(true)
  expect(reduced.run()).toBeUndefined()
  expect(reduced.card.animate).not.toHaveBeenCalled()
  const missing = fixture()
  missing.controls.remove()
  expect(missing.run()).toBeUndefined()
  expect(missing.card.animate).not.toHaveBeenCalled()
})
it('hides only the default badge beside the enterprise title', () => {
  fixture()
  const selector = source.match(/(\.dshWorkContent \[data-content-phase="hero"\] span:has\(> \[data-slot="conversation.hero.brand.title"\]\) \+ span) \{display:none\}/)[1]
  document.querySelector('main').className = 'dshWorkContent'
  expect([...document.querySelectorAll(selector)].map(el => el.textContent)).toEqual(['Preview'])
})

it('keeps both Office and enterprise case anchors on the stationary morph placeholder', async () => {
  const cases = await readFile('packages/dsh-desktop-enterprise/welcome-cases-client.js', 'utf8')
  const anchor = cases.match(/position-anchor:\s*(--[\w-]+);/)[1]
  const placeholderRule = source.match(/\[data-dsh-landing-morph-placeholder\]\{([^}]+)\}/)[1]
  expect(placeholderRule).toContain(anchor)
  expect(placeholderRule).toContain('--dso-hero-composer')
  const f = fixture()
  const grid = document.createElement('div')
  grid.className = 'bsw-quick-grid'
  f.work.querySelector('section').append(grid)
  grid.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, pause() {}, play() {} }))
  const context = vm.createContext({ document, LANDING_MORPH_DURATION: 300, LANDING_MORPH_EASING: 'ease', landingMotionAllowed: () => true, animateLandingFooter: () => {} })
  vm.runInContext(motion, context)
  const result = context.animateWorkLanding(f.work, { to: 'chat', chat: {
    seat: f.work.getBoundingClientRect(), title: f.title.getBoundingClientRect(), composer: f.card.getBoundingClientRect()
  } })
  expect(grid.animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.objectContaining({ fill: 'both' }))
  result.dispose()
})
