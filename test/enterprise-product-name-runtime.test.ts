import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DesktopHostProcess } from '../src/main/shell/backend/host-process'

it.each(['BISHENG', 'BISHENG Dev'])('carries %s into the real Host child environment', async productName => {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-product-name-'))
  const report = join(directory, 'report.json')
  const host = new DesktopHostProcess({
    node: createRequire(import.meta.url)('electron') as string,
    entry: join(import.meta.dirname, 'enterprise-product-host-fixture.mjs'),
    runtimeDir: directory, projectDir: directory, dshHome: join(directory, 'harness'),
    profile: 'desktop', environment: { FIXTURE_REPORT: report, DSH_DESKTOP_PRODUCT_NAME: productName }
  })
  try {
    await host.start()
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      productName, profile: 'desktop', home: join(directory, 'harness')
    })
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
