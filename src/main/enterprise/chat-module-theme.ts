import type { EnterpriseChatPresentation } from '../../shared/enterprise-chat-view'

/**
 * Module pages (knowledge spaces, subscriptions) ship no dark theme of their own: the
 * BISHENG client pins `<html class="light">` even though `@bisheng/ui` tokens define a
 * complete `.dark` ramp. The host therefore owns the class on module routes only, so the
 * Chat routes keep their deployed `data-dsh-chat-theme` handling untouched.
 */
export const MODULE_ROUTE_PATTERN = '^/workspace/(knowledge|channel|apps|skills|square)(?:[/?#]|$)'

/**
 * The BISHENG ThemeProvider rewrites the html class to `light` when React mounts, which
 * happens after the document's load event. The guard therefore stays installed in the page
 * and re-asserts the host decision whenever the class attribute changes; the host re-runs
 * this script on theme changes and in-page route changes, where `apply` reads the latest
 * host theme from the dataset.
 */
export function moduleThemeScript(theme: EnterpriseChatPresentation['theme']): string {
  return `(() => {
    const root = document.documentElement;
    root.dataset.dshHostTheme = '${theme}';
    if (!window.__dshModuleTheme) {
      const pattern = new RegExp(${JSON.stringify(MODULE_ROUTE_PATTERN)}, 'u');
      // The page may manage html.dark itself on chat routes; the host only ever removes the
      // class it added, so the two never fight over the attribute (a tug of war hangs the page).
      let owned = false;
      const apply = () => {
        const page = (location.pathname.match(pattern) || [])[1] || '';
        if ((root.dataset.dshPage || '') !== page) { if (page) root.dataset.dshPage = page; else delete root.dataset.dshPage; }
        const dark = root.dataset.dshHostTheme === 'dark' && page !== '';
        if (root.classList.contains('dsh-module-dark') !== dark) root.classList.toggle('dsh-module-dark', dark);
        // Flip the ownership flag before touching the class: the observer re-enters apply on the mutation.
        if (dark) { if (!root.classList.contains('dark')) { owned = true; root.classList.add('dark'); } }
        else if (owned) { owned = false; root.classList.remove('dark'); }
      };
      new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
      window.__dshModuleTheme = { apply };
    }
    window.__dshModuleTheme.apply();
    window.dispatchEvent(new CustomEvent('dsh:appearance', { detail: { theme: '${theme}' } }));
  })()`
}

function escapeUtility(name: string): string {
  return name.replace(/[[\]#/.%]/gu, (char) => `\\${char}`)
}

/**
 * Hardcoded color utilities seen in the BISHENG client (deployed 3006 bundle plus the
 * `pages/knowledge` and `pages/Subscription` sources). Only the class names are listed; the
 * dark replacement is derived from each color's lightness below, so new entries need no
 * hand-picked target. Hex values are lowercase here; both spellings are emitted.
 */
const HARDCODED_UTILITIES: readonly string[] = [
  'bg-[#00b42a]', 'bg-[#0285ff]', 'bg-[#06b84c]', 'bg-[#1d2129]', 'bg-[#212121]', 'bg-[#25c298]', 'bg-[#282c34]',
  'bg-[#303134]', 'bg-[#4e5969]', 'bg-[#86909c]', 'bg-[#999999]', 'bg-[#c9cdd4]', 'bg-[#d9d9d9]', 'bg-[#e0e0e0]',
  'bg-[#e4e4e4]', 'bg-[#e5e6eb]', 'bg-[#e8ebf2]', 'bg-[#e8f3ff]', 'bg-[#e8ffea]', 'bg-[#ebebeb]', 'bg-[#ebecf0]',
  'bg-[#ebeff8]', 'bg-[#ebf0ff]', 'bg-[#ececec]', 'bg-[#ede4ff]', 'bg-[#ededed]', 'bg-[#eee]', 'bg-[#eeeeee]',
  'bg-[#eeeff1]', 'bg-[#eef0f4]', 'bg-[#f0f0f0]', 'bg-[#f0f1f3]', 'bg-[#f0f5ff]', 'bg-[#f1f1f1]', 'bg-[#f2f3f5]',
  'bg-[#f2f8ec]', 'bg-[#f4f4f4]', 'bg-[#f4f5f8]', 'bg-[#f4f8ff]', 'bg-[#f53f3f]', 'bg-[#f5f5f5]', 'bg-[#f5f7fa]',
  'bg-[#f5f7fb]', 'bg-[#f6f8fa]', 'bg-[#f7f3ff]', 'bg-[#f7f7f7]', 'bg-[#f7f8fa]', 'bg-[#f8f8f8]', 'bg-[#f9f9f9]',
  'bg-[#fa423e]', 'bg-[#fafafa]', 'bg-[#fafbfc]', 'bg-[#fbfbfb]', 'bg-[#ff7d00]', 'bg-[#ff9800]', 'bg-[#ffbf00]',
  'bg-[#ffe6d2]', 'bg-[#fff2f0]', 'bg-[#fff3e8]', 'bg-[#fff7e8]', 'bg-[#fff]', 'bg-gray-100', 'bg-gray-20',
  'bg-gray-200', 'bg-gray-300', 'bg-gray-400', 'bg-gray-50', 'bg-gray-500', 'bg-gray-600', 'bg-gray-700',
  'bg-gray-800', 'bg-gray-850', 'bg-gray-900', 'bg-gray-950', 'bg-neutral-800', 'bg-neutral-900', 'bg-slate-100',
  'bg-slate-200', 'bg-slate-50', 'bg-white', 'border-[#212121]', 'border-[#8d93a0]', 'border-[#c9cdd4]',
  'border-[#ced4e0]', 'border-[#d9d9d9]', 'border-[#d9dde7]', 'border-[#ddd]', 'border-[#dddddd]',
  'border-[#e0e0e0]', 'border-[#e3e3e3]', 'border-[#e5e6eb]', 'border-[#e8e9ed]', 'border-[#ebebeb]',
  'border-[#ebecf0]', 'border-[#ececec]', 'border-[#eef2f6]', 'border-[#f0f0f0]', 'border-[#f0f1f5]',
  'border-[#f2f3f5]', 'border-[#f53f3f]', 'border-[#ff7d00]', 'border-gray-100', 'border-gray-200',
  'border-gray-300', 'border-gray-400', 'border-gray-50', 'border-gray-500', 'border-gray-600', 'border-gray-700',
  'border-gray-800', 'border-gray-900', 'border-slate-100', 'border-slate-300', 'divide-[#ececec]',
  'divide-gray-200', 'divide-gray-600', 'text-[#000d4d]', 'text-[#007d1a]', 'text-[#00b42a]', 'text-[#024de3]',
  'text-[#070038]', 'text-[#111]', 'text-[#161616]', 'text-[#165dff]', 'text-[#1a1a1a]', 'text-[#1b61e6]',
  'text-[#1d2129]', 'text-[#212121]', 'text-[#24292e]', 'text-[#25c298]', 'text-[#333]', 'text-[#335cff]',
  'text-[#374151]', 'text-[#3a3a3a]', 'text-[#4e5969]', 'text-[#57606a]', 'text-[#5c6680]', 'text-[#61646d]',
  'text-[#64698b]', 'text-[#666666]', 'text-[#666]', 'text-[#6b7785]', 'text-[#6b778d]', 'text-[#7224d9]',
  'text-[#7c3aed]', 'text-[#808080]', 'text-[#818181]', 'text-[#86909c]', 'text-[#8a94a6]', 'text-[#8b8fa8]',
  'text-[#8c8c8c]', 'text-[#8d93a0]', 'text-[#91c561]', 'text-[#979797]', 'text-[#989898]', 'text-[#999999]',
  'text-[#999]', 'text-[#a9aeb8]', 'text-[#b6bbc5]', 'text-[#c0c4cc]', 'text-[#c9cdd4]', 'text-[#e5e6eb]',
  'text-[#e84b3c]', 'text-[#f53f3f]', 'text-[#f58a1f]', 'text-[#f76f44]', 'text-[#ff7d00]', 'text-[#fff]',
  'text-black', 'text-gray-100', 'text-gray-20', 'text-gray-200', 'text-gray-300', 'text-gray-400', 'text-gray-50',
  'text-gray-500', 'text-gray-600', 'text-gray-70', 'text-gray-700', 'text-gray-800', 'text-gray-900',
  'text-gray-950', 'text-neutral-800', 'text-slate-300', 'text-slate-400', 'text-slate-50', 'text-slate-500',
  'text-slate-600', 'text-slate-700', 'text-slate-800',
  'bg-white/10', 'bg-white/20', 'bg-white/30', 'bg-white/50', 'bg-white/60', 'bg-white/70', 'bg-white/85', 'bg-white/90',
  'bg-gray-50/80', 'bg-gray-50/90', 'bg-gray-100/50', 'bg-gray-100/80', 'border-gray-100/40', 'text-black/40'
]

/** Tailwind's default gray ramp; slate / zinc / neutral / stone share its lightness steps. */
const GRAY_RAMP: Readonly<Record<string, string>> = {
  20: '#ececf1', 50: '#f9fafb', 70: '#f3f4f6', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
  500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 850: '#171717', 900: '#111827', 950: '#030712'
}

interface Utility { kind: 'bg' | 'text' | 'border' | 'divide' | 'placeholder'; hex: string; names: string[]; alpha?: string }

/** Tailwind opacity modifiers (`bg-white/85`) keep their alpha on the replacement token. */
function parseUtility(name: string): Utility | undefined {
  const modifier = name.match(/^(.*)\/(\d{1,3})$/u)
  if (modifier) {
    const base = parseUtility(modifier[1] as string)
    if (!base) return undefined
    const alpha = (Number(modifier[2]) / 100).toString()
    return { ...base, alpha, names: base.names.map((alias) => `${alias}/${modifier[2]}`) }
  }
  const hex = name.match(/^(bg|text|border|divide|placeholder)-\[#([0-9a-f]{3}|[0-9a-f]{6})\]$/u)
  if (hex) {
    const kind = hex[1] as Utility['kind']
    const value = hex[2] as string
    const upper = `${kind}-[#${value.toUpperCase()}]`
    return { kind, hex: value.length === 3 ? [...value].map((c) => c + c).join('') : value, names: [...new Set([name, upper])] }
  }
  const named = name.match(/^(bg|text|border|divide)-(?:gray|slate|zinc|neutral|stone)-(\d{2,3})$/u)
  if (named) {
    const step = GRAY_RAMP[named[2] as string]
    return step ? { kind: named[1] as Utility['kind'], hex: step.slice(1), names: [name] } : undefined
  }
  if (name === 'text-black') return { kind: 'text', hex: '000000', names: [name] }
  if (name === 'bg-white' || name === 'bg-[#fff]') return { kind: 'bg', hex: 'ffffff', names: name === 'bg-white' ? [name] : [name, 'bg-[#FFF]', 'bg-[#ffffff]', 'bg-[#FFFFFF]'] }
  return undefined
}

/** HSL lightness, saturation and chroma (max − min channel) of a six-digit hex color, all in [0, 1]. */
function tone(hex: string): { lightness: number; saturation: number; chroma: number } {
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const chroma = max - min
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  return { lightness, saturation, chroma }
}

/**
 * Dark replacement for a light-mode utility, or undefined to leave it alone. Chromatic
 * colors (brand, status, tinted surfaces) stay; so do already-dark backgrounds and
 * already-light text. Dark grays such as Tailwind's blue-tinted gray-900 read as saturated
 * in HSL, so near-black colors are judged by chroma instead.
 */
export function darkDeclaration(kind: Utility['kind'], hex: string): string | undefined {
  const { lightness, saturation, chroma } = tone(hex)
  const neutral = saturation <= 0.25 || (lightness < 0.5 && chroma < 0.12)
  if (!neutral) return undefined
  if (kind === 'bg') {
    if (lightness >= 0.985) return 'background-color:rgb(var(--bg-page))'
    if (lightness >= 0.95) return 'background-color:rgb(var(--arco-gray-1))'
    if (lightness >= 0.9) return 'background-color:rgb(var(--arco-gray-2))'
    if (lightness >= 0.78) return 'background-color:rgb(var(--arco-gray-3))'
    if (lightness >= 0.5) return 'background-color:rgb(var(--arco-gray-4))'
    return undefined
  }
  if (kind === 'text' || kind === 'placeholder') {
    if (lightness < 0.3) return 'color:rgb(var(--text-1))'
    if (lightness < 0.48) return 'color:rgb(var(--text-2))'
    if (lightness < 0.75) return 'color:rgb(var(--text-3))'
    if (lightness < 0.9) return 'color:rgb(var(--text-4))'
    return undefined
  }
  if (lightness >= 0.78) return 'border-color:rgb(var(--border-base))'
  if (lightness >= 0.5) return 'border-color:rgb(var(--border-deep))'
  return undefined
}

function buildModuleThemeCss(): string {
  const groups = new Map<string, string[]>()
  for (const name of HARDCODED_UTILITIES) {
    const utility = parseUtility(name)
    if (!utility) throw new Error(`Unrecognised module theme utility: ${name}`)
    const base = darkDeclaration(utility.kind, utility.hex)
    if (!base) continue
    const declaration = utility.alpha ? base.replace(/\)\)$/u, `) / ${utility.alpha})`) : base
    const selectors = groups.get(declaration) ?? []
    for (const alias of utility.names) {
      const selector = `html.dsh-module-dark .${escapeUtility(alias)}${utility.kind === 'placeholder' ? '::placeholder' : ''}`
      if (!selectors.includes(selector)) selectors.push(selector)
    }
    groups.set(declaration, selectors)
  }
  return [
    'html.dsh-module-dark{color-scheme:dark}',
    'html.dsh-module-dark body,html.dsh-module-dark #root{background-color:rgb(var(--bg-page));color:rgb(var(--text-1))}',
    // Table headers carry their light surface through component styles rather than utilities.
    'html.dsh-module-dark :is(thead,th,[role=columnheader]){background-color:rgb(var(--arco-gray-1))}',
    ...[...groups].map(([declaration, selectors]) => `${selectors.join(',')}{${declaration}}`)
  ].join('\n')
}

export const MODULE_THEME_CSS = buildModuleThemeCss()
