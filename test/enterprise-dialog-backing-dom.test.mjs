import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { chatDialogBackingScript, clearChatDialogBackingScript } from '../src/main/enterprise/chat-dialog-backing'
const frame = { dataURL: 'data:image/png;base64,fixture', bounds: { x: 240, y: 40, width: 800, height: 700 } }
const deferred = () => { let resolve; const promise = new Promise(finish => { resolve = finish }); return { promise, resolve } }

it('keeps the image out of hit testing and isolates stale cleanup by scope and revision', async () => {
  const dom = new JSDOM('<body><main id="root"></main></body>', { runScripts: 'outside-only', pretendToBeVisual: true })
  try {
    dom.window.HTMLImageElement.prototype.decode = async () => {}
    await dom.window.eval(chatDialogBackingScript('first', 1, frame))
    const first = dom.window.document.querySelector('#dsh-chat-dialog-backing')
    if (!first) throw new Error('Backing image was not mounted.')
    expect(first.style.pointerEvents).toBe('none')
    expect(first.style.left).toBe('240px')
    expect(first.getAttribute('aria-hidden')).toBe('true')
    await dom.window.eval(chatDialogBackingScript('first', 3, frame))
    dom.window.eval(clearChatDialogBackingScript('first', 2))
    expect(dom.window.document.querySelectorAll('#dsh-chat-dialog-backing')).toHaveLength(1)
    await dom.window.eval(chatDialogBackingScript('other-account', 1, frame))
    dom.window.eval(clearChatDialogBackingScript('first', 100))
    expect(dom.window.document.querySelectorAll('#dsh-chat-dialog-backing')).toHaveLength(1)
    dom.window.eval(clearChatDialogBackingScript('other-account', 1))
    expect(dom.window.document.querySelector('#dsh-chat-dialog-backing')).toBeNull()
  } finally { dom.window.close() }
})

it('cannot resurrect an image removed while decode is pending', async () => {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true })
  try {
    const decoded = deferred()
    dom.window.HTMLImageElement.prototype.decode = () => decoded.promise
    const holding = dom.window.eval(chatDialogBackingScript('first', 1, frame))
    dom.window.eval(clearChatDialogBackingScript('first', 2))
    decoded.resolve()
    expect(await holding).toBe(false)
    expect(dom.window.document.querySelector('#dsh-chat-dialog-backing')).toBeNull()
  } finally { dom.window.close() }
})
