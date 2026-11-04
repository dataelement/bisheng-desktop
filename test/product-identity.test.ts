import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTERPRISE_IDENTITY, PUBLIC_IDENTITY, resolveProductIdentity } from '../src/main/product-identity'

const appDataPath = join('test-root', 'app-data')

describe('product identity', () => {
  it.each([
    [false, 'BISHENG', 'bisheng'],
    [true, 'BISHENG Dev', 'bisheng-dev']
  ])('preserves enterprise identity and data paths (development=%s)', (developmentBuild, name, directory) => {
    const userDataPath = join(appDataPath, directory)
    expect(resolveProductIdentity(ENTERPRISE_IDENTITY, { appDataPath, developmentBuild, environment: {} }))
      .toEqual({ name, userDataPath, dshHome: join(userDataPath, 'harness') })
  })

  it('uses only a nonempty enterprise development override', () => {
    const environment = { BISHENG_DEV_USER_DATA: '/custom/profile' }
    expect(resolveProductIdentity(ENTERPRISE_IDENTITY, { appDataPath, developmentBuild: true, environment }))
      .toEqual({ name: 'BISHENG Dev', userDataPath: '/custom/profile', dshHome: join('/custom/profile', 'harness') })
    expect(resolveProductIdentity(ENTERPRISE_IDENTITY, { appDataPath, developmentBuild: false, environment }).userDataPath)
      .toBe(join(appDataPath, 'bisheng'))
    expect(resolveProductIdentity(ENTERPRISE_IDENTITY, { appDataPath, developmentBuild: true, environment: { BISHENG_DEV_USER_DATA: '' } }).userDataPath)
      .toBe(join(appDataPath, 'bisheng-dev'))
  })

  it.each([
    [false, 'DSH Desktop', 'dsh-desktop'],
    [true, 'DSH Desktop Dev', 'dsh-desktop-dev']
  ])('declares independent public identity and paths (development=%s)', (developmentBuild, name, directory) => {
    const userDataPath = join(appDataPath, directory)
    expect(resolveProductIdentity(PUBLIC_IDENTITY, { appDataPath, developmentBuild, environment: { BISHENG_DEV_USER_DATA: '/enterprise' } }))
      .toEqual({ name, userDataPath, dshHome: join(userDataPath, 'harness') })
    expect(PUBLIC_IDENTITY.migration).toBe('none')
  })

  it('allows an independent public development override only in development', () => {
    const environment = { DSH_DESKTOP_DEV_USER_DATA: '/public/custom' }
    expect(resolveProductIdentity(PUBLIC_IDENTITY, { appDataPath, developmentBuild: true, environment }).userDataPath).toBe('/public/custom')
    expect(resolveProductIdentity(PUBLIC_IDENTITY, { appDataPath, developmentBuild: false, environment }).userDataPath).toBe(join(appDataPath, 'dsh-desktop'))
  })
})
