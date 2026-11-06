import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import semver from 'semver'
import { createTemplateLibrary } from '../packages/dsh-desktop-office/lib/templates.js'
import { prepareOfficeWebPackage, packOfficeWebArchive } from '../scripts/pack-office-web.mjs'

it('assembles a native relocatable Web plugin with complete templates and no host singleton bundle', async () => {
  const built = await prepareOfficeWebPackage({ outputRoot: resolve('.build/office-web-test') })
  const manifest = JSON.parse(await readFile(join(built.packageDirectory, 'package.json'), 'utf8'))
  expect(manifest.main).toBe('./web-index.js')
  expect(manifest.dependencies['@deepseek-ai/libreoffice-kit']).toBe('0.1.5')
  expect(manifest.peerDependencies['@deepseek-ai/libreoffice-kit']).toBeUndefined()
  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  expect(manifest.peerDependencies['@deepseek-ai/dsh-skill-office']).toBeUndefined()
  expect(manifest.peerDependencies['@deepseek-ai/dsh-tool-workspace-dependencies']).toBeUndefined()
  for (const [name, range] of Object.entries(manifest.peerDependencies)) if (name.startsWith('@deepseek-ai/dsh-')) {
    expect(semver.satisfies('0.2.1-rc.2', range)).toBe(true)
    expect(semver.satisfies('0.2.2-alpha.3', range)).toBe(true)
    expect(semver.satisfies('0.3.0-alpha.1', range)).toBe(false)
  }
  const vendor = await readFile(join(built.packageDirectory, 'vendor/official.js'), 'utf8')
  expect(vendor).toContain('from "@deepseek-ai/dsh-tools"')
  expect(vendor).toContain('from "@deepseek-ai/dsh-skill"')
  expect(vendor).not.toContain('class ToolsService')
  const provenance = JSON.parse(await readFile(join(built.packageDirectory, 'vendor/provenance.json'), 'utf8'))
  expect(provenance.map(item => item.name)).toEqual(['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies', 'yaml'])
  for (const item of provenance) expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
  const resources = join(built.packageDirectory, 'resources')
  expect((await readdir(join(resources, 'office-skills'))).length).toBe(7)
  expect((await readdir(join(resources, 'business-skills'))).length).toBe(7)
  const library = await createTemplateLibrary(join(resources, 'templates'))
  const entries = await library.list()
  expect(entries.length).toBe(7)
  for (const item of entries) for (const [file, hash] of Object.entries(library.entry(item.id).files)) {
    expect(createHash('sha256').update(await library.asset(item.id, file)).digest('hex')).toBe(hash)
  }
  const { stdout } = await promisify(execFile)(join(resources, 'primary-runtime/dependencies/python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'), ['-I', '-B', '-c', 'import docx,openpyxl,numpy,pandas,pptx; print("payload-ok")'])
  expect(stdout.trim()).toBe('payload-ok')
  const skill = await readFile(join(resources, 'office-skills/office-docx/SKILL.md'), 'utf8')
  expect(skill).not.toContain('Electron CLI')
  expect(skill).not.toContain('process.resourcesPath')
}, 300000)

it('rejects cross-target preview builds before creating resources', async () => {
  const target = process.platform === 'darwin' ? 'win-x64' : 'mac-arm64'
  await expect(prepareOfficeWebPackage({ target })).rejects.toThrow('native target')
})

it('preserves an existing archive and package when npm pack fails', async () => {
  const outputRoot = await mkdtemp(resolve('.build/office-pack-failure-'))
  try {
    const archive = join(outputRoot, 'dsh-desktop-office-0.1.0.tgz')
    const packageDirectory = join(outputRoot, 'package-preserved.json')
    await writeFile(archive, 'previous-valid-archive')
    await writeFile(packageDirectory, 'previous-valid-package')
    const npmCli = join(outputRoot, 'failing-npm.mjs')
    await writeFile(npmCli, 'process.stderr.write("injected pack failure"); process.exit(7)')
    await expect(packOfficeWebArchive({ packageDirectory, outputRoot }, { npmCli })).rejects.toThrow('injected pack failure')
    expect(await readFile(archive, 'utf8')).toBe('previous-valid-archive')
    expect(await readFile(packageDirectory, 'utf8')).toBe('previous-valid-package')
    expect((await readdir(outputRoot)).some(name => name.startsWith('.pack-'))).toBe(false)
  } finally { await rm(outputRoot, { recursive: true, force: true }) }
})
