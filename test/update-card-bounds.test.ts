import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { updateCardMeasuredSize, updateCardOuterWidth, updateCardViewBounds } from '../src/shared/update-card-bounds'

describe('update card view bounds', () => {
  it('keeps the visual card inside the window with room for its shadow', () => {
    expect(updateCardOuterWidth()).toBe(448)
    expect(updateCardViewBounds({ width: 1200, height: 800 }, { width: 448, height: 180 })).toEqual({
      x: 752,
      y: 620,
      width: 448,
      height: 180
    })
  })

  it('uses a fallback size until the card document has been measured', () => {
    expect(updateCardMeasuredSize({ width: 0, height: 0 })).toEqual({ width: 448, height: 320 })
    expect(updateCardMeasuredSize({ width: 448, height: 180 })).toEqual({ width: 448, height: 180 })
  })

  it('loads the card preload beside the bundled main process', async () => {
    const source = await readFile(new URL('../src/main/update/update-card-view.ts', import.meta.url), 'utf8')
    expect(source).toContain("join(import.meta.dirname, '../preload/update-overlay.cjs')")
  })

  it('clips the view to the window when the card is larger than the content', () => {
    expect(updateCardViewBounds({ width: 200, height: 100 }, { width: 448, height: 180 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100
    })
  })
})
