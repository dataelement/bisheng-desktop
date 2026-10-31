import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { canonicalizeOfficeText } from '../scripts/office-runtime/prepare-templates.mjs'

const exec = promisify(execFile)
const sources = 'packages/dsh-desktop-office/sources'
const license = `${sources}/curated/government-notice/OFL.txt`
const scratch = []
afterEach(async () => { for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true }) })

it('checks out office template text as LF when Windows autocrlf is enabled', async () => {
  const { stdout: listed } = await exec('git', ['ls-files', '-z', '--', sources])
  const text = listed.split('\0').filter(file => /\.(txt|md|json)$/.test(file))
  expect(text).toContain(license)
  const { stdout: attrs } = await exec('git', ['check-attr', 'eol', '--', ...text])
  const lines = attrs.trim().split('\n')
  expect(lines).toHaveLength(text.length)
  for (const line of lines) expect(line).toMatch(/: eol: lf$/)

  const root = await mkdtemp(join(tmpdir(), 'office-template-eol-'))
  scratch.push(root)
  await exec('git', ['-c', 'core.autocrlf=true', 'checkout-index', '-f', `--prefix=${root}/`, '--', ...text])
  for (const file of text) expect((await readFile(join(root, file))).includes(13), file).toBe(false)
  const checkedOut = await readFile(join(root, license))
  const { stdout: pinned } = await exec('git', ['show', `:${license}`], { encoding: 'buffer' })
  expect(createHash('sha256').update(checkedOut).digest('hex')).toBe(createHash('sha256').update(pinned).digest('hex'))
  expect(checkedOut.includes(Buffer.from('SIL Open Font License'))).toBe(true)
})

it('canonicalizes a CRLF notice license back to the pinned LF bytes before packaging', async () => {
  const source = await readFile(license)
  expect(source.includes(13)).toBe(false)
  const root = await mkdtemp(join(tmpdir(), 'office-template-crlf-'))
  scratch.push(root)
  await writeFile(join(root, 'OFL.txt'), source.toString('latin1').replace(/\n/g, '\r\n'), 'latin1')
  await canonicalizeOfficeText(root)
  const restored = await readFile(join(root, 'OFL.txt'))
  expect(restored.equals(source)).toBe(true)
  expect(createHash('sha256').update(restored).digest('hex')).toBe('9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903')
})
