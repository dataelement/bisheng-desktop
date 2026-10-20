export interface EnterpriseChatPresentation {
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  theme: 'light' | 'dark'
  locale?: 'zh' | 'en'
  settings?: EnterpriseSettingsSection
  /** Host surfaces and ink resolved from the active Harness theme; absent when they cannot be sampled. */
  palette?: EnterprisePalette
}

/** Roles the host samples from its own tokens; the embedded document never reads host CSS. */
export const ENTERPRISE_PALETTE_ROLES = ['surface', 'raised', 'strong', 'labelPrimary', 'labelSecondary', 'labelTertiary', 'borderBase', 'borderDeep'] as const
export type EnterprisePaletteRole = (typeof ENTERPRISE_PALETTE_ROLES)[number]
/** Opaque sRGB channels; translucent host tokens are flattened over the surface before they are sent. */
export type EnterprisePalette = Record<EnterprisePaletteRole, readonly [number, number, number]>

function parseEnterprisePalette(value: unknown): EnterprisePalette | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Invalid Chat palette.')
  const input = value as Record<string, unknown>
  const entries = ENTERPRISE_PALETTE_ROLES.map((role): [EnterprisePaletteRole, readonly [number, number, number]] => {
    const channels = input[role]
    if (!Array.isArray(channels) || channels.length !== 3 || channels.some((channel) =>
      typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255
    )) throw new Error('Invalid Chat palette.')
    return [role, [channels[0] as number, channels[1] as number, channels[2] as number]]
  })
  return Object.fromEntries(entries) as EnterprisePalette
}

export const ENTERPRISE_SETTINGS_SECTIONS = ['desktop-usage', 'ai-access', 'my-tasks', 'my-requests', 'notifications'] as const
export type EnterpriseSettingsSection = (typeof ENTERPRISE_SETTINGS_SECTIONS)[number]

export function parseEnterpriseSettingsSection(value: unknown): EnterpriseSettingsSection {
  const section = ENTERPRISE_SETTINGS_SECTIONS.find(item => item === value)
  if (!section) throw new Error('Invalid enterprise settings section.')
  return section
}

export interface EnterpriseChatViewState {
  settingsProtocolVersion?: 1
  navigation?: EnterpriseNavigation
  path?: string
  epoch?: number
  landing?: boolean
  conversationId?: string
  connected?: boolean
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  settingsSection?: EnterpriseSettingsSection
  settingsReady?: boolean
  settingsFailure?: 'load' | 'unsupported'
}

export function parseChatPresentation(value: unknown): EnterpriseChatPresentation {
  if (!value || typeof value !== 'object') throw new Error('Chat presentation is required.')
  const input = value as Record<string, unknown>
  if (typeof input.visible !== 'boolean' || !['light', 'dark'].includes(String(input.theme))) {
    throw new Error('Invalid Chat presentation.')
  }
  if (input.locale !== undefined && input.locale !== 'zh' && input.locale !== 'en') {
    throw new Error('Invalid Chat locale.')
  }
  const settings = input.settings === undefined ? undefined : parseEnterpriseSettingsSection(input.settings)
  const palette = parseEnterprisePalette(input.palette)
  const bounds = input.bounds as Record<string, unknown> | undefined
  if (!bounds || ['x', 'y', 'width', 'height'].some((key) =>
    typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]) || Number(bounds[key]) < 0 || Number(bounds[key]) > 20000
  )) throw new Error('Invalid Chat bounds.')
  return {
    visible: input.visible,
    theme: input.theme as 'light' | 'dark',
    locale: input.locale,
    settings,
    ...(palette ? { palette } : {}),
    bounds: { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) }
  }
}

export interface EnterpriseChatConversation {
  id: string
  title: string
  updatedAt: string
}
export interface EnterpriseChatHistory {
  epoch: number
  items: EnterpriseChatConversation[]
  hasMore: boolean
}
export function parseChatPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) throw new Error('Invalid Chat page.')
  return value
}
export function parseChatId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) throw new Error('Invalid Chat identity.')
  return value
}

export interface EnterpriseNavigationEntry {
  id: string
  label: string
  path: string
  active: boolean
  primary: boolean
}
export interface EnterpriseNavigation {
  entries: EnterpriseNavigationEntry[]
  homeLabel: string
  settings?: { aiAccess: boolean }
  /** Outstanding approvals reported by the enterprise document; absent when it does not report them. */
  approvals?: { pending: number }
}
const MAX_PENDING_APPROVALS = 9999
const modulePaths: Record<string, RegExp> = {
  knowledge: /^\/knowledge$/u,
  channel: /^\/channel$/u,
  apps: /^\/apps(?:\/[a-zA-Z0-9_-]+)*$/u,
  skills: /^\/skills$/u,
  square: /^\/square$/u
}
const moduleGrants: Record<string, string> = { knowledge: 'knowledge_space', channel: 'subscription', apps: 'apps', skills: 'home' }
/** A reported approval backlog is advisory presentation data, never an authorization signal. */
function parseEnterpriseApprovals(value: unknown): { pending: number } | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Invalid enterprise approvals summary.')
  const pending = (value as Record<string, unknown>).pending
  if (typeof pending !== 'number' || !Number.isInteger(pending) || pending < 0 || pending > MAX_PENDING_APPROVALS) {
    throw new Error('Invalid enterprise approvals summary.')
  }
  return { pending }
}

/** Validate presentation metadata from the isolated enterprise document. */
export function parseEnterpriseNavigation(value: unknown): EnterpriseNavigation {
  if (!value || typeof value !== 'object') throw new Error('Invalid enterprise navigation.')
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.entries) || input.entries.length > 5) throw new Error('Invalid enterprise entries.')
  const seen = new Set<string>()
  const entries = input.entries.map((entry: unknown): EnterpriseNavigationEntry => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid enterprise entry.')
    const row = entry as Record<string, unknown>
    if (typeof row.id !== 'string' || !Object.hasOwn(modulePaths, row.id) || seen.has(row.id) ||
        typeof row.path !== 'string' || row.path.length > 256 ||
        !(modulePaths[row.id]?.test(row.path) || (moduleGrants[row.id] && row.path === `/menu-unavailable?plugin=${moduleGrants[row.id]}`)) ||
        typeof row.label !== 'string' || !row.label.trim() || row.label.length > 80 ||
        typeof row.active !== 'boolean' || typeof row.primary !== 'boolean') throw new Error('Invalid enterprise entry.')
    seen.add(row.id)
    return { id: row.id, path: row.path, label: row.label, active: row.active, primary: row.primary }
  })
  const settings = input.settings
  if (settings !== undefined && (!settings || typeof settings !== 'object' || !('aiAccess' in settings) || typeof settings.aiAccess !== 'boolean')) {
    throw new Error('Invalid enterprise settings capabilities.')
  }
  const approvals = parseEnterpriseApprovals(input.approvals)
  return { ...(approvals ? { approvals } : {}), entries, homeLabel: typeof input.homeLabel === 'string' ? input.homeLabel.slice(0, 80) : '', ...(settings && typeof settings === 'object' && 'aiAccess' in settings ? { settings: { aiAccess: settings.aiAccess === true } } : {}) }
}
