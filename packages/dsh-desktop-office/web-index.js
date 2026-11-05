import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeOffice } from './index.js'
import { createWebOfficeModes } from './lib/web-modes.js'
import { webRuntime } from './lib/web-runtime.js'
import * as upstream from './vendor/official.js'

export const name = 'desktop-office-web'
export const inject = ['skills']

/** Installation-relative immutable assets; mutable state is supplied by the bundle patch. */
export async function apply(ctx, config) {
  if (!config || typeof config.root !== 'string' || !isAbsolute(config.root)) throw new Error('Office Web requires an absolute state root')
  const modes = createWebOfficeModes(config.root, () => ctx.get('officeModes'))
  return composeOffice(ctx, {
    resources: fileURLToPath(new URL('./resources/', import.meta.url)),
    cli: fileURLToPath(new URL('./web-cli.mjs', import.meta.url))
  }, modes, webRuntime(ctx, upstream))
}
