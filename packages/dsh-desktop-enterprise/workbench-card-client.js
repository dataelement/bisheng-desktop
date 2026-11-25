/** Enterprise rendering with V1.3.1 card geometry; no dependency on host-private DOM. */
export function createWorkbenchCard(React, t) {
  const h = React.createElement
  return function WorkbenchCard({ item, kind, accountKey, favorite, busy, installedOnly, onFavorite, description, children }) {
    const [image, setImage] = React.useState('')
    const [detail, setDetail] = React.useState(false)
    const dialog = React.useRef(null)
    const screenshot = item.screenshots?.[0]
    React.useEffect(() => {
      setImage('')
      const controller = new AbortController()
      let objectUrl
      if (kind === 'enterprise' && screenshot?.id && item.currentVersion?.id && accountKey) {
        const query = new URLSearchParams({ id: item.id, versionId: item.currentVersion.id, imageId: screenshot.id })
        void fetch(`/api/enterprise.workbenches/screenshot?${query}`, { credentials: 'same-origin', headers: { 'x-enterprise-account': accountKey }, signal: controller.signal }).then(async response => {
          if (!response.ok) throw new Error(`Screenshot HTTP ${response.status}`)
          const blob = await response.blob()
          if (controller.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setImage(objectUrl)
        }).catch(error => {
          // Failed artwork falls back to a labelled schematic, never an empty card.
          if (!controller.signal.aborted) console.warn('[enterprise-workbench] Preview unavailable', error)
        })
      } else if (kind !== 'enterprise') {
        const candidate = typeof screenshot === 'string' ? screenshot : item.screenshot
        if (typeof candidate === 'string' && /^(https?:\/\/|\/[^/])/.test(candidate)) setImage(candidate)
      }
      return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
    }, [kind, accountKey, item.id, item.currentVersion?.id, screenshot, item.screenshot])
    React.useEffect(() => { if (detail && dialog.current && !dialog.current.open) dialog.current.showModal() }, [detail])
    const preview = image
      ? h('img', { className: 'bishengWorkbenchScreenshot', src: image, alt: item.displayName, loading: 'lazy', onError: () => setImage('') })
      : h('div', { className: 'bishengWorkbenchPreview', role: 'img', 'aria-label': `${item.displayName} · ${t('preview')}` },
        h('div', { className: 'bishengWorkbenchPreviewBar', 'aria-hidden': true }, '•••'),
        h('div', { className: 'bishengWorkbenchPreviewCanvas', 'aria-hidden': true }, [t('chat'), item.displayName].map((title, index) => h('div', { key: index }, h('em'), title, h('i'), h('i')))))
    const version = item.currentVersion?.version || item.version
    const author = typeof item.author === 'string' ? item.author : kind === 'cloud' ? t('hosted') : t(kind === 'market' ? 'market' : 'enterprise')
    return h('article', { className: 'bishengWorkbenchCard' },
      h('div', { className: 'bishengWorkbenchMedia' }, h('button', { type: 'button', className: 'bishengWorkbenchMediaOpen', 'aria-label': `${t('details')} · ${item.displayName}`, onClick: () => setDetail(true) }, preview)),
      h('div', { className: 'bishengWorkbenchCardBody' },
        h('div', { className: 'bishengWorkbenchCardTitle' }, h('h2', { title: item.displayName }, item.displayName), kind === 'cloud' && h('span', { className: 'bishengWorkbenchCategory' }, t('cloud'))),
        h('div', { className: 'bishengWorkbenchAuthor' }, author, version && h('span', null, ` · v${version}`)),
        h('p', { className: 'bishengWorkbenchDescription', title: description }, description),
        h('div', { className: 'bishengWorkbenchActions' },
          !installedOnly && h('button', { type: 'button', className: 'bishengWorkbenchFavorite', disabled: busy, 'aria-label': t(favorite ? 'unfavorite' : 'favorite'), 'aria-pressed': favorite, onClick: onFavorite }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: favorite ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M6 3h12v18l-6-4-6 4z' }))), children)),
      detail && h('dialog', { className: 'bishengWorkbenchDetail', ref: dialog, 'aria-label': item.displayName, onCancel: () => setDetail(false), onClick: event => { if (event.target === dialog.current) setDetail(false) } },
        h('button', { type: 'button', onClick: () => setDetail(false) }, t('close')), h('h2', null, item.displayName), image && h('img', { src: image, alt: item.displayName }), h('p', null, description)))
  }
}

export const collectionStyles = `
.bishengWorkbenchCollection{color:var(--dsw-alias-label-primary);container:bisheng-workbenches / inline-size}
.bishengWorkbenchTools{display:flex;justify-content:flex-end;align-items:center;gap:12px;flex-wrap:wrap;margin-block:12px}

/* Scope the host layout to enterprise collections; keep React nodes and tab semantics in place. */
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools]){display:grid;grid-template-columns:max(var(--dsh-wb-page-gutter),calc((100% - 1376px)/2)) minmax(0,1fr) max-content max(var(--dsh-wb-page-gutter),calc((100% - 1376px)/2));align-content:start}
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools])> :not(.dshWbMarketHeader){grid-column:2/4;width:auto;max-width:none;margin-inline:0;min-width:0}
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools])>.dshWbMarketHeader{grid-column:1/-1}
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools])>.dshWbToolbar{grid-column:2;align-self:center;margin:20px 16px 20px 0;padding-top:0}
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools])>[role=tabpanel],.bishengWorkbenchCollection[data-inline-tools]{display:contents}
.bishengWorkbenchCollection[data-inline-tools]>.bishengWorkbenchTools{grid-column:3;align-self:center;margin:20px 0;flex-wrap:nowrap}
.bishengWorkbenchContent{min-width:0;container:bisheng-workbenches / inline-size}
.bishengWorkbenchCollection[data-inline-tools]>.bishengWorkbenchContent{grid-column:2/4}
.bishengWorkbenchTools .bishengWorkbenchRefresh{display:grid;place-items:center;width:30px;height:30px;min-width:30px;padding:0;flex:none;border-radius:50%}
.bishengWorkbenchEmpty{display:flex;align-items:center;justify-content:center;text-align:center;min-height:240px;padding:32px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-module-platform)}
.bishengWorkbenchEmpty strong{display:block;font-size:15px;margin-bottom:5px}
.bishengWorkbenchEmpty p{color:var(--dsw-alias-label-secondary);margin:0}
.dshWbMarket:has(.bishengWorkbenchCollection) [role=tab]#dsh-workbench-favorites-tab{margin-inline-start:16px;position:relative}
.dshWbMarket:has(.bishengWorkbenchCollection) [role=tab]#dsh-workbench-favorites-tab::before{content:'';position:absolute;left:-16px;top:25%;height:50%;border-left:1px solid var(--dsw-alias-border-l2)}
@container workbench-market (max-width:900px){
.dshWbMarket:has(> [role=tabpanel] > .bishengWorkbenchCollection[data-inline-tools])>.dshWbToolbar{grid-column:2/4;margin-right:0;margin-bottom:0}
.bishengWorkbenchCollection[data-inline-tools]>.bishengWorkbenchTools{grid-column:2/4;flex-wrap:wrap;margin-top:12px}
}

.bishengWorkbenchGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;margin-top:16px}
.bishengWorkbenchCard{position:relative;height:360px;box-sizing:border-box;min-width:0;border:0;border-radius:14px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-module-platform)}
.bishengWorkbenchCard:hover,.bishengWorkbenchCard:focus-within{background:color-mix(in srgb,var(--dsw-alias-bg-module-platform),var(--dsw-alias-label-primary) 5%)}
.bishengWorkbenchCardBody{display:flex;flex-direction:column;gap:8px;padding:16px;min-height:0;flex:1 1 0;box-sizing:border-box;min-width:0}
.bishengWorkbenchCardTitle{display:flex;align-items:center;gap:8px;min-width:0;height:26px;flex:0 0 26px}
.bishengWorkbenchCardTitle h2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px;line-height:26px;letter-spacing:-.018em;font-weight:650;margin:0}
.bishengWorkbenchCategory{flex-shrink:0;font-size:12px;font-weight:600;line-height:18px;padding:2px 9px;border-radius:999px;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-label-primary)}
.bishengWorkbenchAuthor{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:18px}
.bishengWorkbenchDescription{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;height:66px;min-height:66px;max-height:66px;overflow-wrap:anywhere}
.bishengWorkbenchActions{display:flex;margin-top:auto;flex-shrink:0;min-height:36px;gap:8px;padding-top:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.bishengWorkbenchActions details{max-width:100%;font-size:12px;position:relative}
.bishengWorkbenchActions details[open]{position:absolute;inset:16px;z-index:2;overflow:auto;padding:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.bishengWorkbenchMedia{position:relative;aspect-ratio:3/1;max-height:120px;flex-shrink:0;margin:16px 16px 0;border-radius:6px;overflow:hidden}
.bishengWorkbenchTools :is(button,input,select),.bishengWorkbenchCard button,.bishengWorkbenchCollection dialog button{font:inherit;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit}
.bishengWorkbenchCollection button{cursor:pointer}.bishengWorkbenchCollection button:disabled{opacity:.5;cursor:not-allowed}
.bishengWorkbenchCollection button:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.bishengWorkbenchActions button{font-size:12px;line-height:18px;padding:6px 11px}
.bishengWorkbenchCollection .bishengWorkbenchFavorite{display:inline-grid;place-items:center;width:30px;height:30px;flex:0 0 30px;padding:0;border-radius:50%;color:var(--dsw-alias-label-secondary)}
.bishengWorkbenchActions .bishengWorkbenchPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);border-color:var(--dsw-alias-label-primary);border-radius:8px}
.bishengWorkbenchActions .bishengWorkbenchUninstall{border-radius:999px;border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.bishengWorkbenchFavorite[aria-pressed=true]{color:var(--dsw-alias-label-primary)}
.bishengWorkbenchCollection .bishengWorkbenchMediaOpen{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;border-radius:6px;background:transparent;overflow:hidden}
.bishengWorkbenchScreenshot{display:block;width:100%;height:100%;object-fit:cover}
.bishengWorkbenchPreview{position:absolute;inset:0;display:grid;grid-template-rows:22px 1fr;background:var(--dsw-alias-bg-module-platform);overflow:hidden;color:var(--dsw-alias-label-secondary);text-align:left}
.bishengWorkbenchPreviewBar{padding:0 9px;letter-spacing:4px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.bishengWorkbenchPreviewCanvas{display:grid;grid-template-columns:1.45fr 1fr;min-height:0}.bishengWorkbenchPreviewCanvas>div{padding:13px;min-width:0;font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bishengWorkbenchPreviewCanvas>div+div{border-left:1px solid var(--dsw-alias-border-l2)}
.bishengWorkbenchPreviewCanvas i{height:4px;background:var(--dsw-alias-border-l2);display:block;border-radius:2px;margin-top:9px;width:78%}.bishengWorkbenchPreviewCanvas i:last-child{width:48%}.bishengWorkbenchPreviewCanvas em{display:block;width:28px;height:28px;border-radius:7px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);margin-bottom:12px}
.bishengWorkbenchCollection dialog{background:var(--dsw-alias-bg-layer-1);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;max-width:420px;max-height:85vh;overflow:auto;padding:24px}
.bishengWorkbenchCollection .bishengWorkbenchConfirm{box-sizing:border-box;width:calc(100vw - 48px);max-width:430px;padding:24px;border:0;border-radius:14px;box-shadow:0 18px 52px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent)}
.bishengWorkbenchConfirm::backdrop{background:color-mix(in srgb,var(--dsw-alias-label-primary) 52%,transparent)}
.bishengWorkbenchConfirm h2{margin:0;font-size:18px;line-height:26px}.bishengWorkbenchConfirm p{margin:12px 0 0;font-size:14px;line-height:22px}
.bishengWorkbenchConfirmIcon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--dsw-alias-bg-module-platform);margin-bottom:18px}
.bishengWorkbenchConfirmActions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.bishengWorkbenchConfirm .bishengWorkbenchDanger{color:var(--dsw-alias-state-error-primary)}
.bishengWorkbenchCollection .bishengWorkbenchDetail{max-width:880px;width:80%}.bishengWorkbenchDetail img{display:block;max-width:100%;max-height:60vh;object-fit:contain;margin:auto}.bishengWorkbenchDetail>button{float:right}
@container bisheng-workbenches (max-width:760px){.bishengWorkbenchGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container bisheng-workbenches (max-width:520px){.bishengWorkbenchGrid{grid-template-columns:minmax(0,1fr)}}
`
