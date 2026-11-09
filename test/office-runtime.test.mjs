import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { officeTarget, downloadAsset, unpackWheel, prepareOfficeRuntime } from '../scripts/office-runtime/prepare.mjs'
import { officeCliAttempts, officeCliCommand, officeCliRetriable, officeCliTimedOut, officeCliTimeoutMs, runOfficeCli } from '../scripts/office-runtime/prepare-templates.mjs'
import { zipSync, strToU8 } from 'fflate'

const root = resolve(import.meta.dirname, '..')
const scratch = []
const temporary = async () => {
  const path = await mkdtemp(join(tmpdir(), 'dsh-office-test-'))
  scratch.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

// Construct only the cache key from authoritative inputs; no prepared payload is needed.
async function assemblyFingerprint(target, lock) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const hash = createHash('sha256').update(JSON.stringify({ target, version, lock, deployment: 'desktop' }))
  hash.update(await readFile(join(root, 'scripts/office-runtime/prepare.mjs')))
  async function tree(directory, prefix = '') {
    const entries = await readdir(join(directory, prefix), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      hash.update(JSON.stringify(name))
      if (entry.isDirectory()) await tree(directory, name)
      else if (entry.isFile()) hash.update(await readFile(join(directory, name)))
      else throw new Error(`Unsupported assembly fixture input: ${name}`)
    }
  }
  const require = createRequire(import.meta.url)
  await tree(join(dirname(require.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'))
  await tree(join(root, 'packages/dsh-desktop-office/business-skills'))
  return hash.digest('hex')
}

describe('Office template preview limits', () => {
  const kitTimeout = stderr => Object.assign(new Error('Command failed'), {
    stderr, code: 1, killed: false, signal: null,
  })

  it('bounds each LibreOffice call to 30 seconds and retries a hang in a new process', async () => {
    expect(officeCliTimeoutMs).toBe(30_000)
    expect(officeCliAttempts).toBe(3)
    const command = officeCliCommand('electron', 'office-cli.mjs', ['render', '--input', 'book.xlsx', '--dpi', '100'])
    expect(command.args).toEqual(['office-cli.mjs', 'render', '--input', 'book.xlsx', '--dpi', '100', '--timeout-ms', '30000'])
    expect(command.timeout).toBe(90_000)
    const hung = kitTimeout('{"code":"timeout","error":"LibreOffice conversion timed out."}\n')
    expect(officeCliTimedOut(hung)).toBe(true)
    expect(officeCliTimedOut(kitTimeout(Buffer.from(hung.stderr)))).toBe(true)
    expect(officeCliTimedOut(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))).toBe(true)
    expect(officeCliTimedOut(kitTimeout('{"code":"invalid-document","error":"bad workbook"}'))).toBe(false)
    const missingPackage = kitTimeout(`{"code":"failed","error":"Cannot find package 'unicode-properties' imported from /work/node_modules/fontkit/dist/module.mjs"}\n`)
    const invalidDocument = kitTimeout('{"code":"invalid-document","error":"bad workbook"}')
    expect(officeCliRetriable(missingPackage)).toBe(true)
    expect(officeCliRetriable(invalidDocument)).toBe(false)

    let calls = 0
    await expect(runOfficeCli('recalculate', async () => {
      calls += 1
      if (calls < 3) throw hung
      return { ok: true }
    })).resolves.toEqual({ ok: true })
    expect(calls).toBe(3)

    await expect(runOfficeCli('recalculate', async () => { throw hung })).rejects.toBe(hung)
    let invalidCalls = 0
    const invalid = invalidDocument
    await expect(runOfficeCli('render', async () => {
      invalidCalls += 1
      throw invalid
    })).rejects.toBe(invalid)
    expect(invalidCalls).toBe(1)

    let missingCalls = 0
    await expect(runOfficeCli('render', async () => {
      missingCalls += 1
      if (missingCalls < 2) throw missingPackage
      return { ok: true }
    })).resolves.toEqual({ ok: true })
    expect(missingCalls).toBe(2)
  })
})

describe('Office runtime assembly', () => {
  it('selects all supported native targets and rejects cross-platform substitutions', () => {
    expect(officeTarget('win32', 'x64')).toBe('win-x64')
    expect(officeTarget('darwin', 'arm64')).toBe('mac-arm64')
    expect(officeTarget('darwin', 'x64')).toBe('mac-x64')
    expect(() => officeTarget('win32', 'arm64')).toThrow('unsupported native target')
  })

  it('retries a timed-out Office download and stores the verified payload', async () => {
    const cache = await temporary()
    const payload = Buffer.from('office-runtime-retry')
    const digest = createHash('sha256').update(payload).digest('hex')
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(payload)
    }
    try {
      const saved = await downloadAsset('https://example.test/runtime.tar.gz', digest, cache)
      expect(calls).toBe(2)
      expect(await readFile(saved)).toEqual(payload)
    } finally {
      globalThis.fetch = original
    }
  })

  it('does not retry an Office download that the server rejects', async () => {
    const cache = await temporary()
    const digest = createHash('sha256').update('missing').digest('hex')
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response('missing', { status: 404 })
    }
    try {
      await expect(downloadAsset('https://example.test/missing.tar.gz', digest, cache)).rejects.toThrow('HTTP 404')
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects corrupt cached input and removes stale payload when preparation fails', async () => {
    const cache = await temporary()
    const digest = createHash('sha256').update('good').digest('hex')
    await writeFile(join(cache, digest), 'bad')
    await expect(downloadAsset('https://invalid.example/archive', digest, cache)).rejects.toThrow('checksum mismatch')
    const target = officeTarget()
    const lock = JSON.parse(await readFile(join(root, 'scripts/office-runtime/lock.json'), 'utf8'))
    await writeFile(join(cache, lock.targets[target].pythonSha256), 'corrupt Python')
    const output = await temporary()
    await writeFile(join(output, 'runtime.json'), 'stale build')
    await expect(prepareOfficeRuntime({ target, cache, output })).rejects.toThrow('checksum mismatch')
    await expect(readFile(join(output, 'runtime.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses matching assembly and rebuilds when its Python executable is missing', async () => {
    const output = await temporary()
    const cache = await temporary()
    const target = officeTarget()
    const lock = JSON.parse(await readFile(join(root, 'scripts/office-runtime/lock.json'), 'utf8'))
    await writeFile(join(cache, lock.targets[target].pythonSha256), 'corrupt Python')
    await writeFile(join(output, '.assembly-fingerprint'), await assemblyFingerprint(target, lock))
    const python = join(output, 'primary-runtime/dependencies/python', ...(target === 'win-x64' ? ['python.exe'] : ['bin/python3']))
    await mkdir(resolve(python, '..'), { recursive: true })
    await writeFile(python, '')
    await writeFile(join(output, 'primary-runtime/runtime.json'), '{}')
    await mkdir(join(output, 'office-skills/office-docx'), { recursive: true })
    await writeFile(join(output, 'office-skills/office-docx/SKILL.md'), '')
    await mkdir(join(output, 'business-skills'))
    await expect(prepareOfficeRuntime({ target, output, cache })).resolves.toBeUndefined()
    await rm(python)
    await expect(prepareOfficeRuntime({ target, output, cache })).rejects.toThrow('checksum mismatch')
    await expect(readFile(join(output, '.assembly-fingerprint'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects wheel paths that escape site-packages or use unsupported installation schemes', async () => {
    const output = await temporary()
    for (const entry of ['../escaped', 'C:/escaped', 'lib\\bad.py', 'package.data/purelib/extra.py']) {
      const wheel = join(output, 'bad.whl')
      await writeFile(wheel, zipSync({ [entry]: strToU8('bad') }))
      await expect(unpackWheel(wheel, join(output, 'site-packages'))).rejects.toThrow(/unsafe wheel|unsupported wheel/)
    }
  })
})
