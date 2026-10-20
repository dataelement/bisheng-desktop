import { describe, expect, it } from 'vitest'
import { FRAME_DARK_CSS, MODULE_ROUTE_PATTERN, MODULE_THEME_CSS, darkDeclaration, moduleThemeScript } from '../src/main/enterprise/chat-module-theme'

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
    const sandbox = { document: { documentElement: root, querySelectorAll: () => [] }, location: vm.location, window, CustomEvent: class { type: string; constructor(type: string) { this.type = type } }, RegExp, WeakSet, MutationObserver: class { constructor(private fn: () => void) {} observe(_target: unknown, options: { attributes?: boolean }) { if (options.attributes) vm.observers.push(this.fn) } } }
    const run = (theme: 'dark' | 'light') => new Function(...Object.keys(sandbox), `return ${moduleThemeScript(theme)}`)(...Object.values(sandbox))
    run('dark')
    expect([...vm.className].sort()).toEqual(['dark', 'dsh-host-dark', 'dsh-module-dark'])
    expect(vm.dataset.dshPage).toBe('knowledge')
    expect(vm.observers).toHaveLength(1)
    // React mounts the ThemeProvider later and pins `light`; the guard restores the host decision.
    classList.reset()
    expect(vm.className.has('dark')).toBe(true)
    expect(vm.className.has('dsh-module-dark')).toBe(true)
    expect(vm.className.has('dsh-host-dark')).toBe(true)
    expect(vm.className.has('light')).toBe(true)
    // Chat routes keep the page's own html.dark handling but still get the host-wide utility scope.
    vm.location.pathname = '/workspace/c/abc'
    run('dark')
    expect(vm.className.has('dark')).toBe(false)
    expect(vm.className.has('dsh-module-dark')).toBe(false)
    expect(vm.className.has('dsh-host-dark')).toBe(true)
    expect(vm.dataset.dshPage).toBeUndefined()
    expect(vm.observers).toHaveLength(1)
    vm.location.pathname = '/workspace/channel'
    run('light')
    expect(vm.className.has('dark')).toBe(false)
    expect(vm.className.has('dsh-host-dark')).toBe(false)
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

  it('styles reachable srcdoc frames on dark module routes and clears them again', () => {
    const makeDoc = () => {
      const head = { children: [] as Array<{ id: string; textContent: string }> }
      const doc = {
        head,
        documentElement: head,
        getElementById: (id: string) => head.children.find(child => child.id === id) ?? null,
        createElement: () => { const style = { id: '', textContent: '', remove: () => { head.children.splice(head.children.indexOf(style), 1) } }; return style }
      }
      head.children = []
      ;(head as { appendChild?: (child: { id: string; textContent: string }) => void }).appendChild = (child) => { head.children.push(child) }
      return doc
    }
    const article = { contentDocument: makeDoc(), listeners: [] as Array<() => void>, addEventListener(_type: string, fn: () => void) { this.listeners.push(fn) } }
    const sandboxed = { contentDocument: null, listeners: [] as Array<() => void>, addEventListener(_type: string, fn: () => void) { this.listeners.push(fn) } }
    const className = new Set<string>()
    const classList = { contains: (name: string) => className.has(name), toggle: (name: string, force: boolean) => { force ? className.add(name) : className.delete(name) }, add: (name: string) => className.add(name), remove: (name: string) => className.delete(name) }
    const sandbox = { document: { documentElement: { dataset: {} as Record<string, string>, classList }, querySelectorAll: () => [article, sandboxed] }, location: { pathname: '/workspace/channel/abc' }, window: { dispatchEvent: () => true }, CustomEvent: class {}, RegExp, WeakSet, MutationObserver: class { observe() {} } }
    const run = (theme: 'dark' | 'light') => new Function(...Object.keys(sandbox), `return ${moduleThemeScript(theme)}`)(...Object.values(sandbox))
    run('dark')
    expect(article.contentDocument.head.children.map(child => child.id)).toEqual(['dsh-host-frame-dark'])
    expect(article.contentDocument.head.children[0]?.textContent).toBe(FRAME_DARK_CSS)
    expect(article.listeners).toHaveLength(1)
    expect(sandboxed.listeners).toHaveLength(1)
    // A reload replaces the frame document; the load listener styles the new one once.
    article.contentDocument = makeDoc()
    article.listeners[0]?.()
    article.listeners[0]?.()
    expect(article.contentDocument.head.children).toHaveLength(1)
    run('dark')
    expect(article.listeners).toHaveLength(1)
    run('light')
    expect(article.contentDocument.head.children).toHaveLength(0)
    expect(FRAME_DARK_CSS).toContain('img,video,canvas')
    expect(FRAME_DARK_CSS.startsWith('html{filter:invert(1) hue-rotate(180deg)')).toBe(true)
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
    expect(darkDeclaration('bg', 'fafbfc')).toBe('background-color:rgb(var(--bg-page))')
    expect(darkDeclaration('bg', 'e5e6eb')).toBe('background-color:rgb(var(--arco-gray-2))')
    expect(darkDeclaration('bg', '212121')).toBeUndefined()
    expect(darkDeclaration('bg', 'e8f3ff')).toBeUndefined()
    expect(darkDeclaration('border', 'e5e6eb')).toBe('border-color:rgb(var(--border-base))')
    expect(darkDeclaration('border', '8d93a0')).toBe('border-color:rgb(var(--border-deep))')
    expect(darkDeclaration('bg', 'ffffff', '0.85')).toBe('background-color:rgb(var(--bg-page) / 0.85)')
    expect(darkDeclaration('from', 'ffffff')).toBe('--tw-gradient-from:rgb(var(--bg-page)) var(--tw-gradient-from-position);--tw-gradient-to:rgb(var(--bg-page) / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)')
    expect(darkDeclaration('from', 'ffffff', '0')).toBe('--tw-gradient-from:rgb(var(--bg-page) / 0) var(--tw-gradient-from-position);--tw-gradient-to:rgb(var(--bg-page) / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)')
    expect(darkDeclaration('via', 'ffffff', '0.85')).toBe('--tw-gradient-to:rgb(var(--bg-page) / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from),rgb(var(--bg-page) / 0.85) var(--tw-gradient-via-position),var(--tw-gradient-to)')
    expect(darkDeclaration('to', 'f9fafb')).toBe('--tw-gradient-to:rgb(var(--bg-page)) var(--tw-gradient-to-position)')
    expect(darkDeclaration('to', 'f7f8fa')).toBe('--tw-gradient-to:rgb(var(--arco-gray-1)) var(--tw-gradient-to-position)')
    expect(darkDeclaration('from', '1f2937')).toBeUndefined()
  })

  it('scopes fixed rules to module routes, utilities to every dark host route, and covers both hex spellings', () => {
    const rules = MODULE_THEME_CSS.split('\n')
    expect(rules[0]).toBe('html.dsh-module-dark{color-scheme:dark}')
    expect(rules[2]).toBe('html.dsh-module-dark :is(thead,th,[role=columnheader]){background-color:rgb(var(--arco-gray-1))}')
    expect(rules[3]).toBe('html.dsh-module-dark[data-dsh-page="knowledge"] .aspect-\\[4\\/3\\] > svg[viewBox="0 0 120 90"]{filter:invert(1) hue-rotate(180deg)}')
    expect(rules[4]).toBe('html.dsh-host-dark [class*="bg-[linear-gradient("][class*="#FFF"],html.dsh-host-dark [class*="bg-[linear-gradient("][class*="#fff"]{background-image:linear-gradient(135deg,rgb(var(--brand-500) / 0.08),rgb(var(--arco-gray-1)) 50%,rgb(var(--brand-500) / 0.08))}')
    for (const rule of rules.slice(0, 4)) for (const selector of rule.slice(0, rule.indexOf('{')).replace(/:is\([^)]*\)/gu, '').split(',')) expect(selector.startsWith('html.dsh-module-dark')).toBe(true)
    // Selector lists are split on the scope prefix: :is() lists and inline-style selectors carry commas of their own.
    for (const rule of rules.slice(4)) for (const selector of rule.slice(0, rule.indexOf('{')).split(',html.')) expect(selector.startsWith('html.dsh-host-dark ') || selector.startsWith('dsh-host-dark ')).toBe(true)
    // A plain utility sits in the base :is() list of its declaration's rule, in both hex spellings.
    const base = (cls: string) => new RegExp(`html\\.dsh-host-dark :is\\([^)]*${cls.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[,)]`, 'u')
    for (const cls of ['.bg-white', '.bg-\\[\\#fbfbfb\\]', '.bg-\\[\\#FBFBFB\\]', '.bg-\\[\\#f7f7f7\\]', '.text-\\[\\#1d2129\\]', '.text-\\[\\#1D2129\\]', '.text-black', '.text-gray-900', '.border-gray-200', '.bg-gray-50', '.border-white', '.from-white', '.to-white', '.from-white\\/0', '.to-white\\/0', '.via-white\\/85']) {
      expect(MODULE_THEME_CSS).toMatch(base(cls))
    }
    for (const kept of [/\.text-\\\[\\#f53f3f\\\][,{)]/u, /\.bg-\\\[\\#212121\\\][,{)]/u, /\.text-white[,{)]/u, /\.bg-black[,{)]/u, /\.text-gray-50[,{)]/u, /\.from-gray-800[,{)]/u]) expect(MODULE_THEME_CSS).not.toMatch(kept)
    expect(MODULE_THEME_CSS).not.toMatch(/\.dark\b[^-]/u)
    expect(MODULE_THEME_CSS.match(/\.text-\\\[\\#111\\\][,)]/gu)).toHaveLength(1)
    // Variant classes are separate utilities; each variant wraps its own :is() list.
    expect(MODULE_THEME_CSS).toMatch(/html\.dsh-host-dark :is\([^)]*\.hover\\:bg-\\\[\\#f7f7f7\\\][,)][^)]*\):hover/u)
    expect(MODULE_THEME_CSS).toMatch(/html\.dsh-host-dark :is\([^)]*\.fine-pointer\\:hover\\:bg-gray-50[,)][^)]*\):hover/u)
    expect(MODULE_THEME_CSS).toMatch(/html\.dsh-host-dark \.group:hover :is\([^)]*\.group-hover\\:text-\\\[\\#333\\\][,)]/u)
    expect(MODULE_THEME_CSS).toMatch(/html\.dsh-host-dark :is\([^)]*\.data-\\\[state\\=open\\\]\\:bg-gray-100[,)][^)]*\)\[data-state=open\]/u)
    expect(MODULE_THEME_CSS).toMatch(/html\.dsh-host-dark :is\([^)]*\.has-\\\[\\\[data-state\\=open\\\]\\\]\\:bg-\\\[\\#f7f7f7\\\][,)][^)]*\):has\(\[data-state=open\]\)/u)
    expect(MODULE_THEME_CSS).not.toContain('::placeholder:hover')
    // Interactive surfaces lift one step: hover on a gray-1 surface renders as gray-2.
    const hoverRule = MODULE_THEME_CSS.split('\n').find((rule) => /\.hover\\:bg-\\\[\\#f7f7f7\\\][,)]/u.test(rule))
    expect(hoverRule?.endsWith('{background-color:rgb(var(--arco-gray-2))}')).toBe(true)
    const baseRule = MODULE_THEME_CSS.split('\n').find((rule) => /:is\([^)]*\.bg-\\\[\\#f7f7f7\\\][,)]/u.test(rule))
    expect(baseRule?.endsWith('{background-color:rgb(var(--arco-gray-1))}')).toBe(true)
    const whiteHover = MODULE_THEME_CSS.split('\n').find((rule) => /\.hover\\:bg-white[,)]/u.test(rule))
    expect(whiteHover?.endsWith('{background-color:rgb(var(--arco-gray-1))}')).toBe(true)
    // Linsight inline palette: matched on the serialized style attribute, overridden with !important.
    expect(MODULE_THEME_CSS).toContain('html.dsh-host-dark [style^="color: rgb(29, 33, 41)"],html.dsh-host-dark [style*="; color: rgb(29, 33, 41)"]{color:rgb(var(--text-1)) !important}')
    expect(MODULE_THEME_CSS).toContain('[style^="color: rgb(92, 92, 92)"]')
    expect(MODULE_THEME_CSS).toContain('html.dsh-host-dark [style^="background-color: rgb(255, 255, 255)"],html.dsh-host-dark [style*="; background-color: rgb(255, 255, 255)"]{background-color:rgb(var(--bg-page)) !important}')
    expect(MODULE_THEME_CSS).toContain(`html.dsh-host-dark [style*="%23EAEEFF"]{background-image:url("data:image/svg+xml,`)
    expect(MODULE_THEME_CSS).toMatch(/fill='%232C2F36'[^\n]*!important\}/u)
  })
})
