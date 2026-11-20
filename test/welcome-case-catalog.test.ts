import { describe, expect, it } from 'vitest'
import catalog from '../packages/dsh-desktop-office/welcome-cases.json'

describe('Work welcome case catalog', () => {
  it('rotates through every Work case without duplicate cards or identical adjacent batches', () => {
    const ids = catalog.work.map(item => item.id)
    const batches = catalog.batches.work
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(batches.flat())).toEqual(new Set(ids))
    for (const [index, batch] of batches.entries()) {
      expect(new Set(batch).size).toBe(4)
      expect(new Set(batch)).not.toEqual(new Set(batches[(index + 1) % batches.length]))
    }
  })

  it('includes a PPT task and different categories in every Work batch', () => {
    const work = new Map(catalog.work.map(item => [item.id, item]))
    for (const batch of catalog.batches.work) {
      const cases = batch.map(id => work.get(id))
      expect(cases.some(item => item?.officeMode === 'ppt')).toBe(true)
      expect(new Set(cases.map(item => item?.category)).size).toBe(4)
    }
  })
})
