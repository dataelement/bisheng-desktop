import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { hasPatch, maintainedPatchNames, patchPath } from './patch-path'

it.each(maintainedPatchNames)('resolves maintained source patch %s', name => {
  expect(hasPatch(name)).toBe(true)
  expect(readFileSync(patchPath(name), 'utf8')).toMatch(/^diff --git /)
})

it.each(['@deepseek-ai/dsh', '@deepseek-ai/dsh-client-ui-chat', '../package.json', 'missing'])('rejects non-maintained patch identifier %s', name => {
  expect(hasPatch(name)).toBe(false)
  expect(() => patchPath(name)).toThrow('unknown maintained source patch')
})
