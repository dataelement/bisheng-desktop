export interface EnterpriseChatPresentation {
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  theme: 'light' | 'dark'
}

export interface EnterpriseChatViewState {
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
  const bounds = input.bounds as Record<string, unknown> | undefined
  if (!bounds || ['x', 'y', 'width', 'height'].some((key) =>
    typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]) || Number(bounds[key]) < 0 || Number(bounds[key]) > 20000
  )) throw new Error('Invalid Chat bounds.')
  return {
    visible: input.visible,
    theme: input.theme as 'light' | 'dark',
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
