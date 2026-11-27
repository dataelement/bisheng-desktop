// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { afterEach, expect, it } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const context = vm.createContext({ document })
vm.runInContext(source.slice(source.indexOf('function reserveSidebarResizeBounds('), source.indexOf('function DesktopModes(')), context)
const reserve = context.reserveSidebarResizeBounds

afterEach(() => document.body.replaceChildren())

function handleAt(edge) {
  const handle = document.createElement('div')
  handle.dataset.side = 'sidebar'
  handle.getBoundingClientRect = () => new DOMRect(edge - 4, 0, 8, 800)
  document.body.append(handle)
  return handle
}

it('keeps the full sidebar drag hit area outside the native Chat view while resizing', () => {
  const handle = handleAt(280)
  for (const edge of [280, 320, 420, 264]) {
    handle.getBoundingClientRect = () => new DOMRect(edge - 4, 0, 8, 800)
    const bounds = reserve({ x: edge, y: 48, width: 1200 - edge, height: 752 })
    expect(bounds).toEqual({ x: edge + 4, y: 48, width: 1196 - edge, height: 752 })
    expect(bounds.x).toBeGreaterThanOrEqual(handle.getBoundingClientRect().right)
    expect(bounds.x + bounds.width).toBe(1200)
  }
})

it('rounds the native edge outward for fractional renderer coordinates', () => {
  handleAt(280.25)
  expect(reserve({ x: 280.25, y: 48, width: 919.75, height: 752 }))
    .toEqual({ x: 285, y: 48, width: 915, height: 752 })
})

it('preserves collapsed and drawer layouts with no handle, and zero-size hidden handles', () => {
  const bounds = { x: 0, y: 48, width: 1200, height: 752 }
  expect(reserve(bounds)).toBe(bounds)
  const handle = handleAt(280)
  handle.getBoundingClientRect = () => new DOMRect()
  expect(reserve(bounds)).toBe(bounds)
})

it('leaves non-overlapping settings surfaces alone and clamps tiny surfaces', () => {
  handleAt(280)
  for (const bounds of [
    { x: 400, y: 48, width: 800, height: 752 },
    { x: 280, y: 800, width: 920, height: 100 },
    { x: 0, y: 48, width: 1200, height: 752 }
  ]) expect(reserve(bounds)).toBe(bounds)
  expect(reserve({ x: 280, y: 48, width: 2, height: 752 }))
    .toEqual({ x: 282, y: 48, width: 0, height: 752 })
})

it('applies the clearance to the bounds sent to native presentation', () => {
  expect(source).toContain('const bounds = reserveSidebarResizeBounds(remote ? remote.bounds :')
})
