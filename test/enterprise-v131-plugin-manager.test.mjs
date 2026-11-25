import { describe, expect, it } from 'vitest'
import { createManagedMarketSource } from '../packages/dsh-desktop-enterprise/managed-market.js'
const id = 'a'.repeat(32), key = 'b'.repeat(64)

describe('enterprise plugin display names', () => {
  const other = 'd'.repeat(32)
  function listed(installed) {
    return createManagedMarketSource({ state: () => ({ accountKey: key, installed }) }).listBundles()
  }

  it('shows the enterprise name while keeping the operation target', () => {
    const [row] = listed([{ plugin_id: id, name: 'company-demo', display_name: '  公司示例  ', description: '  内部报表  ', version: '1.0.0', status: 'enabled' }])
    expect(row).toMatchObject({
      name: `enterprise:${key}:${id}`,
      description: '内部报表',
      meta: { title: '公司示例', description: '内部报表' }
    })
    expect(row.meta.icon).toBeUndefined()
  })

  it('falls back to the package name and omits an empty description', () => {
    const [row] = listed([{ plugin_id: id, name: 'company-demo', description: '   ', version: '1.0.0', status: 'enabled' }])
    expect(row.meta).toEqual({ title: 'company-demo' })
    expect(row.description).toBeUndefined()
  })

  it('keeps the inventory when display fields are not strings', () => {
    const rows = listed([
      { plugin_id: id, name: 'company-demo', display_name: null, description: 12, version: '1.0.0', status: 'enabled' },
      { plugin_id: other, name: 'typed-badly', display_name: { zh: '对象' }, description: ['说明'], version: '1.0.0', status: 'disabled' }
    ])
    expect(rows.map(row => row.meta)).toEqual([{ title: 'company-demo' }, { title: 'typed-badly' }])
    expect(rows.map(row => row.description)).toEqual([undefined, undefined])
    expect(rows.map(row => row.name)).toEqual([`enterprise:${key}:${id}`, `enterprise:${key}:${other}`])
  })

  it('omits display metadata when neither name is usable', () => {
    const [row] = listed([{ plugin_id: id, name: '   ', display_name: 7, version: '1.0.0', status: 'enabled' }])
    expect(row.name).toBe(`enterprise:${key}:${id}`)
    expect(row.meta).toBeUndefined()
    expect(row.description).toBeUndefined()
  })
})
