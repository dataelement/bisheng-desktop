/**
 * Enterprise Work obtains search exclusively from the authenticated MCP catalog.
 * Presets own their own tool-web instances, so a root YAML override is insufficient.
 * Use Loader's public config hook for both existing and subsequently mounted presets.
 * Keep the raw config for unloading; no Profile files or upstream packages are edited.
 */
export function applyEnterpriseSearchPolicy(ctx) {
  const originals = new Map()
  const projectRows = rows => rows.map(row => {
    if (row.name === '@deepseek-ai/dsh-tool-web') return { ...row, config: { ...row.config, search: false } }
    if (row.group && Array.isArray(row.config)) return { ...row, config: projectRows(row.config) }
    return row
  })
  const project = entry => {
    if (entry.loader.root !== ctx.loader.root) return
    const name = entry.options.name
    if (name !== '@deepseek-ai/dsh-tool-web' && name !== '@deepseek-ai/dsh-agent-preset') return
    const current = entry.options.config
    if (originals.get(entry)?.projected === current) return
    if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
      throw new Error('Enterprise search requires an object tool-web configuration.')
    }
    const projected = name === '@deepseek-ai/dsh-agent-preset'
      ? { ...current, ...(Array.isArray(current?.plugins) ? { plugins: projectRows(current.plugins) } : {}) }
      : { ...current, search: false }
    originals.set(entry, { original: current, projected })
    entry.options.config = projected
  }
  ctx.effect(() => () => {
    for (const [entry, { original, projected }] of originals) {
      // A later edit belongs to the user or another extension, not this policy.
      if (entry.options.config !== projected) continue
      entry.options.config = original
      if (entry.fiber) entry.fiber.update(original, true)
    }
    originals.clear()
  })
  ctx.on('loader/patch-context', (entry, next) => { project(entry); next() })
  ctx.on('loader/partial-dispose', (entry, _legacy, active) => {
    if (!active) originals.delete(entry)
  })
  for (const entry of ctx.loader.entries()) {
    project(entry)
    const saved = originals.get(entry)
    if (saved && entry.fiber) entry.fiber.update(saved.projected, true)
  }
}
