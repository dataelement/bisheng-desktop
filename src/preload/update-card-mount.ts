import { ipcRenderer } from 'electron'
import type { UpdateStatus } from '../shared/contracts'
import { updateCardOuterWidth, updateCardShadowPad } from '../shared/update-card-bounds'
import {
  isNewManualPresentation,
  isUpdateSkipEnabled,
  shouldPresentUpdateCard,
  updateHeadline,
  type UpdateLocale
} from './update-view'

export interface UpdateCardLayout {
  visible: boolean
  width: number
  height: number
}

const ROOT_ID = 'dsh-desktop-update-card'

/**
 * The one desktop update card. Its document is a view that exists only while
 * the card is on screen, so the host here fills that view instead of pinning
 * itself to a window corner.
 */
export function mountUpdateCard(
  document: Document,
  report: (layout: UpdateCardLayout) => void
): {
  applyStatus(status: UpdateStatus): void
  setLocale(locale: UpdateLocale): void
  setTheme(theme: 'dark' | 'light'): void
  setAboutOpen(open: boolean): void
} {
  document.documentElement.style.background = 'transparent'
  document.body.style.margin = '0'
  document.body.style.background = 'transparent'

  const host = document.createElement('div')
  host.id = ROOT_ID
  host.style.cssText = hostStyle('none')
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = styles
  const content = document.createElement('div')
  shadow.append(style, content)
  document.body.appendChild(host)

  let locale: UpdateLocale = 'zh'
  let aboutOpen = false
  let currentStatus: UpdateStatus | undefined
  let dismissedVersion: string | null = null
  let dismissedTransientPhase: UpdateStatus['phase'] | null = null
  let installing = false
  let accepting = false
  let renderedPhase: UpdateStatus['phase'] | null = null
  let reported: UpdateCardLayout = { visible: false, width: 0, height: 0 }
  let layoutAttempts = 0

  const publishLayout = (): void => {
    const visible = host.style.display !== 'none'
    const next = {
      visible,
      width: visible ? host.offsetWidth : 0,
      height: visible ? host.offsetHeight : 0
    }
    if (visible && (next.width === 0 || next.height === 0) && layoutAttempts < 4) {
      layoutAttempts += 1
      requestAnimationFrame(publishLayout)
      return
    }
    layoutAttempts = 0
    if (next.visible === reported.visible && next.width === reported.width && next.height === reported.height) return
    reported = next
    report(next)
  }
  const layoutObserver = new ResizeObserver(() => publishLayout())
  layoutObserver.observe(host)

  const dismissCurrent = (): void => {
    if (!currentStatus) return
    if (currentStatus.availableVersion) dismissedVersion = currentStatus.availableVersion
    else dismissedTransientPhase = currentStatus.phase
    render()
  }

  const skipButton = (status: UpdateStatus): HTMLButtonElement => {
    const skip = button(locale === 'zh' ? '跳过此版本' : 'Skip this version', 'secondary')
    // Accept re-renders this card before the phase leaves "available". Without
    // this lock the new skip button is clickable for the whole download.
    skip.disabled = !isUpdateSkipEnabled(status.phase, accepting)
    skip.addEventListener('click', () => {
      if (skip.disabled || !isUpdateSkipEnabled(status.phase, accepting)) return
      const version = status.availableVersion
      if (!version) return
      // Hiding the card before the main process accepts the skip makes it
      // vanish and then return with the next download event.
      skip.disabled = true
      // Paint uses the negated predicate. A thrown request did not change the
      // phase, so restore that same value. Assigning the enabled flag itself
      // sticks the button in the opposite state.
      const releaseSkip = (): void => {
        skip.disabled = !isUpdateSkipEnabled(status.phase, accepting)
      }
      void ipcRenderer.invoke('updates:skip', version).then((next: UpdateStatus) => {
        if (next.phase === 'idle') {
          dismissCurrent()
          return
        }
        // The reply is the live phase. Downloading is not skippable, so the
        // card follows that reply instead of the phase captured at click time.
        applyStatus(next)
      }).catch((error: unknown) => {
        releaseSkip()
        console.error('[updater] unable to skip update', error)
      })
    })
    return skip
  }

  const paintDownloadProgress = (status: UpdateStatus): void => {
    const headline = updateHeadline(status, locale)
    const description = content.querySelector('.description')
    if (description) description.textContent = headline.description
    const progress = content.querySelector('.progress')
    const value = content.querySelector<HTMLElement>('.progressValue')
    if (!progress || !value) return
    progress.setAttribute('aria-valuenow', String(Math.round(status.percent ?? 0)))
    value.style.width = `${status.percent ?? 0}%`
  }

  const hide = (): void => {
    host.style.cssText = hostStyle('none')
    content.replaceChildren()
    renderedPhase = null
    publishLayout()
  }

  const render = (): void => {
    if (!currentStatus) return
    const status = currentStatus
    const visible = shouldPresentUpdateCard(status, dismissedVersion, dismissedTransientPhase, aboutOpen)
    if (
      visible &&
      renderedPhase === 'downloading' &&
      status.phase === 'downloading' &&
      host.style.display !== 'none'
    ) {
      paintDownloadProgress(status)
      return
    }
    if (!visible) {
      hide()
      return
    }

    host.style.cssText = hostStyle('block')
    const card = element('aside', 'card')
    card.setAttribute('aria-live', 'polite')
    card.setAttribute('aria-label', locale === 'zh' ? 'BISHENG 更新' : 'BISHENG update')

    const row = element('div', 'row')
    const badge = element('span', status.phase === 'error' ? 'badge warning' : 'badge')
    badge.setAttribute('aria-hidden', 'true')
    if (status.phase === 'checking' || status.phase === 'downloading') badge.appendChild(element('span', 'spinner'))
    else badge.innerHTML = updateIcon
    row.appendChild(badge)

    const headline = updateHeadline(status, locale)
    const body = element('div', 'body')
    const title = element('p', 'title')
    title.textContent = headline.title
    body.appendChild(title)

    const description = element('p', 'description')
    description.textContent = status.phase === 'error' && status.message ? status.message : headline.description
    if (description.textContent) body.appendChild(description)

    if (status.phase === 'downloading') {
      const progress = element('div', 'progress')
      progress.setAttribute('role', 'progressbar')
      progress.setAttribute('aria-valuemin', '0')
      progress.setAttribute('aria-valuemax', '100')
      progress.setAttribute('aria-valuenow', String(Math.round(status.percent ?? 0)))
      const value = element('div', 'progressValue')
      value.style.width = `${status.percent ?? 0}%`
      progress.appendChild(value)
      body.appendChild(progress)
    }

    if (status.phase === 'available') {
      const actions = element('div', 'actions')
      const accept = button(locale === 'zh' ? '同意更新' : 'Update now', 'primary')
      accept.disabled = accepting
      accept.addEventListener('click', () => {
        accepting = true
        render()
        void ipcRenderer.invoke('updates:download').catch((error: unknown) => {
          accepting = false
          console.error('[updater] unable to download update', error)
          render()
        })
      })
      actions.append(accept, skipButton(status))
      body.appendChild(actions)
    }

    if (status.phase === 'downloading') {
      const actions = element('div', 'actions')
      actions.appendChild(skipButton(status))
      body.appendChild(actions)
    }

    if (status.phase === 'downloaded') {
      const actions = element('div', 'actions')
      const install = button(
        installing
          ? locale === 'zh' ? '正在重启…' : 'Restarting…'
          : locale === 'zh' ? '重新启动并安装' : 'Restart and install',
        'primary'
      )
      install.disabled = installing
      install.addEventListener('click', () => {
        installing = true
        render()
        void ipcRenderer.invoke('updates:install').catch((error: unknown) => {
          installing = false
          console.error('[updater] unable to install update', error)
          render()
        })
      })
      actions.append(install, skipButton(status))
      body.appendChild(actions)
    }

    row.appendChild(body)
    const close = button('×', 'close')
    close.setAttribute('aria-label', locale === 'zh' ? '关闭' : 'Close')
    close.addEventListener('click', dismissCurrent)
    row.appendChild(close)
    card.appendChild(row)
    content.replaceChildren(card)
    renderedPhase = status.phase
    publishLayout()
  }

  const applyStatus = (status: UpdateStatus): void => {
    if (isNewManualPresentation(status, currentStatus)) {
      dismissedVersion = null
      dismissedTransientPhase = null
    }
    currentStatus = status
    host.dataset.updatePhase = status.phase
    host.dataset.updateManual = String(status.manual)
    if (status.phase === 'error') installing = false
    if (status.phase === 'error' || status.phase === 'downloaded') accepting = false
    render()
  }

  return {
    applyStatus,
    setLocale(next: UpdateLocale): void {
      if (next === locale) return
      locale = next
      render()
    },
    setTheme(next: 'dark' | 'light'): void {
      if (host.dataset.theme === next) return
      host.dataset.theme = next
    },
    setAboutOpen(open: boolean): void {
      if (open === aboutOpen) return
      aboutOpen = open
      render()
    }
  }
}

function hostStyle(display: 'block' | 'none'): string {
  return [
    'box-sizing:border-box',
    `width:${updateCardOuterWidth()}px`,
    `padding:${updateCardShadowPad}px`,
    `display:${display}`,
    'background:transparent',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  ].join(';')
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function button(label: string, className: string): HTMLButtonElement {
  const node = element('button', className)
  node.type = 'button'
  node.textContent = label
  return node
}

const updateIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M19.4 12a7.4 7.4 0 0 1-12.6 5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17.6 3.5v3.4h-3.4M6.4 20.5v-3.4h3.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const styles = `
  :host { color-scheme: light dark; }
  * { box-sizing: border-box; }
  .card {
    color: var(--dsw-alias-label-primary, #202124);
    background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.98));
    border: 1px solid var(--dsw-alias-border-l2, rgba(32, 33, 36, 0.14));
    border-radius: 14px;
    padding: 15px 16px;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(18px);
  }
  .row { display: flex; align-items: flex-start; gap: 12px; }
  .body { min-width: 0; flex: 1; }
  .title { margin: 0; font-size: 14px; font-weight: 650; line-height: 20px; letter-spacing: -0.1px; }
  .description {
    margin: 3px 0 0;
    color: var(--dsw-alias-label-secondary, #666b73);
    font-size: 12.5px;
    line-height: 18px;
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .badge {
    width: 34px;
    height: 34px;
    margin-top: -1px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: #2ea043;
    background: rgba(46, 160, 67, 0.14);
  }
  .badge.warning { color: #d29922; background: rgba(210, 153, 34, 0.16); }
  .spinner {
    width: 16px;
    height: 16px;
    flex: none;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 999px;
    opacity: 0.85;
    animation: spin 0.75s linear infinite;
  }
  .progress {
    height: 5px;
    margin-top: 11px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--dsw-alias-bg-layer-2, rgba(32, 33, 36, 0.1));
  }
  .progressValue {
    height: 100%;
    min-width: 2px;
    border-radius: inherit;
    background: #2ea043;
    transition: width 180ms ease;
  }
  .actions { display: flex; gap: 8px; margin-top: 13px; }
  button { appearance: none; border: 0; font: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
  button:disabled { cursor: default; opacity: 0.55; }
  .primary, .secondary {
    min-height: 32px;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .primary { color: #fff; background: #4d6bfe; }
  .primary:hover:not(:disabled) { background: #3e5de7; }
  .secondary {
    color: var(--dsw-alias-label-secondary, #666b73);
    background: transparent;
    border: 1px solid var(--dsw-alias-border-l2, rgba(32, 33, 36, 0.16));
  }
  .secondary:hover:not(:disabled) {
    color: var(--dsw-alias-label-primary, #202124);
    background: var(--dsw-alias-interactive-bg-hover, rgba(32, 33, 36, 0.06));
  }
  .close {
    width: 24px;
    height: 24px;
    margin: -4px -6px 0 0;
    flex: none;
    color: var(--dsw-alias-label-secondary, #73777f);
    background: transparent;
    border-radius: 7px;
    font-size: 20px;
    line-height: 20px;
  }
  .close:hover { color: var(--dsw-alias-label-primary, #202124); background: rgba(127, 127, 127, 0.1); }
  @keyframes spin { to { transform: rotate(360deg); } }
  :host([data-theme="dark"]) {
    .card {
      color: var(--dsw-alias-label-primary, #f3f4f6);
      background: var(--dsw-alias-bg-layer-1, rgba(31, 32, 35, 0.98));
      border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.42), 0 2px 6px rgba(0, 0, 0, 0.25);
    }
    .description { color: var(--dsw-alias-label-secondary, #a9adb5); }
    .badge { color: #3fb950; background: rgba(63, 185, 80, 0.16); }
    .badge.warning { color: #e3b341; background: rgba(227, 179, 65, 0.18); }
    .secondary {
      color: var(--dsw-alias-label-secondary, #a9adb5);
      border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
    }
    .secondary:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #f3f4f6); background: rgba(255, 255, 255, 0.08); }
    .close:hover { color: var(--dsw-alias-label-primary, #f3f4f6); background: rgba(255, 255, 255, 0.1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
    .progressValue { transition: none; }
  }
`
