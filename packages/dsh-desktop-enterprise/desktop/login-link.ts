import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { sameHarnessOrigin } from './harness-origin'
import { resolveDesktopProtocolScheme } from '../../../src/main/shell/product-identity'

export { sameHarnessOrigin }

export const ENTERPRISE_LOGIN_PROTOCOL = 'bisheng'
export const ENTERPRISE_LOGIN_DEV_PROTOCOL = 'bisheng-dev'

function packagedDevelopmentChannel(): boolean {
  if (!app.isPackaged) return false
  try {
    const metadata = JSON.parse(
      readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
    ) as { dshDesktopChannel?: unknown }
    return metadata.dshDesktopChannel === 'development'
  } catch {
    return false
  }
}

export function enterpriseLoginProtocol(): string {
  // The shell owns the product protocol identity. Enterprise only consumes it
  // for login callbacks, so DSH and downstream products can choose different
  // schemes without copying this parser.
  return resolveDesktopProtocolScheme(readDesktopMetadata(), app.isPackaged)
}

function readDesktopMetadata(): unknown {
  try {
    return JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
  } catch {
    return { dshDesktopChannel: packagedDevelopmentChannel() ? 'development' : undefined }
  }
}

export function allowInsecureEnterpriseLoopback(): boolean {
  return !app.isPackaged
}

export function registerEnterpriseLoginProtocol(): void {
  const scheme = enterpriseLoginProtocol()
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(scheme)
    return
  }
  const scriptPath = process.argv[1] ? resolve(process.argv[1]) : process.cwd()
  app.setAsDefaultProtocolClient(scheme, process.execPath, [scriptPath])
}

export async function parseEnterpriseLoginLink(value: string) {
  const { parseEnterpriseLoginDeepLink } = await import('dsh-desktop-enterprise/deep-link')
  return parseEnterpriseLoginDeepLink(value, {
    protocols: [enterpriseLoginProtocol()],
    allowInsecureLoopback: allowInsecureEnterpriseLoopback(),
    allowInsecurePrivateHttp: true
  })
}

export async function enterpriseLoginFromArgv(argv: readonly string[]) {
  const { enterpriseLoginDeepLinkFromArgv } = await import('dsh-desktop-enterprise/deep-link')
  return enterpriseLoginDeepLinkFromArgv(argv, {
    protocols: [enterpriseLoginProtocol()],
    allowInsecureLoopback: allowInsecureEnterpriseLoopback(),
    allowInsecurePrivateHttp: true
  })
}
