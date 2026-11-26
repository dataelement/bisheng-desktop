export function materializePending(pending: unknown): unknown[]

export function claimedUserMessages(
  priorPending: unknown,
  splice: unknown
): Array<{ id?: string; text: string }>

export function loggedUserIds(entries: unknown): Set<string>

export function visibleClaimedMessages(
  messages: unknown,
  entries: unknown
): Array<{ id?: string; text: string }>
