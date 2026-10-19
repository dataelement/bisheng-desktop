import { describe, expect, it } from 'vitest'
import { MODULE_ROUTE_PATTERN, MODULE_THEME_CSS, darkDeclaration, moduleThemeScript } from '../src/main/enterprise/chat-module-theme'

describe('enterprise module page theme', () => {
  it('matches module routes but never conversation routes', () => {
    const route = new RegExp(MODULE_ROUTE_PATTERN, 'u')
    for (const path of ['/workspace/knowledge', '/workspace/knowledge/space-1', '/workspace/channel?x=1', '/workspace/channel/abc/settings', '/workspace/apps', '/workspace/apps/explore', '/workspace/skills', '/workspace/square?type=apps']) expect(route.test(path)).toBe(true)
    for (const path of ['/workspace/c/new', '/workspace/chat/1/2/3', '/workspace/linsight/x', '/workspace/knowledgebase', '/workspace/channels', '/workspace/appstore', '/workspace/']) expect(route.test(path)).toBe(false)
  })

  it('keeps the dark class on module routes even after the page resets it, and clears it elsewhere', () => {
    const vm = { className: new Set<string>(), dataset: {} as Record<string, string>, events: [] as string[], observers: [] as Array<() => void>, location: { pathname: '/workspace/knowledge' } }
    const classList = {
      contains: (name: string) => vm.className.has(name),
      toggle: (name: string, force: boolean) => { force ? vm.className.add(name) : vm.className.delete(name); vm.observers.forEach(fn => fn()) },
      add: (name: string) => { vm.className.add(name); vm.observers.forEach(fn => fn()) },
      remove: (name: string) => { vm.className.delete(name); vm.observers.forEach(fn => fn()) },
      reset: () => { vm.className.clear(); vm.className.add('light'); vm.observers.forEach(fn => fn()) }
    }
    const root = { dataset: vm.dataset, classList }
    const window = { dispatchEvent: (event: { type: string }) => vm.events.push(event.type) } as Record<string, unknown>
    const sandbox = { document: { documentElement: root }, location: vm.location, window, CustomEvent: class { type: string; constructor(type: string) { this.type = type } }, RegExp, MutationObserver: class { constructor(private fn: () => void) {} observe() { vm.observers.push(this.fn) } } }
    const run = (theme: 'dark' | 'light') => new Function(...Object.keys(sandbox), `return ${moduleThemeScript(theme)}`)(...Object.values(sandbox))
    run('dark')
    expect([...vm.className].sort()).toEqual(['dark', 'dsh-module-dark'])
    expect(vm.dataset.dshPage).toBe('knowledge')
    expect(vm.observers).toHaveLength(1)
    // React mounts the ThemeProvider later and pins `light`; the guard restores the host decision.
    classList.reset()
    expect(vm.className.has('dark')).toBe(true)
    expect(vm.className.has('dsh-module-dark')).toBe(true)
    expect(vm.className.has('light')).toBe(true)
    vm.location.pathname = '/workspace/c/abc'
    run('dark')
    expect(vm.className.has('dark')).toBe(false)
    expect(vm.dataset.dshPage).toBeUndefined()
    expect(vm.observers).toHaveLength(1)
    vm.location.pathname = '/workspace/channel'
    run('light')
    expect(vm.className.has('dark')).toBe(false)
    expect(vm.dataset.dshHostTheme).toBe('light')
    run('dark')
    expect(vm.className.has('dark')).toBe(true)
    expect(vm.events.filter(type => type === 'dsh:appearance')).toHaveLength(4)
    // A chat route where the page itself keeps html.dark: the host neither removes it nor loops on it.
    vm.location.pathname = '/workspace/c/abc'
    run('dark')
    expect(vm.className.has('dark')).toBe(false)
    const before = vm.observers.length
    classList.toggle('dark', true)
    expect(vm.className.has('dark')).toBe(true)
    expect(vm.className.has('dsh-module-dark')).toBe(false)
    expect(vm.observers).toHaveLength(before)
  })

  it('derives dark replacements from lightness and leaves chromatic or already-dark colors alone', () => {
    expect(darkDeclaration('text', '212121')).toBe('color:rgb(var(--text-1))')
    expect(darkDeclaration('text', '4e5969')).toBe('color:rgb(var(--text-2))')
    expect(darkDeclaration('text', '86909c')).toBe('color:rgb(var(--text-3))')
    expect(darkDeclaration('text', 'c9cdd4')).toBe('color:rgb(var(--text-4))')
    expect(darkDeclaration('text', '111827')).toBe('color:rgb(var(--text-1))')
    expect(darkDeclaration('text', '000d4d')).toBeUndefined()
    expect(darkDeclaration('text', 'ffffff')).toBeUndefined()
    expect(darkDeclaration('text', 'f53f3f')).toBeUndefined()
    expect(darkDeclaration('bg', 'ffffff')).toBe('background-color:rgb(var(--bg-page))')
    expect(darkDeclaration('bg', 'f7f8fa')).toBe('background-color:rgb(var(--arco-gray-1))')
    expect(darkDeclaration('bg', 'e5e6eb')).toBe('background-color:rgb(var(--arco-gray-2))')
    expect(darkDeclaration('bg', '212121')).toBeUndefined()
    expect(darkDeclaration('bg', 'e8f3ff')).toBeUndefined()
    expect(darkDeclaration('border', 'e5e6eb')).toBe('border-color:rgb(var(--border-base))')
    expect(darkDeclaration('border', '8d93a0')).toBe('border-color:rgb(var(--border-deep))')
  })

  it('scopes every utility override to the host module class and covers both hex spellings', () => {
    const rules = MODULE_THEME_CSS.split('\n')
    expect(rules[0]).toBe('html.dsh-module-dark{color-scheme:dark}')
    expect(rules[2]).toBe('html.dsh-module-dark :is(thead,th,[role=columnheader]){background-color:rgb(var(--arco-gray-1))}')
    for (const rule of rules) for (const selector of rule.slice(0, rule.indexOf('{')).replace(/:is\([^)]*\)/gu, '').split(',')) expect(selector.startsWith('html.dsh-module-dark')).toBe(true)
    for (const selector of ['.bg-white{', '.bg-\\[\\#fbfbfb\\]', '.bg-\\[\\#FBFBFB\\]', '.text-\\[\\#1d2129\\]', '.text-\\[\\#1D2129\\]', '.text-black', '.text-gray-900', '.border-gray-200', '.bg-gray-50']) {
      expect(MODULE_THEME_CSS).toContain(`html.dsh-module-dark ${selector}`)
    }
    for (const kept of [/\.text-\\\[\\#f53f3f\\\][,{]/u, /\.bg-\\\[\\#212121\\\][,{]/u, /\.text-white[,{]/u, /\.bg-black[,{]/u, /\.text-gray-50[,{]/u]) expect(MODULE_THEME_CSS).not.toMatch(kept)
    expect(MODULE_THEME_CSS).not.toMatch(/\.dark\b[^-]/u)
    expect(MODULE_THEME_CSS.match(/html\.dsh-module-dark \.text-\\\[\\#111\\\]/gu)).toHaveLength(1)
  })
})
