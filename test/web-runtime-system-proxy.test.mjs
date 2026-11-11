import { test } from 'vitest'
import assert from 'node:assert/strict'
import { systemProxyEnvironment } from '../build/web-runtime/system-proxy.mjs'

test('respects explicitly configured proxy and bypass values', () => {
  const env = { HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: 'internal.example' }
  const actual = systemProxyEnvironment({ env, platform: 'darwin', run: () => { throw new Error('must not inspect system') } })
  assert.equal(actual.HTTPS_PROXY, env.HTTPS_PROXY)
  assert.equal(actual.NO_PROXY, env.NO_PROXY)
  assert.equal(actual.NODE_USE_ENV_PROXY, '1')
})

test('reads enabled macOS fixed HTTPS proxy and exclusions', () => {
  const output = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\nExceptionsList : <array> {\n  0 : *.example.test\n}\n'
  const actual = systemProxyEnvironment({ env: {}, platform: 'darwin', run: () => output })
  assert.equal(actual.HTTPS_PROXY, 'http://127.0.0.1:7890/')
  assert.match(actual.NO_PROXY, /\.example\.test/)
  assert.match(actual.NO_PROXY, /localhost/)
  assert.equal(actual.NODE_USE_ENV_PROXY, '1')
})

test('reads Windows fixed HTTPS proxy and preserves exclusions', () => {
  const output = '    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    http=proxy.test:80;https=proxy.test:8080\n    ProxyOverride    REG_SZ    *.internal.test;localhost\n'
  const actual = systemProxyEnvironment({ env: {}, platform: 'win32', run: () => output })
  assert.equal(actual.HTTPS_PROXY, 'http://proxy.test:8080/')
  assert.match(actual.NO_PROXY, /\.internal\.test/)
})

test('does not invent a proxy when automatic configuration or invalid settings are present', () => {
  const actual = systemProxyEnvironment({ env: {}, platform: 'darwin', run: () => 'ProxyAutoConfigEnable : 1\nHTTPSEnable : 0\n' })
  assert.equal(actual.HTTPS_PROXY, undefined)
  assert.equal(actual.NODE_USE_ENV_PROXY, undefined)
})

test('does not drop Windows local hostname bypass rules', () => {
  const output = '    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    proxy.test:8080\n    ProxyOverride    REG_SZ    <local>\n'
  const actual = systemProxyEnvironment({ env: {}, platform: 'win32', run: () => output })
  assert.equal(actual.HTTPS_PROXY, undefined)
})
