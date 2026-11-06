import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { runProductProfileMaintenance } from '../src/main/product-profile-maintenance'

it('awaits a neutral product task and forwards its context and failures', async () => {
  const events: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const note = vi.fn()
  const task = vi.fn(async (context: { dshHome: string; note: (line: string) => void }) => {
    expect(context).toEqual({ dshHome: '/neutral/profile', note })
    events.push('task-start')
    await gate
    events.push('task-end')
  })
  const operation = runProductProfileMaintenance(task, '/neutral/profile', note, async () => { events.push('refresh') }).then(() => { events.push('next') })
  await Promise.resolve()
  expect(events).toEqual(['refresh', 'task-start'])
  release?.()
  await operation
  expect(events).toEqual(['refresh', 'task-start', 'task-end', 'next'])
  const failure = new Error('failed')
  await expect(runProductProfileMaintenance(async () => { throw failure }, '/neutral/profile', note, async () => {})).rejects.toBe(failure)
})

it('places the product task after the recovery gate and before preset migrations', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const launch = source.slice(source.indexOf('function launchHarness()'), source.indexOf('function launchSafeHarness()'))
  expect(launch.indexOf("maintenance.outcome === 'safe-recovery'")).toBeLessThan(launch.indexOf('await runProductProfileMaintenance('))
  expect(launch).toContain('() => refreshMigrationRecoveryLock(dshHome)')
  expect(launch.indexOf('await runProductProfileMaintenance(')).toBeLessThan(launch.indexOf('await migratePersonaPrefixesBeforeStart(dshHome)'))
  expect(launch).toMatch(/maintenance.outcome === 'safe-recovery'[\s\S]*?return[\s\S]*?await runProductProfileMaintenance/)
})
