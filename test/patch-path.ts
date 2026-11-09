import { existsSync } from 'node:fs'
import path from 'node:path'

export const projectRoot = path.resolve(import.meta.dirname, '..')

// These are upstream source patches, not versioned patch-package artifacts.
export const maintainedPatchNames = [
  'harness-web-3080-unified',
  'profile-resolution-directory-specifier',
  'ui-chat-user-references',
  'ui-conversation-input-slots',
  'ui-workspace-collection'
] as const

export function patchPath(name: string): string {
  if (!maintainedPatchNames.some(candidate => candidate === name)) {
    throw new Error(`unknown maintained source patch: ${name}; use a named patch, not a package specifier`)
  }
  const file = path.join(projectRoot, 'patches', `${name}.patch`)
  if (!existsSync(file)) throw new Error(`missing maintained source patch: ${name}`)
  return file
}

export function hasPatch(name: string): boolean {
  return maintainedPatchNames.some(candidate => candidate === name) &&
    existsSync(path.join(projectRoot, 'patches', `${name}.patch`))
}
