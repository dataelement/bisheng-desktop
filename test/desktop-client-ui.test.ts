import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('BISHENG client slot occupants', () => {
  it('keeps BISHENG artwork in mark seats while removing the wide sidebar wordmark', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const removeStyle = vi.fn()
    let disposeStyle: (() => void) | undefined
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '', remove: removeStyle })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const MenuItemButton = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { MenuItemButton }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({
      slots,
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key
      },
      remote: { session: { openWorkspacePath: () => Promise.resolve({ ok: true, value: { opened: true } }) } },
      effect: (setup: () => (() => void) | undefined) => { disposeStyle = setup() }
    })

    expect(plugin.inject).toEqual(['slots', 'locale', 'remote', 'remote.session', 'sessions', 'uiWorkspace', 'layout'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'desktop.mode.content',
      'sidebar.workspaces.collection',
      'sidebar.session.row.leading',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ])
    // Desktop toolbar styles have an owned lifetime; branding stays in currentColor.
    expect(appended).toHaveLength(2)
    expect(appended[1]?.textContent).toContain("[data-dsh-preset-search]")
    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalledOnce()

    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({})
    expect(sidebarName).toBeNull()

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props.width).toBe(17)
    expect(sidebarMark.props.height).toBe(17)
    const [markField, ...markPaths] = sidebarMark.props.children as Array<{
      type: unknown
      props: Record<string, unknown>
    }>
    expect(markField?.type).toBe('rect')
    expect(markField?.props.fill).toBe('#000000')
    expect(markPaths).toHaveLength(8)
    expect(markPaths.every(({ type, props }) => type === 'path' && props.fill === 'white')).toBe(true)

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48, className: 'hero-mark' }) as {
      type: unknown
      props: Record<string, unknown>
    }
    expect(heroMark.type).toBe('svg')
    expect(heroMark.props.width).toBe(48)
    expect(heroMark.props.height).toBe(48)
    expect(heroMark.props.viewBox).toBe('0 0 2400 2400')
    expect(heroMark.props.fill).toBe('none')
    expect(heroMark.props.className).toBe('hero-mark')
    expect(heroMark.props.size).toBeUndefined()
    const heroChildren = heroMark.props.children as Array<{
      type: unknown
      props: Record<string, unknown>
    }>
    const [heroField, ...heroPaths] = heroChildren
    expect(heroField?.type).toBe('rect')
    expect(heroField?.props.fill).toBe('#000000')
    expect(heroPaths).toHaveLength(8)
    expect(heroPaths.every(({ type, props }) => type === 'path' && props.fill === 'white')).toBe(true)
  })

  it('reuses the upstream preview-badge styling for the enterprise label', async () => {
    const source = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-conversation',
        'lib',
        'client.js'
      ),
      'utf8'
    )

    expect(source).toContain('children: [(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })')
    expect(source).toContain('className: HeroShell_module_css_default.previewBadge')
    expect(source).toContain('children: t("hero.preview")')
    expect(source).toContain('background:var(--dsw-alias-state-business-tertiary)')
    expect(source).toContain('color:var(--dsw-alias-label-primary-bluish)')
    expect(source).toContain('align-self:flex-start;margin-top:2px')
  })

  it('uses the new hero message in both Chinese and English', async () => {
    const source = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-conversation',
        'lib',
        'client.js'
      ),
      'utf8'
    )
    const patch = await readFile(
      path.join(
        projectRoot,
        'patches',
        '@deepseek-ai+dsh-client-ui-conversation+0.2.0-rc.2.patch'
      ),
      'utf8'
    )

    expect(source).toContain('"hero.headline": "来一起创造"')
    expect(source).toContain('"hero.preview": "企业版"')
    expect(source).not.toContain('"hero.headline": "探索未至之境"')
    expect(source).toContain('"hero.headline": "Let\'s Create Together"')
    expect(source).toContain('"hero.preview": "Enterprise"')
    expect(patch).toContain('+\t\t\t"hero.headline": "来一起创造",')
    expect(patch).toContain('+\t\t\t"hero.preview": "企业版",')
    expect(patch).toContain('-\t\t\t"hero.headline": "探索未至之境",')
    expect(patch).toContain('+\t\t\t"hero.headline": "Let\'s Create Together",')
    expect(patch).toContain('+\t\t\t"hero.preview": "Enterprise",')
    expect(patch).toContain('-\t\t\t"hero.headline": "Into the Unknown",')
  })

  it('shows the brand mark only in the collapsed rail, not beside the wide brand name', async () => {
    const source = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-sidebar',
        'lib',
        'client.js'
      ),
      'utf8'
    )

    const wideBrandStart = source.indexOf('children: [wide &&')
    const wideBrandEnd = source.indexOf('})(), !darwinDesktop && toggle]', wideBrandStart)
    const wideBrand = source.slice(wideBrandStart, wideBrandEnd)
    expect(wideBrandStart).toBeGreaterThan(-1)
    expect(wideBrandEnd).toBeGreaterThan(wideBrandStart)
    expect(wideBrand).toContain('renderSlot("sidebar.brand.name"')
    expect(wideBrand).toContain('"data-dsh-sidebar-brand-identity": true')
    const desktopClient = await readFile(path.join(projectRoot, 'packages/dsh-desktop-client-ui/client.js'), 'utf8')
    expect(desktopClient).toContain('[data-dsh-sidebar-brand-identity] { display:none !important; }')

    const railMarkStart = source.indexOf(
      'className: SidebarRoot_module_css_default.railMark'
    )
    const railMarkEnd = source.indexOf(
      'className: SidebarRoot_module_css_default.panelIcon',
      railMarkStart
    )
    const railMark = source.slice(railMarkStart, railMarkEnd)
    expect(railMarkStart).toBeGreaterThan(-1)
    expect(railMarkEnd).toBeGreaterThan(railMarkStart)
    expect(railMark).toContain('renderSlot("sidebar.brand.mark", { size: 24 }')
  })
})
