import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'
function setup() {
  let plugin
  const fetch = vi.fn(async () => Response.json({ ok: true }))
  vm.runInNewContext(readFileSync(new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8'), {
    fetch, window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } }
  })
  return { source: plugin.skillReferenceSource, fetch }
}
it('shows the readable skill label, serializes its identity, and validates enterprise selection', async () => {
  const { source, fetch } = setup()
  const ref = JSON.stringify({ name: 'bisheng-ab12-7', label: 'Excel 表格制作', enterprise: true })
  expect(source.codec.clipboardText(ref)).toBe('/Excel 表格制作')
  expect(source.openReference()).toBe(false)
  expect(await source.codec.serialize(ref)).toBe(' /bisheng-ab12-7 ')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operation: 'validate', names: ['bisheng-ab12-7'] })
  fetch.mockResolvedValueOnce(Response.json({ error: 'Skill disabled' }, { status: 400 }))
  await expect(source.codec.serialize(ref)).rejects.toThrow('Skill disabled')
})
it('keeps local skill selection usable while signed out', async () => {
  const { source, fetch } = setup()
  expect(await source.codec.serialize(JSON.stringify({ name: 'office', label: 'Office', enterprise: false }))).toBe(' /office ')
  expect(fetch).not.toHaveBeenCalled()
})
