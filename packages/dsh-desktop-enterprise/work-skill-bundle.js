import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** Validate the whole package before writing a private, immutable generation. */
export function validateWorkSkillBundle(bundle, expectedUri) {
  if (!bundle || bundle.uri !== expectedUri || typeof bundle.content !== 'string' ||
      !/^[a-f0-9]{64}$/.test(bundle.version) || !Array.isArray(bundle.files) ||
      bundle.files.length < 1 || bundle.files.length > 512 || !Array.isArray(bundle.tool_ids) ||
      bundle.tool_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid enterprise Skill package.')
  const files = new Map(), folded = new Set()
  let total = 0
  for (const entry of bundle.files) {
    if (typeof entry.path !== 'string' || entry.path.length > 512 ||
        entry.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
        typeof entry.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) throw new Error('Invalid enterprise Skill file.')
    const key = entry.path.normalize('NFC').toLowerCase()
    if (folded.has(key)) throw new Error('Duplicate enterprise Skill file.')
    folded.add(key)
    const bytes = Buffer.from(entry.data, 'base64')
    total += bytes.length
    if (total > 16 * 1024 * 1024 || hash(bytes) !== entry.sha256) throw new Error('Enterprise Skill integrity check failed.')
    files.set(entry.path, bytes)
  }
  if (!files.has('SKILL.md')) throw new Error('Enterprise Skill is missing SKILL.md.')
  const digest = createHash('sha256')
  for (const path of [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    digest.update(path).update('\0').update(createHash('sha256').update(files.get(path)).digest()).update('\0')
  }
  if (digest.digest('hex') !== bundle.version) throw new Error('Enterprise Skill version does not match its files.')
  return files
}

export async function materializeWorkSkill(bundle, expectedUri, signal) {
  const files = validateWorkSkillBundle(bundle, expectedUri)
  signal?.throwIfAborted()
  const root = await mkdtemp(join(tmpdir(), 'bisheng-work-skill-'))
  try {
    for (const [path, data] of files) {
      signal?.throwIfAborted()
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, data, { flag: 'wx', mode: 0o600 })
    }
    signal?.throwIfAborted()
    return { root, dispose: () => rm(root, { recursive: true, force: true }) }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
