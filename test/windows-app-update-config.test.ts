import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type UpdatePackContext = {
  electronPlatformName: string
  appOutDir: string
  packager: {
    config: {
      publish: Array<{ provider: string; url: string }> | null
      win?: { signtoolOptions?: { publisherName?: string | string[] } }
    }
    appInfo?: { updaterCacheDirName?: string }
  }
}

const require = createRequire(import.meta.url)
// The pack helper is CommonJS. Name the afterPack input the test drives.
const { writeWindowsAppUpdateConfig } = require('../scripts/windows-app-update-config.cjs') as {
  writeWindowsAppUpdateConfig: (context: UpdatePackContext) => Promise<string | null>
}

const cleanups: string[] = []
const feed = 'https://dshdesktop.com/work/updates/latest/'
const publisher = 'Beijing Shuju Xiangsu Intelligence Technology Co., Ltd.'

afterEach(async () => {
  for (const directory of cleanups.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

function productionContext(appOutDir: string, platform = 'win32'): UpdatePackContext {
  return {
    electronPlatformName: platform,
    appOutDir,
    packager: {
      config: {
        publish: [{ provider: 'generic', url: feed }],
        win: { signtoolOptions: { publisherName: publisher } }
      },
      appInfo: { updaterCacheDirName: 'dsh-desktop-updater' }
    }
  }
}

describe('Windows app-update.yml', () => {
  it('writes the generic feed and publisher name into a Windows package', async () => {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-app-update-'))
    cleanups.push(appOutDir)

    const file = await writeWindowsAppUpdateConfig(productionContext(appOutDir))

    expect(file).toBe(path.join(appOutDir, 'resources', 'app-update.yml'))
    if (file == null) return
    await expect(readFile(file, 'utf8')).resolves.toBe([
      'provider: generic',
      `url: ${JSON.stringify(feed)}`,
      'updaterCacheDirName: "dsh-desktop-updater"',
      'publisherName:',
      `  - ${JSON.stringify(publisher)}`,
      ''
    ].join('\n'))
  })

  it('keeps every configured publisher name', async () => {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-app-update-names-'))
    cleanups.push(appOutDir)
    const context = productionContext(appOutDir)
    context.packager.config.win = { signtoolOptions: { publisherName: ['Primary', 'Renewed'] } }

    const file = await writeWindowsAppUpdateConfig(context)

    expect(file).toBeTruthy()
    if (file == null) return
    const yaml = await readFile(file, 'utf8')
    expect(yaml).toContain('  - "Primary"')
    expect(yaml).toContain('  - "Renewed"')
  })

  it('leaves development packages without a production feed', async () => {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-app-update-dev-'))
    cleanups.push(appOutDir)
    const context = productionContext(appOutDir)
    context.packager.config.publish = null

    await expect(writeWindowsAppUpdateConfig(context)).resolves.toBeNull()
    await expect(access(path.join(appOutDir, 'resources', 'app-update.yml'))).rejects.toThrow()
  })

  it('does not replace the macOS update config electron-builder already writes', async () => {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-app-update-mac-'))
    cleanups.push(appOutDir)

    await expect(writeWindowsAppUpdateConfig(productionContext(appOutDir, 'darwin'))).resolves.toBeNull()
    await expect(access(path.join(appOutDir, 'resources', 'app-update.yml'))).rejects.toThrow()
  })

  it('refuses a Windows package whose publish feed or publisher name is incomplete', async () => {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-app-update-invalid-'))
    cleanups.push(appOutDir)
    const missingPublisher = productionContext(appOutDir)
    missingPublisher.packager.config.win = { signtoolOptions: {} }
    const wrongProvider = productionContext(appOutDir)
    wrongProvider.packager.config.publish = [{ provider: 'github', url: feed }]

    await expect(writeWindowsAppUpdateConfig(missingPublisher)).rejects.toThrow('publisherName')
    await expect(writeWindowsAppUpdateConfig(wrongProvider)).rejects.toThrow('generic')
    await expect(access(path.join(appOutDir, 'resources', 'app-update.yml'))).rejects.toThrow()
  })
})
