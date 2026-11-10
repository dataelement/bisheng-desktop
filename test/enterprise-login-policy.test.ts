import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const application = vi.hoisted(() => ({
  isPackaged: true,
  directory: '',
  getAppPath() { return this.directory }
}))
vi.mock('electron', () => ({ app: application }))
import { allowInsecureEnterpriseLoopback, enterpriseLoginProtocol } from '../src/main/enterprise/login-link'
import { normalizeEnterpriseServerUrl } from '../packages/dsh-desktop-enterprise/deep-link.js'

beforeEach(() => {
  application.isPackaged = true
  application.directory = mkdtempSync(join(tmpdir(), 'bisheng-login-policy-'))
})
afterEach(() => rmSync(application.directory, { recursive: true, force: true }))

it('allows local development without claiming the production login scheme', () => {
  application.isPackaged = false
  expect(allowInsecureEnterpriseLoopback()).toBe(true)
  expect(enterpriseLoginProtocol()).toBe('bisheng-dev')
})

it('connects an explicitly branded development package to loopback only', () => {
  writeFileSync(join(application.directory, 'package.json'), JSON.stringify({ dshDesktopChannel: 'development' }))
  const options = { allowInsecureLoopback: allowInsecureEnterpriseLoopback() }
  expect(normalizeEnterpriseServerUrl('http://127.0.0.1:54130', options)).toBe('http://127.0.0.1:54130')
  expect(normalizeEnterpriseServerUrl('http://[::1]:54130', options)).toBe('http://[::1]:54130')
  expect(() => normalizeEnterpriseServerUrl('http://enterprise.example', options)).toThrow()
  expect(() => normalizeEnterpriseServerUrl('http://192.168.1.1', options)).toThrow('explicit confirmation')
  expect(enterpriseLoginProtocol()).toBe('bisheng-dev')
})

it.each(['{}', '{"dshDesktopChannel":"production"}', '{"dshDesktopChannel":"unknown"}', 'invalid'])
('keeps packaged production or unrecognized metadata fail-closed (%s)', metadata => {
  writeFileSync(join(application.directory, 'package.json'), metadata)
  expect(allowInsecureEnterpriseLoopback()).toBe(false)
  expect(() => normalizeEnterpriseServerUrl('http://127.0.0.1:54130', {
    allowInsecureLoopback: allowInsecureEnterpriseLoopback()
  })).toThrow('HTTPS')
  expect(enterpriseLoginProtocol()).toBe('bisheng')
})

it('keeps missing packaged metadata fail-closed', () => {
  expect(allowInsecureEnterpriseLoopback()).toBe(false)
  expect(enterpriseLoginProtocol()).toBe('bisheng')
})
