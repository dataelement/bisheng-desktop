import type { OfficeModes } from '../index.js'
/** Private fallback bridge; never publishes the global officeModes service. */
export function createWebOfficeModes(root: string, getPptModes: () => OfficeModes | undefined): OfficeModes
