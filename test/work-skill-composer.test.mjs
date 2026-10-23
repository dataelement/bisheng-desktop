import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'
function setup() {
  let plugin
  const fetch = vi.fn(async () => Response.json({ ok: true }))
  vm.runInNewContext(readFileSync(new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8'), {
    fetch, window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } }
  })
  return { source: plugin.skillReferenceSource, plugin, fetch }
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

it('marks enterprise skill options with a compact office icon while preserving labels and descriptions', async () => {
  const { plugin, fetch } = setup()
  fetch.mockResolvedValueOnce(Response.json({ skills: [{ name: 'bisheng-ab12-7', displayName: 'Word 文档处理' }] }))
  const skills = [
    { name: 'bisheng-ab12-7', description: '创建、读取和编辑文档。' },
    { name: 'personal-writing', description: '个人写作技能。' }
  ]
  const commands = new Map()
  const ctx = {
    effect() {}, on() {},
    slots: { inject() {} },
    locale: { bind: () => key => key },
    remote: { skills: { list: async () => ({ ok: true, value: { skills } }) } },
    sessions: { using: async (_id, _options, run) => run() },
    commandUi: { register: command => commands.set(command.name, command) },
    inject: (_dependencies, install) => install(ctx)
  }
  plugin.apply(ctx)
  const options = await commands.get('skills').ui.options({ sessionId: 'task' }, new AbortController().signal)
  expect(options[0]).toMatchObject({ label: 'Word 文档处理', badge: '🏢', detail: skills[0].description })
  expect(JSON.parse(options[0].id)).toEqual({ name: 'bisheng-ab12-7', label: 'Word 文档处理', enterprise: true })
  expect(options[1]).toMatchObject({ label: 'personal-writing', detail: skills[1].description })
  expect(options[1].badge).toBeUndefined()
  expect(JSON.parse(options[1].id).enterprise).toBe(false)
})
