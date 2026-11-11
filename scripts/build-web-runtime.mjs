/** Backwards-compatible command name; all native Web builds use the same locked assembler. */
import { packWebRuntime } from './pack-web-runtime.mjs'

console.log(JSON.stringify(await packWebRuntime(), null, 2))
