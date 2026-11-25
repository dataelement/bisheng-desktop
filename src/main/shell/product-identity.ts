import { join } from 'node:path'

/** Explicit installation metadata; unrelated package names and branding are not identity inputs. */
export interface DesktopIdentityMetadata {
  productName: string
  userDataDirectory: string
  developmentUserDataDirectory: string
  protocolScheme: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function directory(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) {
    throw new Error(field + ' must be a portable single directory name.')
  }
  return value
}

function protocolScheme(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9+.-]{1,62}$/.test(value) || value.endsWith('-dev')) {
    throw new Error(field + ' must be a valid base protocol scheme.')
  }
  return value
}

export function resolveDesktopProtocolScheme(metadata: unknown, isPackaged: boolean): string {
  const source = record(metadata) ? metadata : {}
  const configured = source.dshDesktopIdentity
  const base = configured && record(configured) && configured.protocolScheme !== undefined
    ? protocolScheme(configured.protocolScheme, 'dshDesktopIdentity.protocolScheme')
    : 'dsh-desktop'
  return !isPackaged || source.dshDesktopChannel === 'development' ? `${base}-dev` : base
}

export function resolveDesktopIdentity(metadata: unknown, isPackaged: boolean, appData: string, env: NodeJS.ProcessEnv = process.env): {
  name: string
  userData: string
} {
  const source = record(metadata) ? metadata : {}
  const configured = source.dshDesktopIdentity
  let identity: DesktopIdentityMetadata = {
    productName: 'DSH Desktop', userDataDirectory: 'dsh-desktop', developmentUserDataDirectory: 'dsh-desktop-dev', protocolScheme: 'dsh-desktop'
  }
  if (configured !== undefined) {
    if (!record(configured)) throw new Error('dshDesktopIdentity must be an object.')
    const productName = configured.productName
    if (typeof productName !== 'string' || !productName.trim() || productName !== productName.trim() || productName.length > 128 || /[\x00-\x1f\x7f/\\]/.test(productName)) {
      throw new Error('dshDesktopIdentity.productName must be a non-empty display name without control characters or path separators.')
    }
    identity = {
      productName,
      userDataDirectory: directory(configured.userDataDirectory, 'dshDesktopIdentity.userDataDirectory'),
      developmentUserDataDirectory: directory(configured.developmentUserDataDirectory, 'dshDesktopIdentity.developmentUserDataDirectory'),
      protocolScheme: configured.protocolScheme === undefined ? 'dsh-desktop' : protocolScheme(configured.protocolScheme, 'dshDesktopIdentity.protocolScheme')
    }
  }
  const development = !isPackaged || source.dshDesktopChannel === 'development'
  const devDirectory = development && env.DSH_DEV_PROFILE
    ? directory(env.DSH_DEV_PROFILE, 'DSH_DEV_PROFILE')
    : identity.developmentUserDataDirectory
  if (identity.userDataDirectory.toLowerCase() === identity.developmentUserDataDirectory.toLowerCase() || (development && devDirectory.toLowerCase() === identity.userDataDirectory.toLowerCase())) {
    throw new Error('Development userData must be separate from production userData.')
  }
  return {
    name: development ? identity.productName + ' Dev' : identity.productName,
    userData: join(appData, development ? devDirectory : identity.userDataDirectory)
  }
}
