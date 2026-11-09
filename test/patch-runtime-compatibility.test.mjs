import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { expect, it } from 'vitest'

import { maintainedPatchNames, patchPath } from './patch-path'

const require = createRequire(import.meta.url)
const patches = maintainedPatchNames.map(name => readFileSync(patchPath(name), 'utf8'))
// Source patches target upstream TypeScript. Check their installed runtime outputs
// rather than silently accepting an empty list of patched JavaScript files.
const runtimeTargets = {
  'packages/boot/app-boot/': 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  'packages/client/ui-chat/': 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',
  'packages/client/ui-conversation/': 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
  'packages/client/ui-workspace/': 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'
}
const patchedSources = [...new Set(patches.flatMap(patch =>
  [...patch.matchAll(/^\+\+\+ b\/(.*\/src\/.*\.tsx?)$/gm)].map(match => match[1])
))]
const patchedJs = [...new Set(patchedSources.map(file => {
  const target = Object.entries(runtimeTargets).find(([prefix]) => file.startsWith(prefix))?.[1]
  if (!target) throw new Error(`unmapped maintained patch source: ${file}`)
  return target
}))]

it('covers every maintained source patch with installed runtime targets', () => {
  expect(readdirSync('patches').filter(name => name.endsWith('.patch')).sort())
    .toEqual(maintainedPatchNames.map(name => `${name}.patch`).sort())
  expect(patchedSources.length).toBeGreaterThan(0)
  expect(patchedJs.sort()).toEqual(Object.values(runtimeTargets).sort())
  for (const file of patchedJs) expect(existsSync(file), `missing patched runtime: ${file}`).toBe(true)
})

it('all patched JavaScript has no unresolved local identifiers', () => {
  // Resolve lexical names without loading the dependency tree. Node globals are
  // supplied by the actual host; this does not replace runtime behavior tests.
  const program = ts.createProgram(patchedJs, { allowJs: true, checkJs: true, noEmit: true,
    noResolve: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, skipLibCheck: true })
  const failures = program.getSemanticDiagnostics().filter(diagnostic => {
    if (![2304, 2552, 18004].includes(diagnostic.code)) return false
    const name = diagnostic.file.text.slice(diagnostic.start, diagnostic.start + diagnostic.length)
    if (name === '__dirname' && diagnostic.file.commonJsModuleIndicator) return false
    return !['global', 'setImmediate', 'clearImmediate'].includes(name)
  }).map(diagnostic => `${diagnostic.file.fileName}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  expect(failures).toEqual([])
}, 30000)

it('every patched client uses current primitives exports, including non-icon components', () => {
  const source = ts.createSourceFile('primitives.js', readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8'), ts.ScriptTarget.Latest, true)
  const exported = new Set(source.statements.filter(ts.isExportDeclaration).flatMap(statement =>
    statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.map(element => element.name.text) : []))
  expect(exported.size).toBeGreaterThan(0)
  for (const file of patchedJs.filter(file => file.endsWith('/client.js'))) {
    const client = readFileSync(file, 'utf8')
    for (const match of client.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.(\w+)/g)) {
      expect(exported.has(match[1]), `${file}: missing primitives export ${match[1]}`).toBe(true)
    }
  }
})

it('maintained clients inject only slots declared by installed clients or maintained source patches', () => {
  const clients = readdirSync('node_modules/@deepseek-ai').flatMap(name => {
    try { return [readFileSync(`node_modules/@deepseek-ai/${name}/lib/client.js`, 'utf8')] } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  })
  // Optional modern slots may be supplied by the maintained source composition.
  // Added declarations validate that composition; they do not prove installation.
  const additions = patches.map(patch => patch.split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1)).join('\n'))
  const declarations = new Set([...clients, ...additions].flatMap(source => [...source.matchAll(/["']([^"']+)["']\s*:\s*\{\s*kind:\s*["'](?:list|single|keyed|chain)["']/g)].map(match => match[1])))
  for (const file of ['packages/dsh-desktop-client-ui/client.js', 'packages/dsh-image-generation/client.js', 'packages/ppt-runtime/adapter/lib/client.js']) {
    for (const match of readFileSync(file, 'utf8').matchAll(/slots\.inject\(["']([^"']+)["']/g)) {
      expect(declarations.has(match[1]), `${file}: undeclared slot ${match[1]}`).toBe(true)
    }
  }
})

it('preserves the native hero options outlet alongside Desktop mode actions', () => {
  const client = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', 'utf8')
  expect(client.match(/renderSlot\("conversation\.hero\.options", \{\}\)/g)).toHaveLength(1)
  expect(client.match(/renderSlot\("conversation\.hero\.modeActions", zone \?\? \{\}\)/g)).toHaveLength(1)
})
