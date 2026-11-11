import { describe, expect, it } from 'vitest'
import {
  enterpriseLoginDeepLinkFromArgv,
  isInsecurePrivateHttpOrigin,
  normalizeEnterpriseServerUrl,
  parseEnterpriseLoginDeepLink
} from '../packages/dsh-desktop-enterprise/deep-link.js'

describe('BiSheng enterprise deep link', () => {
  it('accepts only the fixed login destination and one server origin', () => {
    const parsed = parseEnterpriseLoginDeepLink(
      'bisheng://login?server=https%3A%2F%2Fbisheng.example.com'
    )
    expect(parsed.serverUrl).toBe('https://bisheng.example.com')
    expect(parsed.url).toBe('bisheng://login?server=https%3A%2F%2Fbisheng.example.com')
  })

  it('accepts the development login scheme without changing the server origin', () => {
    const parsed = parseEnterpriseLoginDeepLink(
      'bisheng-dev://login?server=https%3A%2F%2Fbisheng.example.com'
    )
    expect(parsed.serverUrl).toBe('https://bisheng.example.com')
    expect(parsed.url).toBe('bisheng-dev://login?server=https%3A%2F%2Fbisheng.example.com')
  })

  it.each(['http://127.0.0.1:17860', 'http://[::1]:17860'])('allows literal loopback HTTP without a development opt-in: %s', (base) => {
    expect(normalizeEnterpriseServerUrl(base, { allowInsecureLoopback: false })).toBe(base)
    expect(isInsecurePrivateHttpOrigin(base)).toBe(false)
    expect(parseEnterpriseLoginDeepLink('bisheng://login?server=' + encodeURIComponent(base)).serverUrl).toBe(base)
  })

  it.each([
    'http://8.8.8.8',
    'http://bisheng.example.com:8080',
    'http://bisheng.internal',
    'http://localhost:17860',
    'http://192.168.106.119:30006',
    'http://10.1.2.3',
    'http://172.15.0.1',
    'http://172.32.0.1',
    'http://[fd12:3456::1]',
    'http://[2001:db8::1]'
  ])('requires confirmation for every non-loopback HTTP origin: %s', (base) => {
    expect(() => normalizeEnterpriseServerUrl(base)).toThrow('explicit confirmation')
    expect(() => normalizeEnterpriseServerUrl(base, { allowInsecureLoopback: true })).toThrow('explicit confirmation')
    expect(isInsecurePrivateHttpOrigin(base)).toBe(true)
    expect(normalizeEnterpriseServerUrl(base, { allowInsecurePrivateHttp: true })).toBe(base)
    const link = 'bisheng://login?server=' + encodeURIComponent(base)
    expect(() => parseEnterpriseLoginDeepLink(link)).toThrow('explicit confirmation')
    expect(parseEnterpriseLoginDeepLink(link, { allowInsecurePrivateHttp: true }).serverUrl).toBe(base)
  })

  it('keeps HTTPS warning-free', () => {
    expect(normalizeEnterpriseServerUrl('https://bisheng.example.com')).toBe('https://bisheng.example.com')
    expect(isInsecurePrivateHttpOrigin('https://bisheng.example.com')).toBe(false)
    expect(isInsecurePrivateHttpOrigin('not a URL')).toBe(false)
  })

  it.each([
    'bisheng://login?server=https%3A%2F%2Fbisheng.example.com&code=legacy',
    'bisheng://login?server=https%3A%2F%2Fbisheng.example.com&server=https%3A%2F%2Fother.example.com',
    'bisheng://login/path?server=https%3A%2F%2Fbisheng.example.com',
    'bisheng://other?server=https%3A%2F%2Fbisheng.example.com',
    'bisheng://login?server=https%3A%2F%2Fuser%3Asecret%40bisheng.example.com',
    'bisheng://login?server=ftp%3A%2F%2Fbisheng.example.com'
  ])('rejects an unsafe or legacy link: %s', (link) => {
    expect(() => parseEnterpriseLoginDeepLink(link)).toThrow()
  })

  it('finds a valid login argument without accepting a malformed one', () => {
    expect(enterpriseLoginDeepLinkFromArgv([
      '/Applications/DSH Desktop.app',
      'bisheng://login?server=https%3A%2F%2Fbisheng.example.com&code=legacy',
      'bisheng://login?server=https%3A%2F%2Fbisheng.example.com'
    ])?.serverUrl).toBe('https://bisheng.example.com')
  })
})
