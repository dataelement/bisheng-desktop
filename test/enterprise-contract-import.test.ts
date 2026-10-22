import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('enterprise contract package export', () => {
  it('can dynamically import the pure contract functions', async () => {
    const contract = await import('dsh-desktop-enterprise/contract')
    expect(contract.CLIENT_ID).toBe('dsh-desktop')
    expect(contract.CONTRACT_VERSION).toBe('0.5.0')
    expect(typeof contract.createPkceTransaction).toBe('function')
    expect(typeof contract.parseToken).toBe('function')
    expect(typeof contract.parseModels).toBe('function')
    expect(typeof contract.normalizeAuditContext).toBe('function')
    expect(contract.normalizeAuditContext({ request_kind: 'chat' }, ['request_kind'])).toEqual({ request_kind: 'chat' })
    const pkce = contract.createPkceTransaction()
    expect(contract.pkceChallenge(pkce.codeVerifier)).toBe(pkce.codeChallenge)
  })

  it('can dynamically import deep-link helpers from the package export', async () => {
    const deepLink = await import('dsh-desktop-enterprise/deep-link')
    expect(deepLink.ENTERPRISE_LOGIN_PROTOCOL).toBe('bisheng')
    expect(deepLink.ENTERPRISE_LOGIN_DEV_PROTOCOL).toBe('bisheng-dev')
    expect(deepLink.normalizeEnterpriseServerUrl('https://bisheng.example.com')).toBe(
      'https://bisheng.example.com'
    )
  })

  it('keeps the registered protocols aligned with the deep-link contract', async () => {
    const [packageText, loginLink, developmentConfig] = await Promise.all([
      readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      readFile(path.join(projectRoot, 'src/main/enterprise/login-link.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'electron-builder.dev.cjs'), 'utf8')
    ])
    const packageJson = JSON.parse(packageText) as {
      build: { appId: string; protocols: Array<{ schemes: string[] }> }
    }
    const deepLink = await import('dsh-desktop-enterprise/deep-link')

    expect(packageJson.build.appId).toBe('io.bisheng')
    expect(packageJson.build.protocols[0]?.schemes).toEqual([deepLink.ENTERPRISE_LOGIN_PROTOCOL])
    expect(loginLink).toContain(
      `export const ENTERPRISE_LOGIN_PROTOCOL = '${deepLink.ENTERPRISE_LOGIN_PROTOCOL}'`
    )
    expect(loginLink).toContain(
      `export const ENTERPRISE_LOGIN_DEV_PROTOCOL = '${deepLink.ENTERPRISE_LOGIN_DEV_PROTOCOL}'`
    )
    expect(developmentConfig).toContain(`appId: 'io.bisheng.dev'`)
    expect(developmentConfig).toContain(`schemes: ['${deepLink.ENTERPRISE_LOGIN_DEV_PROTOCOL}']`)
  })
})
