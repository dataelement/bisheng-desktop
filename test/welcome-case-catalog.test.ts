import { describe, expect, it } from 'vitest'
import catalog from '../packages/dsh-desktop-office/welcome-cases.json'

describe('welcome case catalog', () => {
  for (const mode of ['chat', 'work'] as const) {
    it(`rotates through every ${mode} case without duplicate cards or identical adjacent batches`, () => {
      const ids = catalog[mode].map(item => item.id)
      const batches = catalog.batches[mode]
      expect(new Set(ids).size).toBe(ids.length)
      expect(new Set(batches.flat())).toEqual(new Set(ids))
      for (const [index, batch] of batches.entries()) {
        expect(new Set(batch).size).toBe(4)
        expect(new Set(batch)).not.toEqual(new Set(batches[(index + 1) % batches.length]))
      }
    })
  }

  it('includes a PPT task and different categories in every Work batch', () => {
    const work = new Map(catalog.work.map(item => [item.id, item]))
    for (const batch of catalog.batches.work) {
      const cases = batch.map(id => work.get(id))
      expect(cases.some(item => item?.officeMode === 'ppt')).toBe(true)
      expect(new Set(cases.map(item => item?.category)).size).toBe(4)
    }
  })

  it('puts both direct chat and research tasks in the first Chat batch', () => {
    const firstBatch = catalog.chat.filter(item => catalog.batches.chat[0]?.includes(item.id))
    expect(new Set(firstBatch.map(item => item.deepResearch))).toEqual(new Set([true, false]))
  })
})
