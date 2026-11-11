import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

// Run the actual registered components, preserving hooks across renders and disposing effects.
function componentRuntime() {
  let cells = []
  const instances = new Map()
  const pending = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial }
      const cell = cells[index]
      return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value }]
    },
    useRef(initial) {
      const index = cursor++
      return cells[index] ??= { current: initial }
    },
    useId() { return 'fixture-id-' + cursor++ },
    useCallback(callback, dependencies) {
      const index = cursor++
      const previous = cells[index]
      if (!previous || !dependencies || !dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))) cells[index] = { value: callback, dependencies }
      return cells[index].value
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = cells[index]
      if (previous && dependencies && dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))) return
      pending.push(() => {
        previous?.dispose?.()
        cells[index] = { dependencies, dispose: effect() }
      })
    }
  }
  return {
    react,
    render(component, props) {
      cells = instances.get(component) ?? []
      instances.set(component, cells)
      cursor = 0
      const tree = component(props)
      pending.splice(0).forEach(effect => effect())
      return tree
    },
    dispose: () => { for (const cells of instances.values()) cells.forEach(cell => cell?.dispose?.()) }
  }
}

function loadClient(bridges = {}) {
  const hooks = componentRuntime()
  const target = new EventTarget()
  const effects = new Map()
  const slots = []
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) }))
  const window = Object.assign(target, bridges)
  let definition
  window.__ModuleLoader__ = { load: value => { definition = value } }
  const document = { getElementById: () => ({}), querySelector: vi.fn(() => { throw new Error('Shell focus must use owner callbacks') }) }
  vm.runInNewContext(source, { window, document, CustomEvent, AbortController, fetch, Intl })
  const plugin = definition.factory(id => {
    if (id === 'react') return hooks.react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error('Unexpected dependency: ' + id)
  })
  plugin.apply({
    slots: {
      inject: (_name, callback) => callback(),
      entries: () => [],
      register: (options, component) => { slots.push({ options, component }); return () => {} }
    },
    locale: { bind: () => key => key },
    effect: (setup, label) => { effects.set(label, setup) }
  })
  return {
    window, document, hooks, effects, slots, fetch,
    component: id => slots.find(slot => slot.options.id === id && slot.options.name !== 'settings.section.icon')?.component
  }
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)]
}
const text = tree => !tree ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children ?? []).flat(Infinity).map(text).join(' ')
const render = (client, component, props = {}) => client.hooks.render(component, { t: key => key, ...props })
const button = (tree, label) => nodes(tree).find(node => typeof node.props?.onClick === 'function' && text(node) === label)

function subscriptions() {
  const close = new Set(), focus = new Set()
  return {
    close, focus,
    bridge: {
      onSettingsClose: listener => { close.add(listener); return () => close.delete(listener) },
      onSettingsFocus: listener => { focus.add(listener); return () => focus.delete(listener) }
    }
  }
}

describe('enterprise client desktop bridge behavior', () => {
  it('omits desktop About and its icon in Web without desktop settings capabilities', () => {
    const client = loadClient()
    expect(client.component('desktop-about')).toBeUndefined()
    expect(client.slots.filter(slot => slot.options.id === 'desktop-about')).toHaveLength(0)
    expect(client.component('enterprise-account')).toBeTypeOf('function')
    expect(client.component('desktop-usage')).toBeTypeOf('function')
  })

  it('uses the named enterprise About bridge before the legacy desktop bridge', async () => {
    const settingsInfo = vi.fn(async () => ({ desktopVersion: '1.2.3', harnessVersion: '0.2.2' }))
    const settingsAction = vi.fn(async () => {})
    const legacyInfo = vi.fn(), legacyAction = vi.fn()
    const client = loadClient({
      dshDesktopEnterprise: { settingsInfo, settingsAction },
      dshDesktop: { settingsInfo: legacyInfo, settingsAction: legacyAction }
    })
    const About = client.component('desktop-about')
    render(client, About)
    await tick()
    let tree = render(client, About)
    expect(text(tree)).toContain('1.2.3')
    expect(text(tree)).toContain('0.2.2')
    for (const [label, action] of [['update', 'check-for-updates'], ['logs', 'show-harness-log'], ['recovery', 'safe-mode']]) {
      await button(tree, label).props.onClick()
      expect(settingsAction).toHaveBeenLastCalledWith(action)
      tree = render(client, About)
    }
    expect(settingsInfo).toHaveBeenCalledOnce()
    expect(legacyInfo).not.toHaveBeenCalled()
    expect(legacyAction).not.toHaveBeenCalled()
    client.hooks.dispose()
  })

  it('keeps installed legacy settings APIs usable with their owning object', async () => {
    const legacy = {
      version: 'legacy-version',
      settingsInfo: vi.fn(function () { return Promise.resolve({ desktopVersion: this.version }) }),
      settingsAction: vi.fn(function () { expect(this).toBe(legacy); return Promise.resolve() })
    }
    const client = loadClient({ dshDesktop: legacy })
    const About = client.component('desktop-about')
    render(client, About)
    await tick()
    const tree = render(client, About)
    expect(text(tree)).toContain('legacy-version')
    await button(tree, 'logs').props.onClick()
    expect(legacy.settingsAction).toHaveBeenCalledWith('show-harness-log')
    client.hooks.dispose()
  })

  it('renders only available About capabilities and reports rejected actions', async () => {
    const client = loadClient({ dshDesktopEnterprise: { settingsAction: vi.fn(async () => { throw new Error('offline') }) } })
    const About = client.component('desktop-about')
    let tree = render(client, About)
    expect(nodes(tree).some(node => node.type === 'dl')).toBe(false)
    await button(tree, 'update').props.onClick()
    tree = render(client, About)
    expect(nodes(tree).find(node => node.props?.role === 'alert')?.props.children).toEqual(['actionError'])
    client.hooks.dispose()
  })

  it('reports version failures and ignores responses arriving after unmount', async () => {
    const client = loadClient({ dshDesktopEnterprise: { settingsInfo: () => { throw new Error('unavailable') } } })
    const About = client.component('desktop-about')
    render(client, About)
    await tick()
    const tree = render(client, About)
    expect(text(tree)).toContain('infoError')
    expect(button(tree, 'update')).toBeUndefined()
    client.hooks.dispose()

    let resolve
    const late = loadClient({ dshDesktopEnterprise: { settingsInfo: () => new Promise(done => { resolve = done }) } })
    const LateAbout = late.component('desktop-about')
    render(late, LateAbout)
    await tick()
    late.hooks.dispose()
    resolve({ desktopVersion: 'stale-version' })
    await tick()
    expect(text(render(late, LateAbout))).not.toContain('stale-version')
  })

  it('shows and invokes the current mobile pairing capability', async () => {
    const openMobilePairing = vi.fn(async () => {})
    const client = loadClient({ dshDesktop: { openMobilePairing } })
    const Launcher = client.component('desktop-account-menu')
    const tree = render(client, Launcher, { wide: true, openSettings: vi.fn() })
    const phone = nodes(tree).find(node => node.props?.onSelect && text(node) === 'phone')
    expect(phone).toBeDefined()
    phone.props.onSelect()
    await tick()
    expect(openMobilePairing).toHaveBeenCalledOnce()
    client.hooks.dispose()
  })

  it('hides mobile pairing when the capability is absent, including Safe Mode', () => {
    const client = loadClient({ dshDesktop: { protocolVersion: 1 } })
    const tree = render(client, client.component('desktop-account-menu'), { wide: true, openSettings: vi.fn() })
    expect(nodes(tree).find(node => node.props?.onSelect && text(node) === 'phone')).toBeUndefined()
    client.hooks.dispose()
  })

  it('forwards validated settings events once and releases both subscriptions on reload', () => {
    const subscription = subscriptions()
    const client = loadClient({ dshDesktopEnterprise: subscription.bridge })
    const close = vi.fn(), focus = vi.fn()
    client.window.addEventListener('dsh-desktop:close-settings', close)
    client.window.addEventListener('dsh-desktop:settings-focus', focus)
    const mount = client.effects.get('enterprise: desktop settings events')
    let dispose = mount()
    expect(subscription.close.size).toBe(1)
    expect(subscription.focus.size).toBe(1)
    for (const listener of subscription.close) listener()
    for (const listener of subscription.focus) {
      listener({ section: 'my-tasks', direction: 'previous', ignored: 'extra' })
      listener({ section: 'notifications', direction: 'next' })
      for (const value of [null, {}, { section: 'unknown', direction: 'next' }, { section: 'my-tasks', direction: 'sideways' }]) listener(value)
    }
    expect(close).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledTimes(2)
    expect(focus.mock.calls[0][0].detail).toEqual({ section: 'my-tasks', direction: 'previous' })
    expect(focus.mock.calls[1][0].detail).toEqual({ section: 'notifications', direction: 'next' })
    dispose()
    expect(subscription.close.size).toBe(0)
    expect(subscription.focus.size).toBe(0)
    dispose = mount()
    for (const listener of subscription.close) listener()
    expect(close).toHaveBeenCalledTimes(2)
    dispose()
    expect(subscription.close.size).toBe(0)
    expect(subscription.focus.size).toBe(0)
  })

  it('opens the requested enterprise section from the launcher and releases its event listener', async () => {
    const client = loadClient()
    const Launcher = client.component('desktop-account-menu')
    const openSettings = vi.fn(), openSettingsSection = vi.fn()
    const props = { wide: true, settingsOpen: false, openSettings, openSettingsSection }
    let tree = render(client, Launcher, props)
    const login = nodes(tree).find(node => node.props?.onSelect && text(node) === 'login')
    login.props.onSelect()
    expect(openSettingsSection).toHaveBeenCalledExactlyOnceWith('enterprise-account')
    expect(openSettings).not.toHaveBeenCalled()
    for (const id of [undefined, '', 42, 'unknown', {}, null]) client.window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id } }))
    expect(openSettingsSection).toHaveBeenCalledOnce()
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'desktop-ai-access' } }))
    expect(openSettingsSection).toHaveBeenLastCalledWith('desktop-ai-access')
    // Rerender with the same owner callbacks must not duplicate event subscriptions.
    tree = render(client, Launcher, props)
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))
    expect(openSettingsSection).toHaveBeenCalledTimes(3)
    client.hooks.dispose()
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))
    expect(openSettingsSection).toHaveBeenCalledTimes(3)
    await tick()
  })

  it('opens general settings on older shells without a section callback and publishes actual visibility', async () => {
    const client = loadClient()
    const Launcher = client.component('desktop-account-menu')
    const openSettings = vi.fn(), visibility = vi.fn()
    client.window.addEventListener('dsh-desktop:settings-visibility', event => visibility(event.detail.open))
    let tree = render(client, Launcher, { settingsOpen: false, openSettings })
    nodes(tree).find(node => node.props?.onSelect && text(node) === 'login').props.onSelect()
    expect(openSettings).toHaveBeenCalledOnce()
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))
    expect(openSettings).toHaveBeenCalledTimes(2)
    expect(visibility).toHaveBeenLastCalledWith(false)
    tree = render(client, Launcher, { settingsOpen: true, openSettings })
    expect(visibility).toHaveBeenLastCalledWith(true)
    client.hooks.dispose()
    expect(visibility).toHaveBeenLastCalledWith(false)
    await tick()
  })

  it('handles pending login links through the mounted launcher section callback and unsubscribes', () => {
    const listeners = new Set()
    const client = loadClient({ dshDesktopEnterprise: { onLoginLink: listener => { listeners.add(listener); listener('bisheng://login/fixture'); return () => listeners.delete(listener) } } })
    const openSettingsSection = vi.fn()
    render(client, client.component('desktop-account-menu'), { openSettings: vi.fn(), openSettingsSection })
    expect(openSettingsSection).toHaveBeenCalledExactlyOnceWith('enterprise-account')
    expect(listeners.size).toBe(1)
    client.hooks.dispose()
    expect(listeners.size).toBe(0)
  })

  it('passes the section owner close and focus callbacks through AiAccess and invokes them from bridge messages', async () => {
    const subscription = subscriptions()
    const state = { connected: true, settingsProtocolVersion: 1, navigation: { settings: { aiAccess: true } } }
    const client = loadClient({ dshDesktopEnterprise: subscription.bridge, dshEnterpriseChat: { subscribe: () => () => {}, state: async () => state } })
    const releaseBridge = client.effects.get('enterprise: desktop settings events')()
    const releaseCapabilities = client.effects.get('enterprise: account capabilities')()
    await tick()
    const close = vi.fn(), focusShell = vi.fn()
    const tree = render(client, client.component('desktop-ai-access'), { close, focusShell })
    const remote = nodes(tree).find(node => node.props?.section === 'ai-access')
    expect(remote.props.close).toBe(close)
    expect(remote.props.focusShell).toBe(focusShell)
    render(client, remote.type, remote.props)
    for (const listener of subscription.focus) {
      listener({ section: 'ai-access', direction: 'previous' })
      listener({ section: 'ai-access', direction: 'next' })
      listener({ section: 'my-tasks', direction: 'next' })
      listener({ section: 'ai-access', direction: 'invalid' })
    }
    for (const listener of subscription.close) listener()
    expect(close).toHaveBeenCalledOnce()
    expect(focusShell.mock.calls).toEqual([['previous'], ['next']])
    expect(client.document.querySelector).not.toHaveBeenCalled()
    client.hooks.dispose()
    for (const listener of subscription.close) listener()
    for (const listener of subscription.focus) listener({ section: 'ai-access', direction: 'next' })
    expect(close).toHaveBeenCalledOnce()
    expect(focusShell).toHaveBeenCalledTimes(2)
    releaseCapabilities(); releaseBridge()
  })

  it('uses the latest mounted section callbacks after rerender and supports missing optional focus on old shells', async () => {
    const state = { connected: true, settingsProtocolVersion: 1, navigation: { settings: { aiAccess: true } } }
    const client = loadClient({ dshEnterpriseChat: { subscribe: () => () => {}, state: async () => state } })
    const release = client.effects.get('enterprise: account capabilities')()
    await tick()
    const oldClose = vi.fn(), close = vi.fn(), focusShell = vi.fn()
    let tree = render(client, client.component('desktop-ai-access'), { close: oldClose, focusShell })
    let remote = nodes(tree).find(node => node.props?.section === 'ai-access')
    render(client, remote.type, remote.props)
    tree = render(client, client.component('desktop-ai-access'), { close })
    remote = nodes(tree).find(node => node.props?.section === 'ai-access')
    render(client, remote.type, remote.props)
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:close-settings'))
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'ai-access', direction: 'next' } }))
    expect(close).toHaveBeenCalledOnce()
    expect(oldClose).not.toHaveBeenCalled()
    expect(focusShell).not.toHaveBeenCalled()
    client.hooks.dispose(); release()
  })

  it('returns approval focus to its own active navigation and close refs and closes only its owner', async () => {
    const client = loadClient({ dshEnterpriseChat: { subscribe: () => () => {}, state: async () => ({ connected: true }) } })
    const launcher = render(client, client.component('desktop-account-menu'), { openSettings: vi.fn() })
    const dialog = nodes(launcher).find(node => node.type?.name === 'ApprovalsDialog')
    const onClose = vi.fn()
    const dialogTree = render(client, dialog.type, { ...dialog.props, open: true, onClose })
    const panel = nodes(dialogTree).find(node => node.type?.name === 'ApprovalsPanel')
    let panelTree = render(client, panel.type, panel.props)
    const nav = nodes(panelTree).find(node => node.props?.className === 'dshApprovalsNavCell' && node.props['aria-current'] === 'true')
    const navFocus = vi.fn(), closeFocus = vi.fn()
    nav.props.ref({ focus: navFocus })
    const closeButton = nodes(panelTree).find(node => node.props?.className === 'dshApprovalsClose')
    closeButton.props.ref.current = { focus: closeFocus }
    let remote = nodes(panelTree).find(node => node.props?.section === 'my-tasks')
    render(client, remote.type, remote.props)
    for (const direction of ['previous', 'next']) client.window.dispatchEvent(new CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'my-tasks', direction } }))
    expect(navFocus).toHaveBeenCalledOnce()
    expect(closeFocus).toHaveBeenCalledOnce()
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:close-settings'))
    expect(onClose).toHaveBeenCalledOnce()
    // Switching approval sections moves the callback target and removes the old section listener.
    const notifications = nodes(panelTree).find(node => node.props?.className === 'dshApprovalsNavCell' && node.props.key === 'notifications')
    notifications.props.onClick()
    panelTree = render(client, panel.type, panel.props)
    const nextNav = nodes(panelTree).find(node => node.props?.className === 'dshApprovalsNavCell' && node.props['aria-current'] === 'true')
    const nextFocus = vi.fn()
    nextNav.props.ref({ focus: nextFocus })
    remote = nodes(panelTree).find(node => node.props?.section === 'notifications')
    render(client, remote.type, remote.props)
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'my-tasks', direction: 'previous' } }))
    expect(navFocus).toHaveBeenCalledOnce()
    client.window.dispatchEvent(new CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'notifications', direction: 'previous' } }))
    expect(nextFocus).toHaveBeenCalledOnce()
    expect(client.document.querySelector).not.toHaveBeenCalled()
    client.hooks.dispose()
    await tick()
  })

  it('does not require settings event subscriptions in Web', () => {
    const client = loadClient()
    expect(() => client.effects.get('enterprise: desktop settings events')()()).not.toThrow()
  })
})
