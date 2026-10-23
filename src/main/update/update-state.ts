import type { UpdateStatus } from '../../shared/contracts'

export type UpdateStateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error'; message?: string; retryAction?: 'download' }
  | { type: 'unsupported'; message: string }
  | { type: 'reset' }

export function initialUpdateStatus(currentVersion: string): UpdateStatus {
  return { phase: 'idle', currentVersion, manual: false }
}

export function reduceUpdateStatus(
  current: UpdateStatus,
  event: UpdateStateEvent
): UpdateStatus {
  const base = {
    currentVersion: current.currentVersion,
    manual: current.manual
  }

  switch (event.type) {
    case 'check':
      return { ...base, phase: 'checking', manual: event.manual }
    case 'available':
      return { ...base, phase: 'available', availableVersion: event.version }
    case 'progress':
      return {
        phase: 'downloading',
        currentVersion: current.currentVersion,
        manual: current.manual,
        ...(current.availableVersion ? { availableVersion: current.availableVersion } : {}),
        percent: clampPercent(event.percent)
      }
    case 'downloaded':
      return { ...base, phase: 'downloaded', availableVersion: event.version }
    case 'not-available':
      return { ...base, phase: 'up-to-date' }
    case 'error':
      // A failed download stays attached to the version the user accepted.
      // The raw cause is logged by the manager and is not part of the card.
      if (event.retryAction === 'download') {
        return {
          ...base,
          phase: 'error',
          ...(current.availableVersion ? { availableVersion: current.availableVersion } : {}),
          retryAction: 'download'
        }
      }
      return {
        ...base,
        phase: 'error',
        ...(event.message ? { message: event.message } : {})
      }
    case 'unsupported':
      return { ...base, phase: 'unsupported', message: event.message }
    case 'reset':
      return initialUpdateStatus(current.currentVersion)
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}
