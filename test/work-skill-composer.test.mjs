import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'
import React from 'react'
import { ReferenceIconRegular } from './helpers/reference-icons.mjs'
import { renderToStaticMarkup } from 'react-dom/server'

it('inserts skill and tool references with the menu icon kind and stable identity', () => {
  const { plugin } = setup()
  const commands = new Map()
  const input = { state: { getSnapshot: () => ({ draftRev: 4, occurrences: [] }) }, insertReference: vi.fn(() => true) }
  const scope = { bail: vi.fn() }
  const ctx = {
    effect() {}, on() {}, slots: { inject() {} }, locale: { bind: () => key => key },
    sessions: { scope: () => scope }, conversation: { input: { for: () => input } },
    commandUi: { register: command => commands.set(command.name, command) },
    inject: (_dependencies, install) => install(ctx)
  }
  plugin.apply(ctx)
  const options = [
    ['skills', 'skill', 'desktop-skill', JSON.stringify({ name: 'writing', label: 'Writing' })],
    ['tools', 'tool', 'desktop-tool', JSON.stringify({ name: 'mcp__bisheng__bisheng_tool_7', label: 'Time', connectionKey: 'account-a' })],
  ]
  for (const [name, appearance, source, id] of options) {
    const label = JSON.parse(id).label
    commands.get(name).ui.onSelect({ id, label }, { sessionId: 'task' })
    expect(input.insertReference).toHaveBeenLastCalledWith({ source, appearance, ref: id, label, clipboardText: `/${label}` }, { start: 0, end: 0, draftRev: 4 })
    const menu = renderToStaticMarkup(React.createElement(commands.get(name).icon))
    const reference = renderToStaticMarkup(React.createElement(ReferenceIconRegular, { kind: appearance, size: 16 }))
    expect(menu).toBe(reference)
  }
})
function setup() {
  let plugin
  const fetch = vi.fn(async () => Response.json({ ok: true }))
  vm.runInNewContext(readFileSync(new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8'), {
    fetch, window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(name => name === 'react' ? React : { ReferenceIconRegular }) } } }
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

it('marks enterprise skill options with the existing skill icon while preserving labels and descriptions', async () => {
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
  expect(options[0]).toMatchObject({ label: 'Word 文档处理', detail: skills[0].description })
  const icon = renderToStaticMarkup(React.createElement(options[0].badgeIcon))
  const menuIcon = renderToStaticMarkup(React.createElement(commands.get('skills').icon))
  expect(icon.match(/<path[^>]+d="([^"]+)"/)[1]).toBe(menuIcon.match(/<path[^>]+d="([^"]+)"/)[1])
  expect(icon).toContain('width="12"')
  expect(options[0].badge).toBeUndefined()
  expect(JSON.parse(options[0].id)).toEqual({ name: 'bisheng-ab12-7', label: 'Word 文档处理', enterprise: true })
  expect(options[1]).toMatchObject({ label: 'personal-writing', detail: skills[1].description })
  expect(options[1].badgeIcon).toBeUndefined()
  expect(JSON.parse(options[1].id).enterprise).toBe(false)
})

// Group order is own uploads, then organization and client-bundled skills, then this computer.
it.each([
  ['zh', ['我上传的 (1)', '企业提供 (3)', '本地安装 (3)']],
  ['en', ['Uploaded by you (1)', 'Provided by your organization (3)', 'Installed locally (3)']]
])('groups skill options by where they come from in %s', async (language, headings) => {
  const { plugin, fetch } = setup()
  fetch.mockResolvedValueOnce(Response.json({ skills: [
    { name: 'bisheng-ab12-7', displayName: 'Word 文档处理', uploaded: false },
    { name: 'bisheng-ab12-8', displayName: '我的周报', uploaded: true },
    { name: 'bisheng-ab12-9', displayName: '旧平台技能' }
  ] }))
  const skills = [
    { name: 'lark-doc', description: 'Installed in ~/.agents/skills.', source: 'user-agents' },
    { name: 'bisheng-ab12-7', description: 'Published by the organization.', source: 'bisheng' },
    { name: 'office-docx', description: 'Bundled with the client.', source: 'bundled' },
    { name: 'repo-helper', description: 'Inside the workspace.', source: 'project-agents' },
    { name: 'bisheng-ab12-8', description: 'Uploaded by this user.', source: 'bisheng' },
    { name: 'legacy-local', description: 'Listed without a source.' },
    { name: 'bisheng-ab12-9', description: 'From a platform without upload markers.', source: 'bisheng' }
  ]
  const commands = new Map(), dictionaries = new Map()
  const ctx = {
    effect(run, label) { if (label === 'desktop Work resources locale') run() }, on() {},
    slots: { inject() {} },
    locale: {
      register: (ns, dictionary) => { dictionaries.set(ns, dictionary) },
      bind: ns => (key, args = {}) => dictionaries.get(ns)[language][key].replace(/\{(\w+)\}/g, (_, name) => String(args[name]))
    },
    remote: { skills: { list: async () => ({ ok: true, value: { skills } }) } },
    sessions: { using: async (_id, _options, run) => run() },
    commandUi: { register: command => commands.set(command.name, command) },
    inject: (_dependencies, install) => install(ctx)
  }
  plugin.apply(ctx)
  const options = await commands.get('skills').ui.options({ sessionId: 'task' }, new AbortController().signal)
  expect(options.map(option => [option.group.name, option.label])).toEqual([
    ['uploaded', '我的周报'],
    // Published skills first, then the client's bundled ones, each in registry order.
    ['provided', 'Word 文档处理'], ['provided', '旧平台技能'], ['provided', 'office-docx'],
    ['local', 'lark-doc'], ['local', 'repo-helper'], ['local', 'legacy-local']
  ])
  expect([...new Map(options.map(option => [option.group.name, option.group.label])).values()]).toEqual(headings)
  // Grouping does not change what a selection inserts.
  expect(JSON.parse(options[0].id)).toEqual({ name: 'bisheng-ab12-8', label: '我的周报', enterprise: true })
  expect(JSON.parse(options[3].id)).toEqual({ name: 'office-docx', label: 'office-docx', enterprise: false })
})
