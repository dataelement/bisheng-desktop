import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../build/web-runtime/dsh-offline.mjs', import.meta.url))
const cmd = fileURLToPath(new URL('../build/web-runtime/dsh-offline.cmd', import.meta.url))
const names = ['package.json', 'cordis.yml', 'cordis.patch.yml']

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'offline runtime (test) ')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  copyFileSync(source, path.join(root, 'dsh-offline.mjs'))
  copyFileSync(fileURLToPath(new URL('../build/web-runtime/system-proxy.mjs', import.meta.url)), path.join(root, 'system-proxy.mjs'))
  mkdirSync(path.join(root, 'profile'))
  for (const name of names) writeFileSync(path.join(root, 'profile', name), 'template ' + name)
  const entry = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  mkdirSync(path.dirname(entry), { recursive: true })
  writeFileSync(entry,     "console.log(JSON.stringify({ args: process.argv.slice(2), home: process.env.DSH_HOME, flag: process.env.DSH_WEB_RUNTIME, cwd: process.cwd() })); process.exit(23)")
  return root
}

function run(root, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'dsh-offline.mjs'), ...args], { encoding: 'utf8' })
}

test('initializes once and forwards arguments, environment and exit code', t => {
  const root = fixture(t)
  const result = run(root, 'web', '--name', 'hello world')
  assert.equal(result.status, 23, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { args: ['web', '--name', 'hello world'], home: path.join(root, 'data'), flag: '1', cwd: root })
  const profile = path.join(root, 'data', 'profiles', 'web')
  for (const name of names) assert.equal(readFileSync(path.join(profile, name), 'utf8'), 'template ' + name)
  writeFileSync(path.join(profile, 'cordis.yml'), 'user data')
  assert.equal(run(root, '--version').status, 23)
  assert.equal(readFileSync(path.join(profile, 'cordis.yml'), 'utf8'), 'user data')
})

test('missing runtime or template fails before creating data', t => {
  const root = fixture(t)
  rmSync(path.join(root, 'profile', 'cordis.yml'))
  const result = run(root, 'web')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Initialization failed/)
  assert.throws(() => readFileSync(path.join(root, 'data', 'profiles', 'web', 'package.json')))
})

test('preserves incomplete existing profile and fails clearly', t => {
  const root = fixture(t)
  const profile = path.join(root, 'data', 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(path.join(profile, 'package.json'), 'user data')
  const result = run(root, 'web')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Web profile is incomplete: cordis.yml/)
  assert.equal(readFileSync(path.join(profile, 'package.json'), 'utf8'), 'user data')
})

test('Windows command shim delegates without blocks or package installation', () => {
  const text = readFileSync(cmd, 'utf8')
  assert.match(text, /"%~dp0node\\node.exe" "%~dp0dsh-offline.mjs" %\*/i)
  assert.match(text, /exit \/b %errorlevel%/i)
  assert.doesNotMatch(text, /npm|\n\s*if.*\(/i)
})
