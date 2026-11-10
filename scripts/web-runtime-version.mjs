import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const WEB_HARNESS_VERSION = '0.2.2-rc.1'

export async function checkWebHarnessVersion(modules) {
  for (const name of ['dsh', 'dsh-app-boot', 'dsh-base', 'dsh-web-app', 'dsh-plugin-manager']) {
    const packageName = `@deepseek-ai/${name}`
    const manifest = JSON.parse(await readFile(path.join(modules, packageName, 'package.json'), 'utf8'))
    if (manifest.name !== packageName || manifest.version !== WEB_HARNESS_VERSION) {
      throw new Error(`Expected ${packageName}@${WEB_HARNESS_VERSION}, found ${manifest.name}@${manifest.version}`)
    }
  }
}
