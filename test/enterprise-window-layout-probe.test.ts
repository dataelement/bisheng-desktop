import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WINDOW_LAYOUT_PROBE_WORLD,
  appendWindowLayoutLog,
  capWindowLayoutLog,
  parseWindowLayoutMetrics,
  startWindowLayoutProbe,
  windowLayoutViewportScript,
  type WindowLayoutMetrics,
  type WindowLayoutTarget
} from '../packages/dsh-desktop-enterprise/desktop/window-layout-probe'

interface ScheduledTask {
  delay: number
  task: () => void
  cancelled: boolean
}

function manualSchedule() {
  const tasks: ScheduledTask[] = []
  return {
    tasks,
    schedule(delay: number, task: () => void) {
      const item: ScheduledTask = { delay, task, cancelled: false }
      tasks.push(item)
      return { cancel() { item.cancelled = true } }
    },
    async run(delay: number) {
      const due = tasks.filter(item => item.delay === delay && !item.cancelled)
      for (const item of due) {
        item.cancelled = true
        await item.task()
      }
    }
  }
}

function layoutWindow(options: {
  content?: readonly number[]
  boundsHeight?: number
  zoom?: number
  maximized?: boolean
  metrics?: WindowLayoutMetrics | null
} = {}): EventEmitter & WindowLayoutTarget & { destroyed: boolean; execute: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter()
  const execute = vi.fn(async () => options.metrics === undefined ? { innerHeight: 800, clientHeight: 800, rootHeight: 800, devicePixelRatio: 1 } : options.metrics)
  const window = Object.assign(emitter, {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    getContentSize: () => options.content ?? [1100, 800],
    getBounds: () => ({ width: 1100, height: options.boundsHeight ?? 840 }),
    isMaximized: () => options.maximized === true,
    execute,
    webContents: {
      isDestroyed: () => window.destroyed,
      getZoomFactor: () => options.zoom ?? 1,
      executeJavaScriptInIsolatedWorld: execute
    }
  })
  return window
}

function probe(window: WindowLayoutTarget, writeLog: (line: string) => void, schedule = manualSchedule(), scale = 1.5) {
  const handle = startWindowLayoutProbe({
    window,
    schedule: schedule.schedule,
    readScaleFactor: () => scale,
    writeLog,
    now: () => new Date('2026-11-27T10:00:00.000Z')
  })
  return { ...handle, schedule }
}

describe('window layout probe', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('reads viewport numbers without the page url', () => {
    const script = windowLayoutViewportScript()
    expect(script).not.toMatch(/location|href|url/i)
    expect(parseWindowLayoutMetrics({ innerHeight: 700, clientHeight: 690, rootHeight: 680, devicePixelRatio: 1.25 })).toEqual({
      innerHeight: 700, clientHeight: 690, rootHeight: 680, devicePixelRatio: 1.25
    })
    expect(parseWindowLayoutMetrics({ innerHeight: Number.NaN, rootHeight: '640' })).toBeUndefined()
    expect(parseWindowLayoutMetrics(null)).toBeUndefined()
  })

  it('writes nothing when the host viewport matches the window', async () => {
    const lines: string[] = []
    const window = layoutWindow()
    const watched = probe(window, line => lines.push(line))
    window.emit('resized')
    await watched.schedule.run(500)
    await watched.schedule.run(2000)
    expect(lines).toEqual([])
    expect(window.execute).toHaveBeenCalledTimes(2)
    expect(window.execute).toHaveBeenCalledWith(WINDOW_LAYOUT_PROBE_WORLD, [{ code: expect.stringContaining("getElementById('root')") }])
  })

  it('writes each sample that stays short after the resize ends', async () => {
    const lines: string[] = []
    const window = layoutWindow({
      content: [1100, 900],
      metrics: { innerHeight: 800, clientHeight: 790, rootHeight: 640, devicePixelRatio: 1.25 }
    })
    const watched = probe(window, line => lines.push(line))
    window.emit('resized')
    await watched.schedule.run(500)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('event=resized sample=1')
    expect(lines[0]).toContain('content=1100x900')
    expect(lines[0]).toContain('inner=800')
    expect(lines[0]).toContain('root=640')
    expect(lines[0]).toContain('deltaContent=100')
    expect(lines[0]).toContain('deltaRoot=-160')
    expect(lines[0]).toContain('scale=1.5')
    expect(lines[0]).not.toMatch(/https?:|[/\\]Users[/\\]/)
    await watched.schedule.run(2000)
    expect(lines[1]).toContain('sample=2')
  })

  it('ignores a gap of 2px and reports a larger root-only gap', async () => {
    const lines: string[] = []
    const within = layoutWindow({ content: [1100, 802], metrics: { innerHeight: 800, rootHeight: 800 } })
    const quiet = probe(within, line => lines.push(line))
    within.emit('maximize')
    await quiet.schedule.run(500)
    expect(lines).toEqual([])

    const shortRoot = layoutWindow({ content: [1100, 800], metrics: { innerHeight: 800, rootHeight: 700 } })
    const noisy = probe(shortRoot, line => lines.push(line))
    shortRoot.emit('show')
    await noisy.schedule.run(500)
    expect(lines[0]).toContain('event=show sample=1')
    expect(lines[0]).toContain('deltaContent=0')
    expect(lines[0]).toContain('deltaRoot=-100')
  })

  it('does not sample after the window is destroyed or the probe stops', async () => {
    const lines: string[] = []
    const window = layoutWindow({ content: [1100, 900], metrics: { innerHeight: 700, rootHeight: 700 } })
    const watched = probe(window, line => lines.push(line))
    window.emit('restore')
    window.destroyed = true
    await watched.schedule.run(500)
    expect(window.execute).not.toHaveBeenCalled()
    expect(lines).toEqual([])

    window.destroyed = false
    window.emit('unmaximize')
    watched.stop()
    await watched.schedule.run(500)
    expect(window.execute).not.toHaveBeenCalled()
    window.emit('resized')
    expect(watched.schedule.tasks.filter(item => !item.cancelled)).toEqual([])
  })

  it('drops a sample that finishes after stop', async () => {
    const lines: string[] = []
    let release: (value: WindowLayoutMetrics) => void = () => {}
    const window = layoutWindow()
    window.execute.mockReturnValue(new Promise<WindowLayoutMetrics>(resolve => { release = resolve }))
    const watched = probe(window, line => lines.push(line))
    window.emit('resized')
    await watched.schedule.run(500)
    watched.stop()
    release({ innerHeight: 100, rootHeight: 100 })
    await Promise.resolve()
    expect(lines).toEqual([])
  })

  it('truncates the layout log to the newest lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'window-layout-'))
    directories.push(directory)
    const file = join(directory, 'logs', 'window-layout.log')
    const limit = 96
    appendWindowLayoutLog(file, 'event=resized sample=1 content=1x1 deltaContent=9', limit)
    expect(readFileSync(file, 'utf8')).toBe('event=resized sample=1 content=1x1 deltaContent=9\n')
    for (let index = 0; index < 8; index += 1) appendWindowLayoutLog(file, `event=show sample=2 marker=${index} content=1x1`, limit)
    const text = readFileSync(file, 'utf8')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(limit)
    expect(text.endsWith('marker=7 content=1x1\n')).toBe(true)
    expect(text).not.toContain('deltaContent=9')
    expect(text.startsWith('event=')).toBe(true)
    expect(capWindowLayoutLog('', 'plain')).toBe('plain\n')
  })
})
