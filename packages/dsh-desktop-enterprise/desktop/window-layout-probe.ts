import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Isolated world for a read-only host viewport sample. Chat uses 1001. */
export const WINDOW_LAYOUT_PROBE_WORLD = 1002
export const WINDOW_LAYOUT_MISMATCH_PX = 2
export const WINDOW_LAYOUT_SAMPLE_DELAYS_MS = [500, 2000] as const
export const WINDOW_LAYOUT_LOG_LIMIT_BYTES = 64 * 1024
export const WINDOW_LAYOUT_PROBE_EVENTS = ['resized', 'maximize', 'unmaximize', 'restore', 'show'] as const

export type WindowLayoutProbeEvent = (typeof WINDOW_LAYOUT_PROBE_EVENTS)[number]

export interface WindowLayoutMetrics {
  innerHeight?: number
  clientHeight?: number
  rootHeight?: number
  devicePixelRatio?: number
}

interface LayoutWebContents {
  isDestroyed(): boolean
  getZoomFactor(): number
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: ReadonlyArray<{ code: string }>): Promise<unknown>
}

/** The subset of BrowserWindow this probe listens to. */
export interface WindowLayoutTarget {
  isDestroyed(): boolean
  getContentSize(): readonly number[]
  getBounds(): { width?: number; height?: number }
  isMaximized(): boolean
  webContents: LayoutWebContents
  on(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
}

export interface WindowLayoutProbeOptions {
  window: WindowLayoutTarget
  delaysMs?: readonly number[]
  mismatchPx?: number
  now?: () => Date
  schedule?: (delayMs: number, task: () => void) => { cancel(): void }
  readScaleFactor?: () => number
  readMetrics?: () => Promise<WindowLayoutMetrics | undefined>
  writeLog?: (line: string) => void
}

interface WindowLayoutSample {
  at: string
  event: WindowLayoutProbeEvent
  sample: number
  contentWidth: number
  contentHeight: number
  boundsWidth: number
  boundsHeight: number
  maximized: boolean
  zoomFactor: number
  scaleFactor: number
  innerHeight: number
  clientHeight?: number
  rootHeight?: number
  devicePixelRatio?: number
  deltaContent?: number
  deltaRoot?: number
}

/** Read host viewport numbers only. The page URL and document text stay out. */
export function windowLayoutViewportScript(): string {
  return `(() => {
    try {
      const root = document.getElementById('root')
      const rect = root ? root.getBoundingClientRect() : null
      return {
        innerHeight: window.innerHeight,
        clientHeight: document.documentElement ? document.documentElement.clientHeight : undefined,
        rootHeight: rect ? rect.height : undefined,
        devicePixelRatio: window.devicePixelRatio
      }
    } catch {
      return null
    }
  })()`
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Every field is optional. A partial or non-object result is not a mismatch. */
export function parseWindowLayoutMetrics(value: unknown): WindowLayoutMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const metrics: WindowLayoutMetrics = {
    innerHeight: finiteNumber(record.innerHeight),
    clientHeight: finiteNumber(record.clientHeight),
    rootHeight: finiteNumber(record.rootHeight),
    devicePixelRatio: finiteNumber(record.devicePixelRatio)
  }
  if (metrics.innerHeight === undefined && metrics.clientHeight === undefined && metrics.rootHeight === undefined && metrics.devicePixelRatio === undefined) return undefined
  return metrics
}

function logNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'na'
  return String(Math.round(value * 1000) / 1000)
}

export function formatWindowLayoutLine(sample: WindowLayoutSample): string {
  return [
    sample.at,
    `event=${sample.event}`,
    `sample=${sample.sample}`,
    `content=${logNumber(sample.contentWidth)}x${logNumber(sample.contentHeight)}`,
    `bounds=${logNumber(sample.boundsWidth)}x${logNumber(sample.boundsHeight)}`,
    `maximized=${sample.maximized}`,
    `zoom=${logNumber(sample.zoomFactor)}`,
    `scale=${logNumber(sample.scaleFactor)}`,
    `inner=${logNumber(sample.innerHeight)}`,
    `client=${logNumber(sample.clientHeight)}`,
    `root=${logNumber(sample.rootHeight)}`,
    `dpr=${logNumber(sample.devicePixelRatio)}`,
    `deltaContent=${logNumber(sample.deltaContent)}`,
    `deltaRoot=${logNumber(sample.deltaRoot)}`
  ].join(' ')
}

/** Keep the newest whole lines inside the byte limit. */
export function capWindowLayoutLog(existing: string, line: string, limit = WINDOW_LAYOUT_LOG_LIMIT_BYTES): string {
  const normalized = line.endsWith('\n') ? line : `${line}\n`
  const combined = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n${normalized}` : `${existing}${normalized}`
  const bytes = Buffer.from(combined)
  if (bytes.length <= limit) return combined
  const tail = bytes.subarray(Math.max(0, bytes.length - limit)).toString('utf8')
  const newline = tail.indexOf('\n')
  const aligned = newline >= 0 && newline < tail.length - 1 ? tail.slice(newline + 1) : tail
  return aligned.endsWith('\n') ? aligned : `${aligned}\n`
}

export function appendWindowLayoutLog(filePath: string, line: string, limit = WINDOW_LAYOUT_LOG_LIMIT_BYTES): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    let existing = ''
    try {
      existing = readFileSync(filePath, 'utf8')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') throw error
    }
    writeFileSync(filePath, capWindowLayoutLog(existing, line, limit))
  } catch {
    // A diagnostic file must not affect the window if the disk is full or the directory is locked.
  }
}

function defaultSchedule(delayMs: number, task: () => void): { cancel(): void } {
  const timer = setTimeout(task, delayMs)
  timer.unref()
  return { cancel: () => clearTimeout(timer) }
}

async function readHostLayoutMetrics(window: WindowLayoutTarget): Promise<WindowLayoutMetrics | undefined> {
  const value: unknown = await window.webContents.executeJavaScriptInIsolatedWorld(WINDOW_LAYOUT_PROBE_WORLD, [{ code: windowLayoutViewportScript() }])
  return parseWindowLayoutMetrics(value)
}

function readHostFrame(window: WindowLayoutTarget): {
  contentWidth: number
  contentHeight: number
  boundsWidth: number
  boundsHeight: number
  maximized: boolean
  zoomFactor: number
} | undefined {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return undefined
    const content = window.getContentSize()
    const bounds = window.getBounds()
    const contentWidth = finiteNumber(content[0])
    const contentHeight = finiteNumber(content[1])
    const zoomFactor = finiteNumber(window.webContents.getZoomFactor())
    if (contentWidth === undefined || contentHeight === undefined || zoomFactor === undefined) return undefined
    return {
      contentWidth,
      contentHeight,
      boundsWidth: finiteNumber(bounds.width) ?? Number.NaN,
      boundsHeight: finiteNumber(bounds.height) ?? Number.NaN,
      maximized: window.isMaximized() === true,
      zoomFactor
    }
  } catch {
    return undefined
  }
}

function layoutLine(input: {
  event: WindowLayoutProbeEvent
  sample: number
  at: Date
  frame: NonNullable<ReturnType<typeof readHostFrame>>
  metrics: WindowLayoutMetrics | undefined
  scaleFactor: number
  mismatchPx: number
}): string | undefined {
  const innerHeight = input.metrics?.innerHeight
  if (innerHeight === undefined) return undefined
  const expectedContent = input.frame.zoomFactor > 0 ? innerHeight * input.frame.zoomFactor : undefined
  const deltaContent = expectedContent === undefined ? undefined : input.frame.contentHeight - expectedContent
  const deltaRoot = input.metrics?.rootHeight === undefined ? undefined : input.metrics.rootHeight - innerHeight
  const contentMismatch = deltaContent !== undefined && Math.abs(deltaContent) > input.mismatchPx
  const rootMismatch = deltaRoot !== undefined && Math.abs(deltaRoot) > input.mismatchPx
  if (!contentMismatch && !rootMismatch) return undefined
  return formatWindowLayoutLine({
    at: input.at.toISOString(),
    event: input.event,
    sample: input.sample,
    contentWidth: input.frame.contentWidth,
    contentHeight: input.frame.contentHeight,
    boundsWidth: input.frame.boundsWidth,
    boundsHeight: input.frame.boundsHeight,
    maximized: input.frame.maximized,
    zoomFactor: input.frame.zoomFactor,
    scaleFactor: input.scaleFactor,
    innerHeight,
    clientHeight: input.metrics?.clientHeight,
    rootHeight: input.metrics?.rootHeight,
    devicePixelRatio: input.metrics?.devicePixelRatio,
    deltaContent,
    deltaRoot
  })
}

/**
 * After a Windows resize ends, record when the host viewport stays off the window.
 * Matching sizes write nothing.
 */
export function startWindowLayoutProbe(options: WindowLayoutProbeOptions): { stop(): void } {
  const delays = options.delaysMs ?? WINDOW_LAYOUT_SAMPLE_DELAYS_MS
  const mismatchPx = options.mismatchPx ?? WINDOW_LAYOUT_MISMATCH_PX
  const schedule = options.schedule ?? defaultSchedule
  const readScaleFactor = options.readScaleFactor ?? (() => Number.NaN)
  const readMetrics = options.readMetrics ?? (() => readHostLayoutMetrics(options.window))
  const writeLog = options.writeLog ?? (() => {})
  const now = options.now ?? (() => new Date())
  const pending = new Set<{ cancel(): void }>()
  const listeners = new Map<string, () => void>()
  let stopped = false

  const sample = async (event: WindowLayoutProbeEvent, sampleIndex: number): Promise<void> => {
    if (stopped) return
    const frame = readHostFrame(options.window)
    if (!frame) return
    let metrics: WindowLayoutMetrics | undefined
    try {
      metrics = await readMetrics()
    } catch {
      return
    }
    if (stopped) return
    const latest = readHostFrame(options.window)
    if (!latest) return
    let scaleFactor = Number.NaN
    try { scaleFactor = readScaleFactor() } catch { scaleFactor = Number.NaN }
    const line = layoutLine({ event, sample: sampleIndex, at: now(), frame: latest, metrics, scaleFactor, mismatchPx })
    if (!line) return
    try { writeLog(line) } catch { /* Diagnostic output must not affect the window. */ }
  }

  const arm = (event: WindowLayoutProbeEvent): void => {
    if (stopped) return
    for (let index = 0; index < delays.length; index += 1) {
      const delay = delays[index]
      if (delay === undefined) continue
      const sampleIndex = index + 1
      const handle = schedule(delay, () => {
        pending.delete(handle)
        void sample(event, sampleIndex)
      })
      pending.add(handle)
    }
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    for (const handle of pending) handle.cancel()
    pending.clear()
    for (const [event, listener] of listeners) options.window.removeListener(event, listener)
    listeners.clear()
  }

  for (const event of WINDOW_LAYOUT_PROBE_EVENTS) {
    const listener = (): void => arm(event)
    listeners.set(event, listener)
    options.window.on(event, listener)
  }
  const onClosed = (): void => stop()
  listeners.set('closed', onClosed)
  options.window.on('closed', onClosed)
  return { stop }
}
