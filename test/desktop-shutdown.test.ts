import { describe, expect, it } from 'vitest'
import { settleDesktopShutdown } from '../src/main/desktop-shutdown'

describe('desktop shutdown', () => {
  it('waits for all components and reports only sanitized failures', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let finished = false
    const result = settleDesktopShutdown([
      { name: 'runtime', stop: () => { throw new Error('secret') } },
      { name: 'mobile', stop: async () => { await gate; finished = true } },
      { name: 'extensions', stop: async () => { throw new AggregateError([new Error('credential')]) } }
    ])
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    expect(await result).toEqual([
      { component: 'runtime', category: 'error' },
      { component: 'extensions', category: 'aggregate' }
    ])
    expect(finished).toBe(true)
  })
})
