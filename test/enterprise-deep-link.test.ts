import { describe, expect, it } from 'vitest'
import {
  enterpriseLoginDeepLinkFromArgv,
  insecureHttpNeedsConfirmation,
  isInsecureHttpSessionOrigin,
  isInsecureLoopbackHttpOrigin,
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

  it('rejects remote HTTP origins and localhost, even in development', () => {
    expect(() => parseEnterpriseLoginDeepLink(
      'bisheng://login?server=http%3A%2F%2Fbisheng.example.com%3A8080'
    )).toThrow('must use HTTPS')
    expect(() => parseEnterpriseLoginDeepLink(
      'bisheng://login?server=http%3A%2F%2Fbisheng.example.com%3A8080',
      { allowInsecureLoopback: true }
    )).toThrow('127.0.0.1 or [::1]')
    expect(() => normalizeEnterpriseServerUrl('http://localhost:17860', { allowInsecureLoopback: true }))
      .toThrow('127.0.0.1 or [::1]')
  })

  it('allows HTTP only for loopback when explicitly opted in', () => {
    expect(normalizeEnterpriseServerUrl('http://127.0.0.1:17860', { allowInsecureLoopback: true }))
      .toBe('http://127.0.0.1:17860')
    expect(normalizeEnterpriseServerUrl('http://[::1]:17860', { allowInsecureLoopback: true }))
      .toBe('http://[::1]:17860')
    expect(parseEnterpriseLoginDeepLink(
      'bisheng://login?server=http%3A%2F%2F127.0.0.1%3A17860',
      { allowInsecureLoopback: true }
    ).serverUrl).toBe('http://127.0.0.1:17860')
  })

  it('requires confirmation for canonical loopback HTTP unless private HTTP is allowed', () => {
    expect(normalizeEnterpriseServerUrl('https://bisheng.example.com')).toBe('https://bisheng.example.com')
    expect(() => normalizeEnterpriseServerUrl('http://127.0.0.1:17860')).toThrow('explicit confirmation')
    expect(() => normalizeEnterpriseServerUrl('http://[::1]:17860')).toThrow('explicit confirmation')
    expect(normalizeEnterpriseServerUrl('http://127.0.0.1:17860', { allowInsecurePrivateHttp: true }))
      .toBe('http://127.0.0.1:17860')
    expect(normalizeEnterpriseServerUrl('http://[::1]:17860', { allowInsecurePrivateHttp: true }))
      .toBe('http://[::1]:17860')
    expect(parseEnterpriseLoginDeepLink(
      'bisheng://login?server=http%3A%2F%2F127.0.0.1%3A3001',
      { allowInsecureLoopback: false, allowInsecurePrivateHttp: true }
    ).serverUrl).toBe('http://127.0.0.1:3001')
  })

  it('treats numeric loopback spellings as the canonical origin', () => {
    for (const value of [
      'http://127.1:3001',
      'http://2130706433:3001',
      'http://0x7f000001:3001',
      'http://0177.0.0.1:3001'
    ]) {
      expect(() => normalizeEnterpriseServerUrl(value)).toThrow('explicit confirmation')
      expect(normalizeEnterpriseServerUrl(value, { allowInsecurePrivateHttp: true }))
        .toBe('http://127.0.0.1:3001')
    }
  })

  it('rejects loopback lookalikes after the HTTP confirmation flag', () => {
    for (const value of [
      'http://localhost:3001',
      'http://127.0.0.2:3001',
      'http://[::ffff:127.0.0.1]:3001',
      'http://8.8.8.8',
      'http://bisheng.internal'
    ]) {
      expect(() => normalizeEnterpriseServerUrl(value, { allowInsecurePrivateHttp: true }))
        .toThrow('must use HTTPS')
    }
  })

  it('separates loopback confirmation from session permission', () => {
    expect(isInsecureLoopbackHttpOrigin('http://127.0.0.1:3001')).toBe(true)
    expect(isInsecureLoopbackHttpOrigin('http://[::1]:3001')).toBe(true)
    expect(isInsecurePrivateHttpOrigin('http://127.0.0.1:3001')).toBe(false)
    expect(isInsecureHttpSessionOrigin('http://127.0.0.1:3001')).toBe(true)
    expect(isInsecureHttpSessionOrigin('http://10.0.0.8:8080')).toBe(true)
    expect(isInsecureHttpSessionOrigin('https://127.0.0.1:3001')).toBe(false)
    expect(insecureHttpNeedsConfirmation('http://127.0.0.1:3001', { allowInsecureLoopback: false })).toBe(true)
    expect(insecureHttpNeedsConfirmation('http://127.0.0.1:3001', { allowInsecureLoopback: true })).toBe(false)
    expect(insecureHttpNeedsConfirmation('http://10.0.0.8:8080', { allowInsecureLoopback: true })).toBe(true)
    expect(insecureHttpNeedsConfirmation('http://localhost:3001', { allowInsecurePrivateHttp: true })).toBe(false)
  })

  it('allows HTTP private-network IPs only after an explicit opt-in', () => {
    expect(() => normalizeEnterpriseServerUrl('http://192.168.106.119:30006')).toThrow('explicit confirmation')
    expect(() => normalizeEnterpriseServerUrl('http://10.0.0.8:8080', { allowInsecureLoopback: true }))
      .toThrow('explicit confirmation')
    expect(() => normalizeEnterpriseServerUrl('http://8.8.8.8', { allowInsecurePrivateHttp: true }))
      .toThrow('must use HTTPS')
    expect(() => normalizeEnterpriseServerUrl('http://bisheng.internal', { allowInsecurePrivateHttp: true }))
      .toThrow('must use HTTPS')
    expect(normalizeEnterpriseServerUrl('http://192.168.106.119:30006', { allowInsecurePrivateHttp: true }))
      .toBe('http://192.168.106.119:30006')
    expect(normalizeEnterpriseServerUrl('http://10.1.2.3', { allowInsecurePrivateHttp: true }))
      .toBe('http://10.1.2.3')
    expect(normalizeEnterpriseServerUrl('http://172.16.0.1:443', { allowInsecurePrivateHttp: true }))
      .toBe('http://172.16.0.1:443')
    expect(() => normalizeEnterpriseServerUrl('http://172.15.0.1', { allowInsecurePrivateHttp: true }))
      .toThrow('must use HTTPS')
    expect(() => normalizeEnterpriseServerUrl('http://172.32.0.1', { allowInsecurePrivateHttp: true }))
      .toThrow('must use HTTPS')
    expect(normalizeEnterpriseServerUrl('http://[fd12:3456::1]', { allowInsecurePrivateHttp: true }))
      .toBe('http://[fd12:3456::1]')
    expect(parseEnterpriseLoginDeepLink(
      'bisheng://login?server=http%3A%2F%2F192.168.106.119%3A30006',
      { allowInsecurePrivateHttp: true }
    ).serverUrl).toBe('http://192.168.106.119:30006')
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
