// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { afterEach, expect, it } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const context = vm.createContext({ document })
vm.runInContext(source.slice(source.indexOf('function reserveSidebarResizeBounds('), source.indexOf('function DesktopModes(')), context)
const reserve = context.reserveSidebarResizeBounds

afterEach(() => document.body.replaceChildren())

function handleAt(edge, side = 'sidebar') {
  const handle = document.createElement('div')
  handle.dataset.side = side
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

it('keeps the full rightbar drag hit area outside native Chat as preview width changes', () => {
  const handle = handleAt(900, 'rightbar')
  for (const edge of [900, 820, 700, 950]) {
    handle.getBoundingClientRect = () => new DOMRect(edge - 4, 0, 8, 800)
    const bounds = reserve({ x: 280, y: 48, width: edge - 280, height: 752 })
    expect(bounds).toEqual({ x: 280, y: 48, width: edge - 284, height: 752 })
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(handle.getBoundingClientRect().left)
  }
})

it('reserves both handles together and rounds the right edge inward', () => {
  handleAt(280.25)
  handleAt(900.25, 'rightbar')
  expect(reserve({ x: 280.25, y: 48, width: 620, height: 752 }))
    .toEqual({ x: 285, y: 48, width: 611, height: 752 })
})

it('keeps unrelated and hidden rightbar handles from clipping settings surfaces', () => {
  const handle = handleAt(900, 'rightbar')
  for (const bounds of [
    { x: 280, y: 48, width: 500, height: 752 },
    { x: 280, y: 800, width: 620, height: 100 },
    { x: 0, y: 48, width: 1200, height: 752 }
  ]) expect(reserve(bounds)).toBe(bounds)
  handle.getBoundingClientRect = () => new DOMRect()
  const bounds = { x: 280, y: 48, width: 620, height: 752 }
  expect(reserve(bounds)).toBe(bounds)
})

it('also protects a rightbar native surface starting under its handle and clamps tiny seats', () => {
  handleAt(900, 'rightbar')
  expect(reserve({ x: 900, y: 48, width: 300, height: 752 }))
    .toEqual({ x: 904, y: 48, width: 296, height: 752 })
  expect(reserve({ x: 894, y: 48, width: 6, height: 752 }))
    .toEqual({ x: 894, y: 48, width: 2, height: 752 })
  expect(reserve({ x: 898, y: 48, width: 2, height: 752 }))
    .toEqual({ x: 900, y: 48, width: 0, height: 752 })
})

it('applies the clearance to the bounds sent to native presentation', () => {
  expect(source).toContain('const bounds = reserveSidebarResizeBounds(remote ? remote.bounds :')
})
