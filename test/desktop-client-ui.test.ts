import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number; key?: string }
  component: (props: Record<string, unknown>) => unknown
}

describe('BISHENG client slot occupants', () => {
  it('renders the sidebar brand with account configuration and a BISHENG fallback', async () => {
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
    const windowEvents = new EventTarget()
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
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
    let menuOpen = false
    const setMenuOpen = vi.fn()
    const effectDisposers: Array<() => void> = []
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => {
            const dispose = effect()
            if (dispose) effectDisposers.push(dispose)
          },
          useState: (initial: unknown) => [typeof initial === 'boolean' ? menuOpen : initial, setMenuOpen],
          useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot()
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
      'shell.overlay',
      'shell.overlay',
      'main',
      'conversation.header.leading',
      'sidebar.primaryNavigation',
      'sidebar.panellist.actions',
      'sidebar.workspaces.title',
      'desktop.mode.content',
      'sidebar.workspaces.collection',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'conversation.hero.brand.title',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ])
    expect(registrations.find(({ config }) => config.name === 'main')?.config.key).toBe('desktop-chat')
    // Desktop toolbar styles have an owned lifetime; branding stays in currentColor.
    expect(appended).toHaveLength(2)
    // Match Harness panelList spacing without changing navigation's outer padding.
    expect(appended[0]?.textContent).toContain('.dshPrimaryNavigation{display:flex;flex-direction:column;flex:none;gap:4px;padding:0 0 12px}')
    expect(appended[0]?.textContent).toContain('.dshPrimaryNavigation[data-wide=false]{gap:12px}')
    // The in-place dropdown fills its trigger wrapper instead of shrink-wrapping its labels.
    expect(appended[0]?.textContent).toContain('.dshNavigationMenu .dshNavigationMenuList{width:100%;min-width:0;max-width:100%;box-sizing:border-box}')
    const primaryNavigation = registrations.find(({ config }) => config.name === 'sidebar.primaryNavigation')!.component
    const startSpy = vi.fn(() => vi.fn())
    const mockEntries = [
      { id: 'knowledge', label: 'Knowledge' },
      { id: 'apps', label: 'Apps' },
      { id: 'skills', label: 'Skills' }
    ]
    const zhDict: Record<string, string> = { knowledge: '知识空间', apps: '应用中心', skills: '企业技能' }
    const zhTranslate = (key: string) => zhDict[key] || key
    for (const wide of [true, false]) {
      const nav = primaryNavigation({
        wide, panels: [], navigation: { subscribe: vi.fn(), snapshot: () => ({ mode: 'work', connected: true, navigation: { entries: mockEntries } }), start: startSpy }, t: zhTranslate
      }) as { props: Record<string, unknown> }
      expect(nav.props.className).toBe('dshPrimaryNavigation')
      expect(nav.props['data-wide']).toBe(wide)
      expect(startSpy).toHaveBeenCalled()
      const children = (nav.props.children as Array<any>).filter(Boolean)
      const menu = children.find(child => child?.props?.items)
      expect(menu).toBeDefined()
      expect(menu.props.portal).toBe(true)
      expect(menu.props.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'web:knowledge', label: '知识空间' }),
        expect.objectContaining({ id: 'web:apps', label: '应用中心' }),
        expect.objectContaining({ id: 'web:skills', label: '企业技能' })
      ]))
    }

    const panelActions = registrations.find(({ config }) => config.name === 'sidebar.panellist.actions')!.component
    const actionsNav = { subscribe: vi.fn(), snapshot: () => ({ mode: 'work', connected: true, navigation: { entries: mockEntries } }), start: startSpy, openPage: vi.fn() }
    const dismissSpy = vi.fn()
    const openSpy = vi.fn()
    const renderedActions = panelActions({
      onDismiss: dismissSpy, onOpen: openSpy, navigation: actionsNav, t: zhTranslate
    }) as { props: Record<string, unknown> }
    const actionItems = renderedActions.props.children as Array<{ props: { onSelect: () => void; children: string } }>
    expect(actionItems).toHaveLength(3)
    expect(actionItems.map(item => Array.isArray(item.props.children) ? item.props.children[0] : item.props.children)).toEqual(['知识空间', '应用中心', '企业技能'])
    actionItems[0]!.props.onSelect()
    expect(dismissSpy).toHaveBeenCalled()
    expect(actionsNav.openPage).toHaveBeenCalledWith('knowledge')
    expect(panelActions({ onDismiss: dismissSpy, onOpen: openSpy, navigation: { subscribe: vi.fn(), snapshot: () => ({ mode: 'work', connected: true }) }, t: zhTranslate })).toBeNull()

    // When English locale is selected, entry labels translate to English
    const enDict: Record<string, string> = { knowledge: 'Knowledge Spaces', apps: 'App Store', skills: 'Skills' }
    const enActions = panelActions({
      onDismiss: dismissSpy, onOpen: openSpy, navigation: actionsNav, t: (key: string) => enDict[key] || key
    }) as { props: Record<string, unknown> }
    const enActionItems = enActions.props.children as Array<{ props: { children: string } }>
    expect(enActionItems.map(item => Array.isArray(item.props.children) ? item.props.children[0] : item.props.children)).toEqual(['Knowledge Spaces', 'App Store', 'Skills'])
    // A native WebContentsView steals window focus without an iframe target.
    menuOpen = true
    primaryNavigation({
      wide: true, panels: [], navigation: { subscribe: vi.fn(), snapshot: () => ({ mode: 'chat' }) }, t: (key: string) => key
    })
    setMenuOpen.mockClear()
    windowEvents.dispatchEvent(new Event('blur'))
    expect(setMenuOpen).toHaveBeenCalledWith(false)
    effectDisposers.forEach(dispose => dispose())
    setMenuOpen.mockClear()
    windowEvents.dispatchEvent(new Event('blur'))
    expect(setMenuOpen).not.toHaveBeenCalled()
    expect(appended[1]?.textContent).toContain("[data-dsh-preset-search]")
    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalledOnce()

    const sidebarNavigation = { subscribe: vi.fn(), snapshot: () => ({}) }
    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({ navigation: sidebarNavigation }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarName.props.children).toEqual(['Bisheng'])

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24, navigation: sidebarNavigation }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props.width).toBe(24)
    expect(sidebarMark.props.height).toBe(24)
    const [markField, ...markPaths] = sidebarMark.props.children as Array<{
      type: unknown
      props: Record<string, unknown>
    }>
    expect(markField?.type).toBe('rect')
    expect(markField?.props.fill).toBe('#000000')
    expect(markPaths).toHaveLength(8)
    expect(markPaths.every(({ type, props }) => type === 'path' && props.fill === 'white')).toBe(true)
    const configuredNavigation = { subscribe: vi.fn(), snapshot: () => ({ sidebarBrand: { name: 'Team', image: 'https://files.example/logo.png' } }) }
    const configuredName = registrations.find(({ config }) => config.name === 'sidebar.brand.name')!.component({ navigation: configuredNavigation }) as { props: Record<string, unknown> }
    expect(configuredName.props.children).toEqual(['Team'])
    const configuredSidebarMark = registrations.find(({ config }) => config.name === 'sidebar.brand.mark')!.component({ size: 24, navigation: configuredNavigation }) as { type: unknown; props: Record<string, unknown> }
    expect(configuredSidebarMark.type).toBe('img')
    expect(configuredSidebarMark.props.src).toBe('https://files.example/logo.png')

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48, className: 'hero-mark', navigation: { subscribe: vi.fn(), snapshot: () => ({}) } }) as {
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
    const branding = { welcomeMessage: 'Team workspace', assistantIcon: { enabled: true, image: 'https://enterprise.example/custom.svg' } }
    const navigation = { subscribe: vi.fn(), snapshot: () => ({ navigation: { branding } }) }
    const configuredMark = registrations.find(({ config }) => config.name === 'conversation.hero.brand.mark')!.component({ size: 34, navigation }) as { type: unknown; props: Record<string, unknown> }
    expect(configuredMark.type).toBe('img')
    expect(configuredMark.props.src).toBe(branding.assistantIcon.image)
    const configuredTitle = registrations.find(({ config }) => config.name === 'conversation.hero.brand.title')!.component({ navigation, locale: { subscribe: vi.fn(), snapshot: () => 'en' } }) as { props: Record<string, unknown> }
    expect(configuredTitle.props.children).toEqual(['Team workspace'])
    branding.assistantIcon.enabled = false
    expect(registrations.find(({ config }) => config.name === 'conversation.hero.brand.mark')!.component({ size: 34, navigation })).toBeNull()

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

    expect(source).toContain('children: renderSlot("conversation.hero.brand.title", {}, { fallback: [(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })')
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
        '@deepseek-ai+dsh-client-ui-conversation+0.2.1-rc.2.patch'
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

    const logoRowStart = source.indexOf('className: SidebarRoot_module_css_default.logoRow')
    expect(logoRowStart).toBeGreaterThan(-1)
    expect(source.slice(Math.max(0, logoRowStart - 220), logoRowStart)).toContain('!darwinDesktop && !windowsTitlebar &&')
    expect(source).toContain('className: SidebarRoot_module_css_default.topStrip')
    // Windows pins the toggle into the caption. Rendering it outside the logo
    // row lets that empty 40px band go away without losing the button.
    const windowsToggle = source.indexOf('windowsTitlebar && toggle')
    expect(windowsToggle).toBeGreaterThan(-1)
    expect(windowsToggle).toBeLessThan(logoRowStart)
    expect(source.slice(windowsToggle, logoRowStart)).not.toContain('logoRow')

    const wideBrandStart = source.indexOf('children: [wide &&')
    const wideBrandEnd = source.indexOf('})(), toggle]', wideBrandStart)
    const wideBrand = source.slice(wideBrandStart, wideBrandEnd)
    expect(wideBrandStart).toBeGreaterThan(-1)
    expect(wideBrandEnd).toBeGreaterThan(wideBrandStart)
    expect(wideBrand).toContain('renderSlot("sidebar.brand.name"')
    expect(wideBrand).not.toContain('renderSlot("sidebar.brand.mark"')
    expect(wideBrand).not.toContain('darwinDesktop ?')
    expect(wideBrand).toContain('"data-dsh-sidebar-brand-identity": true')
    const desktopClient = await readFile(path.join(projectRoot, 'packages/dsh-desktop-client-ui/client.js'), 'utf8')
    expect(desktopClient).toContain('[data-dsh-sidebar-brand-identity] { display:none !important; }')
    expect(desktopClient).not.toContain('div[data-window-drag]:has([data-dsh-sidebar-brand-identity])')

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
