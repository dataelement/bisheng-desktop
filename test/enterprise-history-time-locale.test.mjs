import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, it } from 'vitest'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives/src/relative-time.ts'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const copySource = source.slice(source.indexOf('const MODES_COPY'), source.indexOf('const PALETTE_TOKENS'))
const context = vm.createContext({})
vm.runInContext(`${copySource}\ncopy = MODES_COPY`, context)

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 27)

function translate(dict, key, params) {
  const template = dict[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match)
}

function ageLabel(dict, at) {
  const time = relativeTime(at, now)
  const age = translate(dict, `time.${time.unit}`, { n: time.n })
  const hover = time.unit === 'now' ? age : translate(dict, 'time.ago', { t: age })
  return { unit: time.unit, age, hover }
}

it('localizes cloud history relative time instead of showing translation keys', () => {
  const cases = [
    { at: now - 7 * DAY, unit: 'days', zh: '7天', en: '7d' },
    { at: now - 40 * DAY, unit: 'months', zh: '1个月', en: '1mo' },
    { at: now - 400 * DAY, unit: 'years', zh: '1年', en: '1y' }
  ]
  for (const item of cases) {
    const zh = ageLabel(context.copy.zh, item.at)
    const en = ageLabel(context.copy.en, item.at)
    expect(zh.unit).toBe(item.unit)
    expect(en.unit).toBe(item.unit)
    expect(zh.age).toBe(item.zh)
    expect(en.age).toBe(item.en)
    expect(zh.age).not.toBe(`time.${item.unit}`)
    expect(en.age).not.toBe(`time.${item.unit}`)
    expect(zh.hover).toBe(`${item.zh}前`)
    expect(en.hover).toBe(`${item.en} ago`)
  }
})
