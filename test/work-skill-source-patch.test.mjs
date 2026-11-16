import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

// The skill picker groups by the registry's discovery source, so the patched
// `skills/list` projection and both Typert result schemas must carry it through.
const LIB = new URL('../node_modules/@deepseek-ai/dsh-api-session-controller/lib/', import.meta.url)

// Execute the shipped projection rather than a duplicate mapper.
function shippedProjection() {
  const source = readFileSync(new URL('index.js', LIB), 'utf8')
  const start = source.indexOf('.map((skill) => ({', source.indexOf('.filter(isUserInvocable)'))
  const end = source.indexOf('}))', start) + 3
  if (start < 0 || end < start) throw new Error('Missing shipped skills/list projection')
  return vm.runInNewContext(`(skills => skills${source.slice(start, end)})`)
}

async function resultSchemas() {
  const isSkillList = value => typeof value?.typeSymbol === 'string' && value.typeSymbol.endsWith('#SkillListValue')
  const find = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return undefined
    if (isSkillList(value)) return value
    for (const child of Object.values(value)) { const hit = find(child, depth + 1); if (hit) return hit }
    return undefined
  }
  const { TYPERT } = await import(new URL('typert.host.js', LIB).href)
  const { TYPERT_REMOTE } = await import(new URL('typert.remote-client.js', LIB).href)
  return [['host', find(TYPERT)], ['remote', find(TYPERT_REMOTE)]]
}

const skill = { name: 'office-docx', description: 'Create Word documents', invocation: { modelInvocable: true, userInvocable: true }, source: 'bundled', provider: 'office', path: '/skills/office-docx/SKILL.md' }

it('projects each listed skill with its discovery source and nothing else new', () => {
  const [row] = shippedProjection()([skill])
  expect(row).toEqual({ name: 'office-docx', source: 'bundled', path: '/skills/office-docx/SKILL.md', description: 'Create Word documents', modelInvocable: true })
  expect(shippedProjection()([{ ...skill, source: undefined }])[0]).not.toHaveProperty('source')
})

it('keeps the source through both host and remote result validation', async () => {
  const value = { skills: [{ name: 'lark-doc', description: 'Lark docs', modelInvocable: false, source: 'user-agents' }] }
  for (const [side, schema] of await resultSchemas()) {
    expect(schema, side).toBeDefined()
    expect(schema.create().parse(value).skills[0].source, side).toBe('user-agents')
    // Older hosts omit the field; the result stays valid.
    expect(schema.create().parse({ skills: [{ name: 'lark-doc', description: 'Lark docs', modelInvocable: false }] }).skills[0], side).not.toHaveProperty('source')
  }
})
