import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop preload bridge', () => {
  it('exposes each main-world API once', () => {
    const sources = ['../src/preload/index.ts', '../src/preload/enterprise-bridge.ts']
      .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
    const names = sources.flatMap(source => [...source.matchAll(/contextBridge\.exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]))
    expect(names.length).toBeGreaterThan(0)
    expect(names).toEqual([...new Set(names)])
  })
})
