import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it.each([false, true])('keeps product seats and gates native content on the bridge: %s', async nativeBridge => {
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
        dshDesktop: { getRepairDraft: vi.fn(), openRepairAgent: vi.fn() },
        ...(nativeBridge ? { dshEnterpriseChat: { present: () => Promise.resolve() } } : {}),
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
    const BrandWordmark = vi.fn()
    const FishLogo = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()],
          useSyncExternalStore: (_sub: unknown, snap: () => unknown) => snap()
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { BrandWordmark, FishLogo }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const registerLocale = vi.fn((_namespace: string, _messages: Record<string, unknown>) => () => undefined)
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
      locale: { register: registerLocale, bind: () => (key: string) => key },
      remote: { session: { openWorkspacePath: () => Promise.resolve({ ok: true, value: { opened: true } }) } },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
      uiWorkspace: {},
      layout: {},
      effect: (setup: () => (() => void) | undefined) => { disposeStyle = setup() }
    })

    expect(plugin.inject).toEqual(['slots', 'locale', 'remote', 'remote.session', 'sessions', 'uiWorkspace', 'layout'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'shell.overlay',
      'shell.overlay',
      'sidebar.primaryNavigation',
      'sidebar.workspaces.title',
      'desktop.mode.content',
      'sidebar.workspaces.collection',
      'conversation.input.dock',
      'sidebar.settings.action',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'conversation.hero.brand.title',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ].filter(name => nativeBridge || name !== 'desktop.mode.content'))

    // Local BISHENG seats and incoming utilities coexist without duplicate owners.
    const ids = registrations.map(({ config }) => config.id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => id === 'desktop-repair-draft')).toHaveLength(1)
    expect(ids.filter(id => id === 'desktop-utilities')).toHaveLength(1)
    expect(registrations.some(({ config }) => config.name === 'settings.sidebar.footer')).toBe(false)

    const workspaceTitle = registrations.find(({ config }) => config.name === 'sidebar.workspaces.title')
    expect(workspaceTitle).toBeDefined()
    const titleTree = workspaceTitle!.component({ flat: false, t: (key: string) => key }) as {
      type: unknown
      props: { className?: string; 'aria-expanded'?: boolean; children: unknown[]; onClick?: () => void }
    }
    expect(titleTree.type).toBe('button')
    expect(titleTree.props.className).toBe('dshWorkspaceTitleToggle')
    expect(titleTree.props['aria-expanded']).toBe(true)
    expect(titleTree.props.children[1]).toBe('projects')
    titleTree.props.onClick?.()
    const collapsedTitle = workspaceTitle!.component({ flat: false, t: (key: string) => key }) as {
      props: { 'aria-expanded'?: boolean }
    }
    expect(collapsedTitle.props['aria-expanded']).toBe(false)

    const collection = registrations.find(({ config }) => config.id === 'desktop-shared-collection')
    expect(collection).toBeDefined()
    expect(() => collection!.component({
      mode: 'search', query: 'x', archivedOnly: false, items: [], projects: () => null,
      navigation: { subscribe: () => () => undefined, snapshot: () => ({ historyPhase: 'idle', page: 0, items: [null, { id: 'bad-title', title: 42 }] }) },
      t: (key: string) => key
    })).not.toThrow()

    const searchTree = collection!.component({
      mode: 'search', query: 'needle', archivedOnly: false, searchPending: false,
      items: [{ id: 'local-1', render: () => createElement('div', { role: 'treeitem' }, 'needle') }],
      projects: () => [],
      navigation: { subscribe: () => () => undefined, snapshot: () => ({ historyPhase: 'idle', page: 0, items: [] }) },
      t: (key: string) => key
    }) as { props: { children: unknown[] } }
    expect(searchTree.props.children).toHaveLength(2)
    expect(searchTree.props.children[1]).toBeDefined()

    const projectTree = collection!.component({
      mode: 'projects', query: '', archivedOnly: false,
      items: [{ id: 'local-1', render: () => createElement('div', { role: 'treeitem' }, 'local-1') }],
      projects: () => [createElement('div', { 'data-project': true }, 'project')],
      navigation: { subscribe: () => () => undefined, snapshot: () => ({ mode: 'work', historyPhase: 'idle', page: 0, items: [] }) },
      t: (key: string) => key
    }) as { props: { children: Array<{ props: { className?: string; hidden?: boolean; children?: unknown } }> } }
    expect(projectTree.props.children[0]?.props.className).toBe('dshWorkspaceBody')
    expect(projectTree.props.children[0]?.props.hidden).toBe(true)
    expect(projectTree.props.children[0]?.props.children).toEqual([null])
    expect(projectTree.props.children[0]?.props.className).not.toBe('dshWorkspaceSection')
    titleTree.props.onClick?.()
    for (const namespace of ['dsh-desktop-repair', 'dsh-desktop-actions']) {
      const messages = registerLocale.mock.calls.filter(([name]) => name === namespace)
      expect(messages).toHaveLength(1)
      expect(Object.keys(messages[0]?.[1] ?? {}).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
    }

    // Style injections include both layout navigation styles and gear icon hiding
    expect(appended.length).toBeGreaterThanOrEqual(1)
    const combinedStyles = appended.map((node) => node.textContent || '').join('\n')
    expect(combinedStyles).toContain('[data-dsh-market-nav-icon] span[class*="navIcon"]')
    expect(combinedStyles).toContain('.dshPrimaryNavigation')
    expect(combinedStyles).toContain('.dshSectionAddButton')
    expect(combinedStyles).toContain('.dshWorkspaceTitleToggle')
    expect(combinedStyles).toContain('font-size: 14px')
    expect(combinedStyles).toContain('line-height: 20px')
    expect(combinedStyles).toContain('font-weight: 400')

    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalled()
  })
})
