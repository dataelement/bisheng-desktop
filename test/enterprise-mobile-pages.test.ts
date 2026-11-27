import { describe, expect, it } from 'vitest'
import { createEnterpriseMobileExtension } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-extension'
import { renderMobilePage } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-pages'

const account = { readMobileAccessAccount: () => ({}), subscribeMobileAccessAccount: () => () => {} }

describe('enterprise mobile product name', () => {
  it.each(['zh', 'en'] as const)('passes the name through the extension in %s', locale => {
    const render = createEnterpriseMobileExtension(account, '/unused', 'Example Dev').renderPage
    if (!render) throw new Error('Mobile renderer missing')
    const html = render(locale)
    expect(html).toContain('<title>Example Dev</title>')
    expect(html).toContain('content="Example Dev"')
    expect(html).toContain(locale === 'zh' ? '在 Example Dev 中' : 'in Example Dev.')
    expect(html).not.toContain('<title>BISHENG</title>')
  })
  it('escapes markup in text, attributes, script and empty workspace option', () => {
    const name = `A & "<script>alert(1)</script>'s`
    const html = renderMobilePage({ locale: 'en', productName: name })
    expect(html).toContain('<title>A &amp; &quot;&lt;script&gt;alert(1)&lt;/script&gt;&#39;s</title>')
    expect(html).toContain('alt="A &amp; &quot;&lt;script&gt;alert(1)&lt;/script&gt;&#39;s"')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('\u003cscript>')
    expect(html).toContain('esc(L.noWorkspaces)')
    const serialized = html.match(/const L=(.*);/m)?.[1]
    if (!serialized) throw new Error('Mobile copy missing')
    expect(JSON.parse(serialized).noWorkspaces).toContain(name)
  })
})
