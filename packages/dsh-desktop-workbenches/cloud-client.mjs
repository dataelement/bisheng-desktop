/** Host-only UI. Hosted application code is never imported into Harness. */
export function createCloudComponents(React, ctx) {
  const h = React.createElement
  const NS = 'bisheng-cloud-workbenches'
  const copy = {
    zh: { unavailable: '当前企业服务未提供云端工作台接口，请联系管理员确认服务端版本。', loginRequired: '云端工作台使用你当前的毕昇账号，登录后即可使用。', login: '登录毕昇账号', retry: '重新打开', accessRequired: '访问已失效，请重新打开工作台；如已退出，请先登录毕昇账号。', title: '企业云端', refresh: '刷新', loading: '正在加载工作台…', empty: '暂无可使用的云端工作台，可通过「制作我的工作台」与 Agent 开始制作。', open: '打开工作台', add: '加载到工作台', desktop: '请在毕昇客户端登录企业账号后使用云端工作台。', failed: '操作失败，请重试。' },
    en: { unavailable: 'This enterprise server does not provide cloud workbench APIs. Contact your administrator to check the server version.', loginRequired: 'Cloud workbenches use your current BiSheng account. Sign in to continue.', login: 'Sign in to BiSheng', retry: 'Open again', accessRequired: 'Access expired. Open the workbench again, or sign in to your BiSheng account again.', title: 'Enterprise cloud', refresh: 'Refresh', loading: 'Loading workbenches…', empty: 'No cloud workbenches available. Start with your Agent through “Make my workbench”.', open: 'Open workbench', add: 'Add to workbenches', desktop: 'Sign in to your enterprise in the BiSheng desktop client.', failed: 'The operation failed. Please retry.' }
  }
  ctx.locale.register(NS, copy)
  const bridge = () => {
    const value = window.dshDesktopEnterprise
    if (!value?.cloudRequest) throw new Error('BiSheng Desktop is required.')
    return value
  }
  function useCopy(service) {
    return service.ctx.locale.bind(NS)
  }
  function CloudFrame({ service, entry, active, conversation }) {
    const t = useCopy(service)
    const node = React.useRef(null)
    const [error, setError] = React.useState('')
    const [attempt, setAttempt] = React.useState(0)
    const showConversation = conversation?.props?.style?.display === 'contents'
    React.useEffect(() => {
      if (!active || showConversation || !node.current) return
      const owner = `cloud_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const api = bridge()
      let disposed = false
      setError('')
      const unsubscribe = api.onCloudAccessRequired?.(value => { if (!disposed && value.owner === owner) setError(t('accessRequired')) })
      const bounds = () => { const r = node.current.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      void api.openCloudWorkbench(entry.appId, bounds(), entry.connectionKey, owner).then(() => { if (disposed) void api.closeCloudWorkbench(owner) }).catch(error => { if (!disposed) setError(error.message) })
      const observer = new ResizeObserver(() => { void api.resizeCloudWorkbench(bounds(), owner).catch(() => undefined) })
      observer.observe(node.current)
      return () => { disposed = true; unsubscribe?.(); observer.disconnect(); void api.closeCloudWorkbench(owner).catch(() => undefined) }
    }, [active, entry.id, showConversation, attempt])
    return h('section', { ref: node, style: { flex: 1, minHeight: 0, height: '100%', width: '100%' }, 'aria-label': entry.title },
      error && h('div', { role: 'alert' }, h('p', null, error), h('button', { type: 'button', className: 'dshWbBtn', onClick: () => setAttempt(value => value + 1) }, t('retry'))), showConversation && conversation,
      !active && h('span', null, t('title')))
  }
  return { CloudFrame }
}
