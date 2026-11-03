import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'

// Execute the real installed patch, rather than a duplicate listener fixture.
const source = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js', 'utf8')
const start = source.indexOf('const navigate = (event) => {')
const end = source.indexOf('}, [rows, openSection, close]);', start)
if (start < 0 || end < 0) throw new Error('V1.3.0 settings navigation listener was not applied')
const scope = {}
runInNewContext('this.listen = (window, rows, openSection, close = () => {}) => {' + source.slice(start, end) + '}', scope)

it('navigates the existing Settings shell to the registered account section', () => {
  const dom = new JSDOM('')
  const openSection = vi.fn()
  const dispose = scope.listen(dom.window, [{ id: 'enterprise-account' }], openSection)
  dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))
  expect(openSection).toHaveBeenCalledExactlyOnceWith('enterprise-account')
  dispose()
  dom.window.close()
})

it('ignores unknown targets and releases the listener when its owner unloads', () => {
  const dom = new JSDOM('')
  const openSection = vi.fn()
  const dispose = scope.listen(dom.window, [{ id: 'enterprise-account' }], openSection)
  const send = id => dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:open-settings-section', { detail: { id } }))
  send('unregistered')
  send({ id: 'enterprise-account' })
  expect(openSection).not.toHaveBeenCalled()
  dispose()
  send('enterprise-account')
  expect(openSection).not.toHaveBeenCalled()
  dom.window.close()
})
