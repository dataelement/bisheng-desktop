import { expect, it, vi } from 'vitest'
import { createEarlyLinks } from '../src/main/early-links'
import { sameHarnessOrigin } from '../src/main/enterprise/harness-origin'

it('registers early links before the single-instance lock and delivers a queued argv link only to the Harness origin', async () => {
  const order: string[] = []
  let resolveArgv: (value: { url: string }) => void = () => undefined
  const pending = new Promise<{ url: string }>(resolve => { resolveArgv = resolve })
  const send = vi.fn()
  let current = 'file:///splash.html'
  let open: (url: string) => void = () => undefined
  const links = createEarlyLinks({
    registerProtocol: () => { order.push('protocol') },
    fromArgv: () => { order.push('argv'); return pending },
    parse: async value => ({ url: value }),
    sameOrigin: sameHarnessOrigin
  }, () => ({ current, expected: 'http://127.0.0.1:43126/', send }))
  expect(links.start(['app'], handler => { order.push('open-url'); open = handler }, () => { order.push('lock'); return true })).toBe(true)
  expect(order).toEqual(['protocol', 'argv', 'open-url', 'lock'])
  resolveArgv({ url: 'bisheng://login?code=one' })
  await pending
  await Promise.resolve()
  expect(send).not.toHaveBeenCalled()
  current = 'http://127.0.0.1:43127/chat'
  links.deliver()
  expect(send).not.toHaveBeenCalled()
  current = 'http://127.0.0.1:43126/chat'
  links.deliver()
  links.deliver()
  expect(send).toHaveBeenCalledExactlyOnceWith('bisheng://login?code=one')
  open('bisheng://login?code=two')
  await Promise.resolve()
  expect(send).toHaveBeenLastCalledWith('bisheng://login?code=two')
})

it('rejects invalid open-url links without replacing the queued link and parses second-instance links', async () => {
  let open: (url: string) => void = () => undefined
  let ready = false
  const send = vi.fn()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const parse = vi.fn(async (value: string) => {
    if (value === 'invalid') throw new Error('invalid link')
    return { url: value }
  })
  const links = createEarlyLinks({
    registerProtocol: () => undefined,
    fromArgv: async argv => argv[0] === 'second' ? { url: 'bisheng://login?code=second' } : { url: 'bisheng://login?code=first' },
    parse, sameOrigin: sameHarnessOrigin
  }, () => ready ? { current: 'http://127.0.0.1:1/chat', expected: 'http://127.0.0.1:1/', send } : undefined)
  try {
    links.start(['first'], handler => { open = handler }, () => true)
    await Promise.resolve()
    open('invalid')
    await Promise.resolve()
    ready = true
    links.deliver()
    expect(send).toHaveBeenCalledExactlyOnceWith('bisheng://login?code=first')
    links.secondInstance(['second'])
    await Promise.resolve()
    await Promise.resolve()
    expect(parse).toHaveBeenCalledWith('bisheng://login?code=second')
    expect(send).toHaveBeenLastCalledWith('bisheng://login?code=second')
    expect(warning).toHaveBeenCalledOnce()
  } finally { warning.mockRestore() }
})

it('returns a failed single-instance lock after installing early listeners', () => {
  const order: string[] = []
  const links = createEarlyLinks({
    registerProtocol: () => { order.push('protocol') },
    fromArgv: async () => { order.push('argv'); return undefined },
    parse: async url => ({ url }), sameOrigin: () => false
  }, () => undefined)
  expect(links.start([], () => { order.push('open-url') }, () => { order.push('lock'); return false })).toBe(false)
  expect(order).toEqual(['protocol', 'argv', 'open-url', 'lock'])
})
