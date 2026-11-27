export function materializePending(pending: unknown): unknown[]

export function claimedUserMessages(
  priorPending: unknown,
  splice: unknown
): Array<{ id?: string; rpcId?: string; text: string }>

export function loggedUserIds(entries: unknown): Set<string>

export function visibleClaimedMessages(
  messages: unknown,
  entries: unknown,
  options?: {
    localRequestIds?: Iterable<unknown>
    matches?: Array<{ id?: unknown; rpcId?: unknown }>
  }
): Array<{ id?: string; rpcId?: string; text: string }>
