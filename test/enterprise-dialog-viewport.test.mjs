import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { chatDialogViewportScript, guardChatDialogViewportScript } from '../src/main/enterprise/chat-dialog-viewport'

it('installs a persistent content seat and preserves transparent client overlays', () => {
  const dom = new JSDOM('<head><style>.dsh-knowledge-overlay { background: transparent; }</style></head><body><main id="root"></main><div class="dsh-knowledge-overlay"></div><div role="dialog">Upload</div></body>', { runScripts: 'outside-only' })
  try {
    const { document } = dom.window
    const bounds = { x: 280, y: 40, width: 800, height: 900, windowWidth: 1080, windowHeight: 940, background: '#141416' }
    for (const theme of ['light', 'dark']) {
      document.documentElement.className = theme
      dom.window.eval(chatDialogViewportScript(bounds))
      expect(document.documentElement.dataset.dshChatViewport).toBe('ready')
      expect(dom.window.getComputedStyle(document.querySelector('.dsh-knowledge-overlay')).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(dom.window.getComputedStyle(document.getElementById('root')).width).toBe('800px')
      expect(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-chat-window-width')).toBe('1080px')
      expect(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-chat-viewport-top')).toBe('40px')
      expect(dom.window.getComputedStyle(document.getElementById('root')).backgroundColor).toBe('rgb(20, 20, 22)')
      const style = document.getElementById('dsh-window-dialog-viewport')
      const css = style.textContent
      dom.window.eval(chatDialogViewportScript(bounds))
      expect(document.querySelectorAll('#dsh-window-dialog-viewport')).toHaveLength(1)
      expect(document.getElementById('dsh-window-dialog-viewport')).toBe(style)
      expect(style.textContent).toBe(css)
      dom.window.eval(chatDialogViewportScript({ ...bounds, y: 0, width: 700, windowWidth: 980 }))
      expect(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-chat-window-width')).toBe('980px')
      expect(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-chat-viewport-top')).toBe('0px')
      dom.window.eval(chatDialogViewportScript(undefined))
      expect(document.documentElement.dataset.dshChatViewport).toBeUndefined()
      expect(document.getElementById('dsh-window-dialog-viewport')).toBeNull()
      expect(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-chat-window-width')).toBe('')
    }
  } finally { dom.window.close() }
})

it('ignores late viewport deliveries from another page or an earlier resize', () => {
  const dom = new JSDOM('<main id="root"></main>', {
    runScripts: 'outside-only',
    url: 'https://enterprise.example/workspace/knowledge'
  })
  try {
    const { document } = dom.window
    const pathname = dom.window.location.pathname
    const bounds = { x: 0, y: 48, width: 1080, height: 892, windowWidth: 1080, windowHeight: 940, background: '#141416' }
    const current = chatDialogViewportScript(bounds)
    const old = chatDialogViewportScript({ ...bounds, x: 280, width: 800 })
    const deliver = (script, path, revision) => dom.window.eval(guardChatDialogViewportScript(script, path, revision))

    deliver(old, '/workspace/c/new', 1)
    expect(document.documentElement.dataset.dshChatViewport).toBeUndefined()
    deliver(current, pathname, 3)
    deliver(old, pathname, 2)
    expect(document.getElementById('dsh-window-dialog-viewport').textContent).toContain('width: 1080px; height: 892px')

    deliver(chatDialogViewportScript(undefined), pathname, 4)
    deliver(current, pathname, 3)
    expect(document.getElementById('dsh-window-dialog-viewport')).toBeNull()
  } finally { dom.window.close() }
})
