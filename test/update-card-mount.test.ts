// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/contracts'
import type { UpdateCardLayout } from '../src/preload/update-card-mount'

const invoke = vi.hoisted(() => vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

import { mountUpdateCard } from '../src/preload/update-card-mount'

const status = (phase: UpdateStatus['phase'], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase,
  currentVersion: '1.0.0',
  manual: false,
  ...extra
})

function mount() {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  const roots = new Map<Element, ShadowRoot>()
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const shadow = original.call(this, init)
    roots.set(this, shadow)
    return shadow
  })
  const layouts: UpdateCardLayout[] = []
  const card = mountUpdateCard(document, layout => { layouts.push(layout) })
  const host = document.getElementById('dsh-desktop-update-card')
  if (!host) throw new Error('update card host was not mounted')
  const shadow = roots.get(host)
  if (!shadow) throw new Error('update card shadow root was not captured')
  return { card, host, shadow, layouts }
}

function buttonNamed(shadow: ShadowRoot, label: string): HTMLButtonElement {
  const button = Array.from(shadow.querySelectorAll('button')).find(node => node.textContent === label)
  if (!button) throw new Error(`missing button ${label}`)
  return button
}

/** Skip's rejection is handled on the promise after `.then`, so one turn is not enough. */
async function flushSkip(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  document.body.replaceChildren()
  invoke.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('update card skip button', () => {
  it.each(['available', 'downloaded'] as const)('reenables skip after a failed %s request', async phase => {
    invoke.mockRejectedValueOnce(new Error('skip failed'))
    const { card, shadow } = mount()
    card.applyStatus(status(phase, { availableVersion: '1.2.0' }))
    const skip = buttonNamed(shadow, '跳过此版本')
    expect(skip.disabled).toBe(false)
    skip.click()
    expect(skip.disabled).toBe(true)
    await flushSkip()
    expect(skip.disabled).toBe(false)
    expect(invoke).toHaveBeenCalledWith('updates:skip', '1.2.0')
    invoke.mockRejectedValueOnce(new Error('skip failed again'))
    skip.click()
    await flushSkip()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(skip.disabled).toBe(false)
  })

  it('reenables skip when the reply is still an open offer', async () => {
    const offered = status('available', { availableVersion: '1.2.0' })
    invoke.mockResolvedValue(offered)
    const { card, host, shadow } = mount()
    card.applyStatus(offered)
    buttonNamed(shadow, '跳过此版本').click()
    await Promise.resolve()
    expect(host.style.display).toBe('block')
    expect(buttonNamed(shadow, '跳过此版本').disabled).toBe(false)
  })

  it('keeps skip disabled when the reply is still downloading', async () => {
    invoke.mockResolvedValue(status('downloading', { availableVersion: '1.2.0', percent: 12 }))
    const { card, shadow } = mount()
    card.applyStatus(status('available', { availableVersion: '1.2.0' }))
    buttonNamed(shadow, '跳过此版本').click()
    await Promise.resolve()
    const skip = buttonNamed(shadow, '跳过此版本')
    expect(skip.disabled).toBe(true)
    expect(shadow.querySelector('[role="progressbar"]')).not.toBeNull()
    skip.click()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('hides the card after the main process accepts the skip', async () => {
    invoke.mockResolvedValue(status('idle'))
    const { card, host, shadow } = mount()
    card.applyStatus(status('downloaded', { availableVersion: '1.2.0' }))
    buttonNamed(shadow, '跳过此版本').click()
    await Promise.resolve()
    expect(host.style.display).toBe('none')
  })
})
