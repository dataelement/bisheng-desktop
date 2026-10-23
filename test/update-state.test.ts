import { describe, expect, it } from 'vitest'
import {
  initialUpdateStatus,
  reduceUpdateStatus
} from '../src/main/update/update-state'

describe('desktop update state', () => {
  it('tracks an automatic download from discovery through completion', () => {
    let status = initialUpdateStatus('1.0.0')
    status = reduceUpdateStatus(status, { type: 'check', manual: false })
    status = reduceUpdateStatus(status, { type: 'available', version: '1.1.0' })
    status = reduceUpdateStatus(status, { type: 'progress', percent: 52.37 })

    expect(status).toEqual({
      phase: 'downloading',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      percent: 52.4,
      manual: false
    })

    status = reduceUpdateStatus(status, { type: 'downloaded', version: '1.1.0' })
    expect(status).toEqual({
      phase: 'downloaded',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      manual: false
    })
  })

  it('preserves whether a check was initiated from the application menu', () => {
    let status = initialUpdateStatus('1.0.0')
    status = reduceUpdateStatus(status, { type: 'check', manual: true })
    status = reduceUpdateStatus(status, { type: 'not-available' })

    expect(status.phase).toBe('up-to-date')
    expect(status.manual).toBe(true)
  })

  it('keeps the accepted version when a download fails and drops it from later progress', () => {
    let status = initialUpdateStatus('1.0.0')
    status = reduceUpdateStatus(status, { type: 'available', version: '1.1.0' })
    status = reduceUpdateStatus(status, { type: 'progress', percent: 10 })
    status = reduceUpdateStatus(status, { type: 'error', retryAction: 'download', message: 'socket hang up' })

    expect(status).toEqual({
      phase: 'error',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      manual: false,
      retryAction: 'download'
    })
    expect(status.message).toBeUndefined()

    status = reduceUpdateStatus(status, { type: 'progress', percent: 25 })
    expect(status).toEqual({
      phase: 'downloading',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      percent: 25,
      manual: false
    })
  })

  it('clamps invalid download percentages', () => {
    const status = {
      ...initialUpdateStatus('1.0.0'),
      availableVersion: '1.1.0'
    }

    expect(reduceUpdateStatus(status, { type: 'progress', percent: -5 }).percent).toBe(0)
    expect(reduceUpdateStatus(status, { type: 'progress', percent: 140 }).percent).toBe(100)
    expect(
      reduceUpdateStatus(status, { type: 'progress', percent: Number.NaN }).percent
    ).toBe(0)
  })
})
