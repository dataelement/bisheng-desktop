export interface EnterpriseChatPresentation {
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  theme: 'light' | 'dark'
  locale?: 'zh' | 'en'
}

export interface EnterpriseChatViewState {
  navigation?: EnterpriseNavigation
  path?: string
  epoch?: number
  landing?: boolean
  conversationId?: string
  connected?: boolean
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
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
  const bounds = input.bounds as Record<string, unknown> | undefined
  if (!bounds || ['x', 'y', 'width', 'height'].some((key) =>
    typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]) || Number(bounds[key]) < 0 || Number(bounds[key]) > 20000
  )) throw new Error('Invalid Chat bounds.')
  return {
    visible: input.visible,
    theme: input.theme as 'light' | 'dark',
    locale: input.locale,
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
}
const modulePaths: Record<string, RegExp> = {
  knowledge: /^\/knowledge$/u,
  channel: /^\/channel$/u,
  apps: /^\/apps(?:\/[a-zA-Z0-9_-]+)*$/u,
  skills: /^\/skills$/u,
  square: /^\/square$/u
}
const moduleGrants: Record<string, string> = { knowledge: 'knowledge_space', channel: 'subscription', apps: 'apps', skills: 'home' }
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
  return { entries, homeLabel: typeof input.homeLabel === 'string' ? input.homeLabel.slice(0, 80) : '' }
}
