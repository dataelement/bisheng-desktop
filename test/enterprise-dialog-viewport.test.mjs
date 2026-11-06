import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { chatDialogViewportScript } from '../src/main/enterprise/chat-dialog-viewport'

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
      expect(dom.window.getComputedStyle(document.getElementById('root')).backgroundColor).toBe('rgb(20, 20, 22)')
      const style = document.getElementById('dsh-window-dialog-viewport')
      const css = style.textContent
      dom.window.eval(chatDialogViewportScript(bounds))
      expect(document.querySelectorAll('#dsh-window-dialog-viewport')).toHaveLength(1)
      expect(document.getElementById('dsh-window-dialog-viewport')).toBe(style)
      expect(style.textContent).toBe(css)
      dom.window.eval(chatDialogViewportScript(undefined))
      expect(document.documentElement.dataset.dshChatViewport).toBeUndefined()
      expect(document.getElementById('dsh-window-dialog-viewport')).toBeNull()
    }
  } finally { dom.window.close() }
})
