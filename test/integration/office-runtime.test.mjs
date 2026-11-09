/**
 * Opt in after preparing the native Office payload:
 * DSH_TEST_OFFICE_RUNTIME=1 npx vitest run test/integration/office-runtime.test.mjs
 * An explicitly enabled run fails if its payload or Electron executable is missing.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, copyFile, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { electronExecutable } from '../../scripts/electron-node-loader.mjs'

const root = resolve(import.meta.dirname, '../..')
const exec = promisify(execFile)
// x64 Python and Electron run under Rosetta on the shared ARM64 CI host.
// Allow their cold starts extra time without relaxing other platforms' limits.
const slowIntelCi = process.env.CI === 'true' && process.platform === 'darwin' && process.arch === 'x64'
const officeTestTimeoutMs = slowIntelCi ? 240_000 : 60_000
const scratch = []
const temporary = async () => {
  const path = await mkdtemp(join(tmpdir(), 'dsh-office-test-'))
  scratch.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.env.DSH_TEST_OFFICE_RUNTIME !== '1')('prepared Office payload and Electron integration (DSH_TEST_OFFICE_RUNTIME=1)', () => {
  beforeAll(async () => {
    const payload = join(root, '.build/office-runtime')
    const python = join(payload, 'primary-runtime/dependencies/python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin/python3']))
    try {
      await Promise.all([
        access(join(payload, 'primary-runtime/runtime.json')),
        access(join(payload, 'office-skills/office-docx/SKILL.md')),
        access(python),
        access(electronExecutable(root))
      ])
    } catch (cause) {
      throw new Error('DSH_TEST_OFFICE_RUNTIME=1 requires the prepared .build/office-runtime payload and Electron. Run npm run office:prepare and install the target Electron runtime before this integration suite.', { cause })
    }
  })

  it('runs the full packaging gate against the current Office skills and physical resources', async () => {
    const resources = await temporary()
    await symlink(join(root, '.build/office-runtime'), join(resources, 'office-runtime'), process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(root, join(resources, 'app.asar'), process.platform === 'win32' ? 'junction' : 'dir')
    await copyFile(join(root, 'build/office-cli.mjs'), join(resources, 'office-cli.mjs'))
    await copyFile(join(root, 'build/office-engine-resolution.mjs'), join(resources, 'office-engine-resolution.mjs'))
    const { stdout } = await exec(process.execPath, [join(root, 'scripts/verify-office-runtime.cjs'), resources, electronExecutable(root)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 180_000
    })
    expect(stdout).toContain('Packaged Office authoring, structure checks and DOCX/PPTX/XLSX PDF conversion passed')
  }, 190_000)

  it('creates valid Office packages with the prepared Python and checks their document contents', async () => {
    const output = await temporary()
    const runtime = join(root, '.build/office-runtime/primary-runtime')
    const manifest = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'))
    expect(manifest.node).toBeUndefined()
    const python = join(runtime, 'dependencies/python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin/python3']))
    await exec(python, ['-I', '-B', join(root, 'scripts/office-runtime/smoke.py'), output, join(runtime, 'runtime.json')])
    // The current Office skills expose native tools rather than check_office.py.
    for (const [extension, entry] of [['docx', 'word/document.xml'], ['pptx', 'ppt/slides/slide1.xml'], ['xlsx', 'xl/worksheets/sheet1.xml']]) {
      const entries = unzipSync(await readFile(join(output, `sample.${extension}`)))
      expect(entries['[Content_Types].xml']).toBeDefined()
      expect(new TextDecoder().decode(entries[entry])).toContain('Office runtime smoke')
    }
    // ZipInfo's constructor normalizes os.sep on Windows. Set filename after
    // construction so this is truly the malformed Compress-Archive shape.
    await exec(python, ['-I', '-B', '-c', `
import zipfile
from pathlib import Path
p = Path(${JSON.stringify(output)})
with zipfile.ZipFile(p / 'sample.docx') as source, zipfile.ZipFile(p / 'broken.docx', 'w') as bad:
    for name in source.namelist():
        info = zipfile.ZipInfo()
        info.filename = name.replace('/', chr(92))
        bad.writestr(info, source.read(name))
`])
    const malformed = unzipSync(await readFile(join(output, 'broken.docx')))
    expect(Object.keys(malformed)).toContain('word\\document.xml')
    expect(Object.keys(malformed)).not.toContain('word/document.xml')
    // Python's reader also normalizes separators on Windows; the strict
    // preview engine is the portable negative control for this fixture.
    await expect(exec(electronExecutable(root), [join(root, 'build/office-cli.mjs'), 'convert', '--input', join(output, 'broken.docx'), '--output', join(output, 'broken.pdf')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: officeTestTimeoutMs
    })).rejects.toMatchObject({ code: 1 })
  }, officeTestTimeoutMs)
})
