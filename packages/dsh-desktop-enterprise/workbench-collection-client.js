import { readCloudCatalog, cloudSurface, readCombinedCatalog, importLegacyFavorites, mergeLegacyCloudCatalog, watchMarketFavoriteTimes } from './cloud-collection-client.js'
/** Enterprise-owned UI; the host supplies React and its existing workbench service. */
export const copy = {
  zh: { revoked: '以下企业工作台已被收回授权并停用，文件和会话仍保留：', accessUnknown: '暂时无法确认企业工作台授权，保留上次状态。', add: '加载到工作台', installed: '已安装', removeCloud: '卸载本机入口', removeCloudHint: '仅卸载本机入口，云端应用、笔记和会话都会保留。', note: '工作台笔记', saveNote: '保存笔记', bindSession: '关联当前会话', records: '已有笔记与会话', session: '打开会话', sourceFailed: '部分来源暂不可用，请刷新重试。', allFavorites: '我的收藏', market: '工作台市场', all: '全部来源', cloud: '云端工作台', back: '返回列表', enterprise: '来自企业', favorites: '企业收藏', loading: '读取中…', refresh: '刷新', empty: '企业暂未提供工作台。', noFavorites: '还没有收藏工作台。', install: '安装', update: '更新', open: '打开', remove: '卸载', cancel: '取消', confirm: '确认卸载', removeHint: '卸载本机插件，保留已有会话、项目文件和收藏。', favorite: '收藏工作台', unfavorite: '取消收藏', unavailable: '已下架或你没有使用权限', failed: '操作失败，请重试。', pending: '处理中…', restart: '安装完成，重启 Harness 后生效。', reload: '安装完成，重新加载页面后生效。', applied: '安装完成。', login: '请先登录企业账号。', search: '搜索工作台', recent: '收藏时间', name: '名称', source: '企业', unknown: '操作结果未确认，请刷新检查后再操作。' },
  en: { revoked: 'Access was revoked for these workbenches. They are disabled; files and sessions are retained:', accessUnknown: 'Enterprise access could not be checked. The previous state is retained.', add: 'Add to workbenches', installed: 'Installed', removeCloud: 'Remove local shortcut', removeCloudHint: 'Only this device’s shortcut is removed. Hosted apps, notes and sessions are retained.', note: 'Workbench notes', saveNote: 'Save notes', bindSession: 'Link current session', records: 'Saved notes and sessions', session: 'Open session', sourceFailed: 'Some sources are unavailable. Refresh to retry.', allFavorites: 'My favorites', market: 'Workbench market', all: 'All sources', cloud: 'Cloud workbenches', back: 'Back to list', enterprise: 'From enterprise', favorites: 'Enterprise favorites', loading: 'Loading…', refresh: 'Refresh', empty: 'Your enterprise has not published workbenches.', noFavorites: 'No favorites yet.', install: 'Install', update: 'Update', open: 'Open', remove: 'Uninstall', cancel: 'Cancel', confirm: 'Confirm uninstall', removeHint: 'Remove the local plugin. Existing sessions, project files and favorites are retained.', favorite: 'Favorite workbench', unfavorite: 'Remove favorite', unavailable: 'Removed, or you no longer have access', failed: 'Operation failed. Please retry.', pending: 'Working…', restart: 'Installed. Restart Harness to apply.', reload: 'Installed. Reload the page to apply.', applied: 'Installed.', login: 'Sign in to your enterprise account first.', search: 'Search workbenches', recent: 'Recently favorited', name: 'Name', source: 'Enterprise', unknown: 'The outcome is unknown. Refresh to inspect before retrying.' }
}
const ROOT = '/api/enterprise.workbenches'
export async function request(path, body, signal, fetcher = fetch) {
  const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error(value.error || `HTTP ${response.status}`), { status: response.status })
  return value
}

export function createCollection(React, ctx, service) {
  const h = React.createElement
  const t = ctx.locale.bind('enterprise.workbenchCollections')
  const CloudSurface = cloudSurface(React, t)
  return function Collection({ favoritesOnly = false, kind = 'enterprise', installedOnly = false, publicMarket = true, defaultContent }) {
    const [opened, setOpened] = React.useState(null)
    const [note, setNote] = React.useState('')
    const [snapshot, setSnapshot] = React.useState({ loading: true, items: [], favorites: [], revision: 0, accountKey: '', error: '' })
    const [busy, setBusy] = React.useState(false)
    const [access, setAccess] = React.useState({ revoked: [], status: '' })
    const [notice, setNotice] = React.useState('')
    const [query, setQuery] = React.useState('')
    const [sort, setSort] = React.useState('recent')
    const [source, setSource] = React.useState('all')
    const [removing, setRemoving] = React.useState(null)
    const dialog = React.useRef(null)
    const lifetime = React.useRef(null)
    const generation = React.useRef(0)
    const operation = React.useRef(false)
    const native = React.useSyncExternalStore(service.subscribe, service.getSnapshot)
    const reload = React.useCallback(async () => {
      const ticket = ++generation.current
      lifetime.current?.abort()
      const controller = new AbortController()
      lifetime.current = controller
      // Clear identity-bound content immediately, including on logout/tenant changes.
      setSnapshot({ loading: true, items: [], favorites: [], revision: 0, accountKey: '', error: '' })
      try {
        let saved = await request(`${ROOT}/favorites`, undefined, controller.signal)
        try {
          const checked = await request('/api/desktop-workbenches/enterprise-access-check', {}, controller.signal)
          if (ticket !== generation.current || controller.signal.aborted) return
          setAccess({ revoked: Array.isArray(checked.revoked) ? checked.revoked : [], status: checked.status })
          if (checked.revoked?.length) await service.refreshNative()
        } catch (error) {
          if (ticket !== generation.current || controller.signal.aborted) return
          setAccess(previous => ({ ...previous, status: 'unknown' }))
        }
        let catalog = kind === 'all' ? await readCombinedCatalog(request, saved.accountKey, controller.signal)
          : kind === 'cloud' ? await readCloudCatalog(request, controller.signal) : await request(`${ROOT}/catalog`, undefined, controller.signal)
        if (kind === 'all' || kind === 'cloud') {
          const legacy = await request(`${ROOT}/cloud`, { operation: 'state' }, controller.signal)
          if (legacy.connectionKey !== saved.accountKey) throw new Error(t('failed'))
          catalog = mergeLegacyCloudCatalog(catalog, legacy.state)
        }
        if (catalog.accountKey !== saved.accountKey) throw new Error(t('failed'))
        saved = await importLegacyFavorites(window.localStorage, saved, catalog.data, request, controller.signal)
        if (ticket !== generation.current || controller.signal.aborted) return
        if (!Array.isArray(catalog.data) || !Array.isArray(saved.items) || catalog.accountKey !== saved.accountKey) throw new Error(t('failed'))
        setSnapshot({ loading: false, items: catalog.data, favorites: saved.items, market: saved.market || {}, failedSources: catalog.failedSources || [], revision: saved.revision, accountKey: saved.accountKey, error: '' })
      } catch (error) {
        if (controller.signal.aborted || ticket !== generation.current) return
        setSnapshot({ loading: false, items: [], favorites: [], revision: 0, accountKey: '', error: error.status === 401 ? t('login') : error.message })
      }
    }, [kind])
    React.useEffect(() => {
      void reload()
      const changed = () => { setAccess({ revoked: [], status: '' }); setOpened(null); setRemoving(null); setNotice(''); setBusy(false); void reload() }
      window.addEventListener('dsh-desktop:enterprise-account-changed', changed)
      const timestamps = event => { const saved = event.detail; setSnapshot(previous => previous.accountKey === saved.accountKey ? { ...previous, market: saved.market || {}, revision: saved.revision } : previous) }
      window.addEventListener('bisheng:favorite-times', timestamps)
      const unsubscribe = window.dshEnterpriseChat?.subscribe?.(changed)
      return () => { generation.current++; lifetime.current?.abort(); unsubscribe?.(); window.removeEventListener('bisheng:favorite-times', timestamps); window.removeEventListener('dsh-desktop:enterprise-account-changed', changed) }
    }, [reload])
    React.useEffect(() => {
      if (removing && dialog.current && !dialog.current.open) dialog.current.showModal()
    }, [removing])
    const run = async fn => {
      if (operation.current) return
      operation.current = true
      const ticket = generation.current
      setBusy(true); setNotice('')
      try { await fn(ticket) }
      catch (error) { if (generation.current === ticket) setNotice(error.message || t('failed')) }
      finally { operation.current = false; if (generation.current === ticket) setBusy(false) }
    }
    const toggle = item => run(async ticket => {
      const rowKind = item.kind || kind
      if (rowKind === 'market') { await service.toggleFavorite(item.id); return }
      const exists = snapshot.favorites.some(record => record.kind === rowKind && record.id === item.id)
      const items = exists ? snapshot.favorites.filter(record => record.kind !== rowKind || record.id !== item.id)
        : [...snapshot.favorites, { kind: rowKind, id: item.id, title: item.displayName, at: Date.now() }]
      try {
        const saved = await request(`${ROOT}/favorites/write`, { accountKey: snapshot.accountKey, revision: snapshot.revision, items })
        if (generation.current === ticket) setSnapshot(previous => ({ ...previous, favorites: saved.items, revision: saved.revision }))
      } catch (error) { await reload(); throw error }
    })
    const install = item => run(async ticket => {
      const result = await request('/api/desktop-workbenches/enterprise-install', { id: item.id })
      if (generation.current !== ticket) return
      if (!['applied', 'restart-required', 'reload-required'].includes(result.application)) throw new Error(result.error || t('unknown'))
      service.recordApplication(item.packageName, result.result, item.workbenchKey || undefined, 'install')
      await service.refreshNative()
      if (generation.current === ticket) setNotice(t(result.application === 'restart-required' ? 'restart' : result.application === 'reload-required' ? 'reload' : 'applied'))
    })
    const changeCloud = async (item, operation, extra = {}) => {
      const result = await request(`${ROOT}/cloud`, { operation, appId: item.id, ...extra }, lifetime.current?.signal)
      if (result.connectionKey !== snapshot.accountKey) throw new Error(t('login'))
      setSnapshot(previous => ({ ...previous, items: mergeLegacyCloudCatalog({ data: previous.items }, result.state).data }))
      return result
    }
    const openCloud = item => run(async ticket => {
      // Native open and web tickets both require a durable local entrance first.
      if (!item.added) await changeCloud(item, 'add')
      await changeCloud(item, 'activate')
      if (generation.current !== ticket) return
      setNote(item.note || '')
      setOpened(item)
    })
    const entries = favoritesOnly ? snapshot.favorites.filter(item => kind === 'all' || item.kind === kind).map(saved => ({ ...saved, ...(snapshot.items.find(item => item.id === saved.id && (!item.kind || item.kind === saved.kind)) || { displayName: saved.title, unavailable: true, temporarilyUnavailable: snapshot.failedSources?.includes(saved.kind) }) })) : snapshot.items
    if (kind === 'all' && publicMarket) for (const id of native.state?.favorites || []) {
      const item = native.catalog?.find(entry => (entry.catalogId || entry.id) === id)
      entries.push({ ...item, id, kind: 'market', displayName: item?.title || snapshot.market?.[id]?.title || id, at: snapshot.market?.[id]?.at || 0, unavailable: !item || item.unavailable, installed: item?.installed })
    }
    const rows = entries.filter(item => !installedOnly || item.added).filter(item => (source === 'all' || (item.kind || kind) === source)).filter(item => `${item.displayName} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === 'name' ? a.displayName.localeCompare(b.displayName) : (b.at || 0) - (a.at || 0))
    if (opened) return h('section', null,
      notice && h('p', { role: 'status' }, notice),
      h('details', null, h('summary', null, t('note')), h('textarea', { 'aria-label': t('note'), maxLength: 200000, value: note, onChange: event => setNote(event.target.value) }),
        h('button', { disabled: busy, onClick: () => { void run(() => changeCloud(opened, 'note', { note })) } }, t('saveNote')),
        service.currentSession?.() && h('button', { disabled: busy, onClick: () => { void run(() => changeCloud(opened, 'bind', { sessionId: service.currentSession() })) } }, t('bindSession'))),
      h(CloudSurface, { item: opened, accountKey: snapshot.accountKey, close: () => setOpened(null) }))
    return h('section', { className: 'bishengWorkbenchCollection', 'aria-label': t(favoritesOnly ? kind === 'all' ? 'allFavorites' : 'favorites' : kind === 'cloud' ? 'cloud' : 'enterprise') },
      access.revoked.length > 0 && h('p', { role: 'status' }, t('revoked'), ' ', access.revoked.join(', ')),
      access.status === 'unknown' && h('p', { role: 'status' }, t('accessUnknown')),
      defaultContent,
      h('div', { className: 'bishengWorkbenchTools' }, h('input', { value: query, onChange: event => setQuery(event.target.value), placeholder: t('search'), 'aria-label': t('search') }), h('select', { value: sort, 'aria-label': t('recent'), onChange: event => setSort(event.target.value) }, h('option', { value: 'recent' }, t('recent')), h('option', { value: 'name' }, t('name'))), h('button', { disabled: busy || snapshot.loading, onClick: () => { void reload() } }, t(snapshot.loading ? 'loading' : 'refresh'))),
      kind === 'all' && h('select', { value: source, 'aria-label': t('all'), onChange: event => setSource(event.target.value) }, ['all', 'enterprise', 'cloud', ...(publicMarket ? ['market'] : [])].map(value => h('option', { key: value, value }, t(value)))),
      snapshot.failedSources?.length > 0 && h('p', { role: 'status' }, t('sourceFailed')),
      snapshot.error && h('p', { role: 'alert' }, snapshot.error), notice && h('p', { role: 'status' }, notice),
      !snapshot.loading && !snapshot.error && !rows.length && h('p', null, t(favoritesOnly ? 'noFavorites' : 'empty')),
      h('div', { className: 'bishengWorkbenchGrid' }, rows.map(item => {
        const rowKind = item.kind || kind
        const bundle = native.native?.bundles?.[item.packageName]
        const installed = bundle && bundle.installed !== false
        const provider = native.catalog?.find(entry => entry.sourcePackage === item.packageName)
        const favorite = snapshot.favorites.some(record => record.kind === rowKind && record.id === item.id) || rowKind === 'market'
        return h('article', { key: `${rowKind}:${item.id}` }, h('header', null, h('h3', null, item.displayName), h('button', { disabled: busy, 'aria-label': t(favorite ? 'unfavorite' : 'favorite'), 'aria-pressed': favorite, onClick: () => { void toggle(item) } }, favorite ? '★' : '☆')),
          h('p', null, item.temporarilyUnavailable ? t('sourceFailed') : item.unavailable ? t('unavailable') : item.description), h('small', null, t(rowKind === 'cloud' ? 'cloud' : rowKind === 'market' ? 'market' : 'source'), item.at ? ` · ${new Date(item.at).toLocaleString()}` : ''),
          rowKind === 'cloud' && (item.note || item.sessions?.length) && h('details', null, h('summary', null, t('records')), item.note && h('p', { style: { whiteSpace: 'pre-wrap' } }, item.note), item.sessions?.map(id => h('button', { key: id, onClick: () => { void run(() => service.openSession(id)) } }, t('session'), ' · ', id))),
          rowKind === 'cloud' && item.added && h('button', { disabled: busy, onClick: () => setRemoving({ item, cloud: true }) }, t('removeCloud')),
          rowKind === 'cloud' && !item.added && !item.unavailable && h('button', { disabled: busy, onClick: () => { void run(() => changeCloud(item, 'add')) } }, t('add')),
          rowKind === 'cloud' && !item.unavailable && h('button', { disabled: busy, onClick: () => {
            if (window.dshDesktopEnterprise?.openCloudWorkbench) { void openCloud(item); return }
            const target = `bisheng_cloud_${Date.now()}`
            const openedWindow = window.open('', target)
            if (!openedWindow) { setNotice(t('failed')); return }
            openedWindow.opener = null
            void run(async ticket => {
              try {
                if (!item.added) await changeCloud(item, 'add')
                await changeCloud(item, 'activate')
                const launch = await request('/api/enterprise.workbenches/cloud', { operation: 'launch', appId: item.id })
                if (generation.current !== ticket || launch.connectionKey !== snapshot.accountKey) { openedWindow.close(); return }
                const form = document.createElement('form'); form.method = 'POST'; form.action = launch.launchUrl; form.target = target
                const field = document.createElement('input'); field.type = 'hidden'; field.name = 'ticket'; field.value = launch.ticket; form.append(field); document.body.append(form)
                try { form.submit() } finally { form.remove() }
              } catch (error) { openedWindow.close(); throw error }
            })
          } }, t('open')),
          rowKind === 'market' && !item.unavailable && h('button', { disabled: busy, onClick: () => { void run(() => item.installed ? service.open(item.id) : service.installFromMarket(item.id)) } }, t(item.installed ? 'open' : 'install')),
          rowKind === 'enterprise' && !item.unavailable && h('footer', null, h('span', null, item.currentVersion?.version),
            installed && provider && h('button', { disabled: busy || bundle.enabled === false, onClick: () => { void run(() => service.open(provider.id)) } }, t('open')),
            (!installed || bundle.version !== item.currentVersion?.version) && h('button', { disabled: busy, onClick: () => { void install(item) } }, t(installed ? 'update' : 'install')),
            installed && bundle.removable === true && h('button', { disabled: busy, onClick: () => setRemoving({ item, provider }) }, t('remove'))))
      })),
      removing && h('dialog', { ref: dialog, onCancel: event => { if (busy) event.preventDefault(); else setRemoving(null) }, 'aria-label': t('confirm') }, h('h3', null, removing.item.displayName), h('p', null, t(removing.cloud ? 'removeCloudHint' : 'removeHint')), h('button', { disabled: busy, onClick: () => setRemoving(null) }, t('cancel')), h('button', { disabled: busy, onClick: () => { const selected = removing; setRemoving(null); void run(async () => {
        if (selected.cloud) { await changeCloud(selected.item, 'remove'); return }
        if (selected.provider) { if (service.state.active === selected.provider.id) await service.leave(); await service.removeWorkbench(selected.provider.id) }
        else { const response = await service.ctx.remote.pluginManager.removeBundle(selected.item.packageName); if (!response.ok || !['applied', 'restart-required', 'reload-required'].includes(response.value?.application)) throw new Error(response.error?.message || t('failed')); service.recordApplication(selected.item.packageName, response.value) }
        await service.refreshNative()
      }) } }, t('confirm'))))
  }
}

export function mountCollections(React, ctx, service) {
  const h = React.createElement
  const disposeLocale = ctx.locale.register('enterprise.workbenchCollections', copy)
  const t = ctx.locale.bind('enterprise.workbenchCollections')
  const Collection = createCollection(React, ctx, service)
  const style = document.createElement('style')
  style.dataset.pluginCss = 'bisheng-workbench-collections'
  style.textContent = '.bishengWorkbenchCollection{color:var(--dsw-alias-label-primary)}.bishengWorkbenchTools,.bishengWorkbenchCollection header,.bishengWorkbenchCollection footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bishengWorkbenchTools{margin-block:12px}.bishengWorkbenchGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}.bishengWorkbenchGrid article{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;min-width:0}.bishengWorkbenchGrid header{justify-content:space-between}.bishengWorkbenchGrid h3{margin:0;overflow-wrap:anywhere}.bishengWorkbenchCollection button,.bishengWorkbenchCollection input,.bishengWorkbenchCollection select{font:inherit;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit}.bishengWorkbenchCollection button:disabled{opacity:.5}.bishengWorkbenchCollection dialog{background:var(--dsw-alias-bg-layer-1);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;max-width:420px}.bishengWorkbenchCollection small{color:var(--dsw-alias-label-secondary)}'
  document.head.appendChild(style)
  const favoriteTimes = watchMarketFavoriteTimes(service, request, Date.now, saved => window.dispatchEvent(new window.CustomEvent('bisheng:favorite-times', { detail: saved })))
  let disposers = registerCollectionTabs(service, t, props => h(Collection, props), false)
  let disposed = false, policyRequest, publicMarket = false
  const refreshPolicy = async () => {
    policyRequest?.abort()
    const controller = new AbortController()
    policyRequest = controller
    try {
      const state = await request('/api/enterprise.state', undefined, controller.signal)
      if (disposed || controller.signal.aborted) return
      const allowed = state.allowThirdPartyWorkbenches === true
      if (allowed === publicMarket) return
      for (const dispose of disposers.reverse()) dispose()
      publicMarket = allowed
      disposers = registerCollectionTabs(service, t, props => h(Collection, props), allowed)
    } catch (error) { if (!disposed && !controller.signal.aborted) console.warn('[enterprise-workbench] Could not refresh market policy', error) }
  }
  void refreshPolicy()
  window.addEventListener('dsh-desktop:enterprise-account-changed', refreshPolicy)
  return () => { disposed = true; favoriteTimes.dispose(); policyRequest?.abort(); window.removeEventListener('dsh-desktop:enterprise-account-changed', refreshPolicy); for (const dispose of disposers.reverse()) dispose(); style.remove(); if (typeof disposeLocale === 'function') disposeLocale() }
}

/** Match V1.3.1: two sources, optional public market, one combined favorites tab, installed. */
export function registerCollectionTabs(service, t, render, publicMarket = true) {
  const disposers = []
  try {
    disposers.push(service.registerMarketCollection({ id: 'enterprise', label: t('enterprise'), order: -20, controls: false, render: () => render({}) }))
    disposers.push(service.registerMarketCollection({ id: 'cloud', label: t('cloud'), order: -10, controls: false, render: () => render({ kind: 'cloud' }) }))
    if (typeof service.getMarketTabs === 'function') {
      disposers.push(service.registerMarketCollection({ id: 'market', replace: true, label: t('market'), order: 0, visible: publicMarket }))
      disposers.push(service.registerMarketCollection({ id: 'favorites', replace: true, label: t('allFavorites'), order: 10, controls: false, render: () => render({ kind: 'all', favoritesOnly: true, publicMarket }) }))
      disposers.push(service.registerMarketCollection({ id: 'mine', replace: true, label: t('installed'), order: 20, render: ({ renderDefault }) => render({ kind: 'cloud', installedOnly: true, defaultContent: renderDefault() }) }))
    } else {
      // Older upstreams cannot replace a built-in collection; keep combined favorites reachable until upgraded.
      disposers.push(service.registerMarketCollection({ id: 'enterprise-all-favorites', label: t('allFavorites'), order: 5, render: () => render({ kind: 'all', favoritesOnly: true }) }))
    }
    return disposers
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
}
