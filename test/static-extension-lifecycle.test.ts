import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startEnterpriseDesktop } from '../src/main/enterprise/enterprise-desktop'
import { ENTERPRISE_BROKER_URL_ENV } from '../src/main/enterprise/credential-broker'
import { createEnterpriseFetch } from '../src/main/enterprise/platform-fetch'

vi.mock('../src/main/enterprise/workbench-artifact', () => ({ sweepWorkbenchVerifyDirectory: async () => undefined }))
import { StaticExtensionLifecycle } from '../src/main/static-extension-lifecycle'

describe('trusted static extension lifecycle', () => {
  it('starts and releases the real enterprise broker through the lifecycle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'static-extension-'))
    const lifecycle = new StaticExtensionLifecycle()
    try {
      let brokerUrl: string | undefined
      await lifecycle.start([async (dispose) => {
        const desktop = await startEnterpriseDesktop({
          userDataPath: directory,
          safeStorage: {
            isEncryptionAvailable: () => true,
            getSelectedStorageBackend: () => 'keychain',
            encryptString: (value) => Buffer.from(value),
            decryptString: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString()
          },
          fetchImpl: createEnterpriseFetch(globalThis.fetch),
          allowInsecureLoopback: true
        })
        dispose(() => desktop.stop())
        brokerUrl = desktop.harnessEnvironment()[ENTERPRISE_BROKER_URL_ENV]
      }])
      expect(brokerUrl).toBeTruthy()
      if (!brokerUrl) throw new Error('Enterprise broker did not start')
      const response = await fetch(brokerUrl)
      expect(response.status).toBeGreaterThanOrEqual(400)
      await lifecycle.stop()
      await expect(fetch(brokerUrl)).rejects.toThrow()
    } finally {
      await lifecycle.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('starts in order and stops once in reverse order, even after a cleanup failure', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    await lifecycle.start([
      (dispose) => { events.push('start a'); dispose(() => { events.push('stop a') }) },
      (dispose) => { events.push('start b'); dispose(() => { events.push('stop b'); throw new Error('cleanup b') }) }
    ])
    const first = lifecycle.stop()
    expect(lifecycle.stop()).toBe(first)
    await expect(first).rejects.toThrow('Extension cleanup failed')
    expect(events).toEqual(['start a', 'start b', 'stop b', 'stop a'])
  })

  it('retries only failed disposers and shares concurrent stop attempts', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    let attempt = 0
    await lifecycle.start([
      (dispose) => { dispose(() => { events.push('a') }) },
      (dispose) => { dispose(() => { events.push('b'); if (++attempt === 1) throw new Error('temporary') }) }
    ])
    const first = lifecycle.stop()
    expect(lifecycle.stop()).toBe(first)
    await expect(first).rejects.toThrow('Extension cleanup failed')
    const retry = lifecycle.stop()
    expect(lifecycle.stop()).toBe(retry)
    await retry
    await lifecycle.stop()
    expect(events).toEqual(['b', 'a', 'b'])
  })

  it('cleans partially started extensions and preserves the startup error', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    const failure = new Error('startup')
    await expect(lifecycle.start([
      (dispose) => { dispose(() => { events.push('a') }) },
      (dispose) => { dispose(() => { events.push('b') }); throw failure }
    ])).rejects.toBe(failure)
    await lifecycle.stop()
    expect(events).toEqual(['b', 'a'])
  })

  it('preserves startup and cleanup failures', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const startup = new Error('startup')
    const cleanup = new Error('cleanup')
    const result = lifecycle.start([(dispose) => {
      dispose(() => { throw cleanup })
      throw startup
    }])
    await expect(result).rejects.toMatchObject({ errors: [startup, expect.objectContaining({ errors: [cleanup] })] })
  })

  it('waits for startup when an extension synchronously requests stop', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    let stopping: Promise<void> | undefined
    await lifecycle.start([(dispose) => {
      stopping = lifecycle.stop()
      dispose(() => { events.push('disposed') })
    }])
    await stopping
    expect(events).toEqual(['disposed'])
  })

  it('does not create downstream resources when shutdown interrupts startup', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    let resume: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { resume = resolve })
    let entered: () => void = () => undefined
    const enteredSecond = new Promise<void>((resolve) => { entered = resolve })
    const bootstrap = (async () => {
      await lifecycle.start([
        (dispose) => { events.push('first started'); dispose(() => { events.push('first stopped') }) },
        async (dispose) => {
          entered()
          await gate
          events.push('second started')
          dispose(() => { events.push('second stopped') })
        }
      ])
      if (!lifecycle.runIfNotStopped(() => { events.push('view created') })) return
      events.push('mobile and runtime started')
    })()
    await enteredSecond
    const stopped = lifecycle.stop()
    resume()
    await Promise.all([bootstrap, stopped])
    expect(events).toEqual(['first started', 'second started', 'second stopped', 'first stopped'])
  })

  it('does not start later extensions after stop is requested', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    let resume: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { resume = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const start = lifecycle.start([
      async (dispose) => {
        entered()
        await gate
        dispose(() => { events.push('disposed') })
      },
      () => { events.push('unexpected start') }
    ])
    await started
    const stop = lifecycle.stop()
    resume()
    await Promise.all([start, stop])
    expect(events).toEqual(['disposed'])
  })

  it('waits for an in-flight start before stopping', async () => {
    const lifecycle = new StaticExtensionLifecycle()
    const events: string[] = []
    let resume: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { resume = resolve })
    const start = lifecycle.start([async (dispose) => {
      await gate
      events.push('started')
      dispose(() => { events.push('stopped') })
    }])
    await Promise.resolve()
    const stop = lifecycle.stop()
    expect(events).toEqual([])
    resume()
    await Promise.all([start, stop])
    expect(events).toEqual(['started', 'stopped'])
    await lifecycle.stop()
    expect(events).toEqual(['started', 'stopped'])
    await expect(lifecycle.start([])).rejects.toThrow('Extensions have already stopped')
  })
})
