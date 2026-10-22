import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { randomUUID } from 'node:crypto'
import { bindEnterpriseAuth } from './enterprise-auth.js'
import { packageEntry } from './community-package.js'

/** A transient Loader subtree keeps client modules and host lifecycle in the same registry. */
class MarketTree extends EntryTree {
  constructor(ctx) {
    super(ctx)
    this.children = new Set()
  }
  *entries() {
    yield* super.entries()
    for (const tree of this.children) yield* tree.entries()
  }
  write() {}
}

function contained(root, path) {
  const nested = relative(root, path)
  if (isAbsolute(nested) || nested.startsWith('..')) throw new Error('Plugin entry leaves its package.')
}

export function createMarketRuntime(ctx, auth) {
  let registry
  return async record => {
    registry ??= new MarketTree(ctx)
    const tree = new MarketTree(ctx)
    // EntryTree attaches one subtree to its owner. Keep all instances discoverable.
    if (ctx.fiber.entry) ctx.fiber.entry.subtree = registry
    const root = join(record.directory, 'node_modules', record.name)
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const entry = resolve(root, packageEntry(pkg))
    contained(root, entry)
    const id = randomUUID()
    let name = pathToFileURL(entry).href
    let config = record.config ?? {}
    if (pkg.dsh?.bundle) {
      const patches = bundlePatchPaths(root, pkg.dsh.bundle).flatMap(path => {
        contained(root, path)
        return loadOverlayPatches('enterprise-market', path)
      })
      const packageRequire = createRequire(join(root, 'package.json'))
      const entries = composeEntries([patches])
      const anchor = rows => rows.forEach(row => {
        row.id = `${id}-${row.id || randomUUID()}`
        if (row.name && !row.name.startsWith('cordis:') && !row.name.startsWith('file:')) row.name = pathToFileURL(packageRequire.resolve(row.name)).href
        if (row.group && Array.isArray(row.config)) anchor(row.config)
      })
      anchor(entries)
      name = pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/cordis-plugin-group')).href
      config = entries
    }
    let timer, transport, unbind, removed
    const remove = () => removed ??= (async () => {
      unbind?.()
      const errors = []
      try { if (transport) await auth.revoke(transport) } catch (error) { errors.push(error) }
      try {
        // EntryGroup.remove() starts disposal but does not await async effects.
        await tree.store[id]?.fiber?.dispose()
      } catch (error) { errors.push(error) } finally {
        tree.root.remove(id)
        registry.children.delete(tree)
      }
      if (errors.length) throw new AggregateError(errors, 'Enterprise plugin cleanup failed.')
    })()
    try {
      if (auth) {
        if (typeof record.plugin_id !== 'string' || record.plugin_id.length === 0) {
          throw new Error('Enterprise plugin identity is required.')
        }
        transport = await auth.grant({ pluginId: record.plugin_id, instanceId: id })
        unbind = await bindEnterpriseAuth(tree.ctx, transport)
      }
      const options = { id, name, config }
      registry.children.add(tree)
      await tree.root.create(options)
      tree.root.data.push(options)
      const fiber = tree.store[id].fiber
      if (!fiber) throw new Error('Plugin did not create a runtime instance.')
      await Promise.race([fiber.await(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Plugin dependencies or configuration are not ready.')), 15000)
      })])
      if (fiber.state !== 2) throw new Error('Plugin dependencies or configuration are not ready.')
      await tree.await({ timeout: 15000 })
      await new Promise(resolve => setImmediate(resolve))
      const failed = Object.values(tree.store).find(entry => String(entry.options?.id ?? '').startsWith(`${id}-`) && entry.fiber?.state !== 2)
      if (fiber.state !== 2 || failed) throw new Error(failed?.lastImportError?.message || 'Plugin bundle entry did not activate.')
      return {
        dispose: remove,
        get state() { return tree.store[id]?.fiber?.state }
      }
    } catch (error) {
      const errors = [error]
      try { await remove() } catch (cleanupError) { errors.push(cleanupError) }
      if (errors.length > 1) throw new AggregateError(errors, error.message, { cause: error })
      throw error
    } finally { clearTimeout(timer) }
  }
}
