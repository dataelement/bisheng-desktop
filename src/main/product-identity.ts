import { join } from 'node:path'

export interface ProductIdentityConfig {
  readonly productionName: string
  readonly developmentName: string
  readonly productionDataDirectory: string
  readonly developmentDataDirectory: string
  readonly developmentDataOverride: string
  readonly migration: 'none'
}

export const ENTERPRISE_IDENTITY: ProductIdentityConfig = {
  productionName: 'BISHENG',
  developmentName: 'BISHENG Dev',
  productionDataDirectory: 'bisheng',
  developmentDataDirectory: 'bisheng-dev',
  developmentDataOverride: 'BISHENG_DEV_USER_DATA',
  migration: 'none'
}

// This describes a future product; it does not enable a public build.
export const PUBLIC_IDENTITY: ProductIdentityConfig = {
  productionName: 'DSH Desktop',
  developmentName: 'DSH Desktop Dev',
  productionDataDirectory: 'dsh-desktop',
  developmentDataDirectory: 'dsh-desktop-dev',
  developmentDataOverride: 'DSH_DESKTOP_DEV_USER_DATA',
  migration: 'none'
}

export function resolveProductIdentity(
  config: ProductIdentityConfig,
  options: { appDataPath: string; developmentBuild: boolean; environment: Readonly<Record<string, string | undefined>> }
): { name: string; userDataPath: string; dshHome: string } {
  const { appDataPath, developmentBuild, environment } = options
  const name = developmentBuild ? config.developmentName : config.productionName
  const directory = developmentBuild ? config.developmentDataDirectory : config.productionDataDirectory
  const userDataPath = (developmentBuild && environment[config.developmentDataOverride]) || join(appDataPath, directory)
  return { name, userDataPath, dshHome: join(userDataPath, 'harness') }
}
