import { afterEach, expect, it, vi } from 'vitest'
import { ChatDialogBacking } from '../src/main/enterprise/chat-dialog-backing'

const frame = { dataURL: 'data:image/png;base64,fixture', bounds: { x: 240, y: 40, width: 800, height: 700 } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
function fixture() {
  const execute = vi.fn(async (_script: string): Promise<unknown> => true)
  const owner = { isDestroyed: () => false, webContents: { isDestroyed: () => false, executeJavaScript: execute } }
  const capture = vi.fn(async () => frame)
  const paint = vi.fn(async (): Promise<unknown> => undefined)
  const note = vi.fn()
  const backing = new ChatDialogBacking(owner, capture, paint, note)
  return { execute, capture, paint, note, backing }
}
afterEach(() => vi.useRealTimers())

it('holds owner pixels through the first replacement frame and then releases them', async () => {
  const f = fixture()
  await f.backing.hold()
  expect(f.execute).toHaveBeenCalledWith(expect.stringContaining(frame.dataURL))
  const painted = deferred<unknown>()
  f.paint.mockReturnValue(painted.promise)
  const releasing = f.backing.release()
  expect(f.execute).toHaveBeenCalledTimes(1)
  painted.resolve(undefined)
  await releasing
  expect(f.execute).toHaveBeenLastCalledWith(expect.stringContaining('delete window[key]'))
})

it('does not clear a new hold when an earlier closing paint arrives late', async () => {
  const f = fixture()
  await f.backing.hold()
  const painted = deferred<unknown>()
  f.paint.mockReturnValue(painted.promise)
  const releasing = f.backing.release()
  await f.backing.hold()
  painted.resolve(undefined)
  await releasing
  expect(f.execute).toHaveBeenCalledTimes(2)
  expect(f.execute.mock.lastCall?.[0]).toContain(frame.dataURL)
})

it('discards snapshots completed after navigation or logout', async () => {
  const f = fixture()
  const snapshot = deferred<typeof frame>()
  f.capture.mockReturnValue(snapshot.promise)
  const holding = f.backing.hold()
  f.backing.dispose()
  snapshot.resolve(frame)
  await holding
  expect(f.execute.mock.calls.some(([script]) => script.includes(frame.dataURL))).toBe(false)
})

it('bounds failed owner delivery and cleanup without leaving a pending modal', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.execute.mockReturnValue(new Promise(() => {}))
  const holding = f.backing.hold()
  await flush()
  await vi.advanceTimersByTimeAsync(1501)
  await holding
  expect(f.note).toHaveBeenCalledWith(expect.stringContaining('dialog_backing_failed'))
  expect(f.note).toHaveBeenCalledWith(expect.stringContaining('dialog_backing_cleanup_failed'))
  expect(vi.getTimerCount()).toBe(0)
})
