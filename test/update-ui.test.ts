import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../src/shared/contracts'
import {
  isUpdateDismissed,
  shouldShowUpdate,
  updateCardActions,
  updateHeadline,
  updateMessage
} from '../src/preload/update-view'

const downloading: UpdateStatus = {
  phase: 'downloading',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  percent: 42.2,
  manual: false
}

const downloaded: UpdateStatus = {
  phase: 'downloaded',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  manual: false
}

describe('desktop update card visibility', () => {
  it('shows automatic downloads but keeps automatic background checks quiet', () => {
    expect(shouldShowUpdate(downloading)).toBe(true)
    expect(
      shouldShowUpdate({ phase: 'checking', currentVersion: '1.0.0', manual: false })
    ).toBe(false)
    expect(
      shouldShowUpdate({ phase: 'checking', currentVersion: '1.0.0', manual: true })
    ).toBe(true)
  })

  it('keeps a dismissed version hidden while its download phase changes', () => {
    expect(isUpdateDismissed(downloading, '1.1.0')).toBe(true)
    expect(isUpdateDismissed({ ...downloading, availableVersion: '1.2.0' }, '1.1.0')).toBe(
      false
    )
  })

  it('dismisses a downloaded update when the user closes the card', () => {
    expect(isUpdateDismissed(downloaded, null)).toBe(false)
    expect(isUpdateDismissed(downloaded, '1.0.0')).toBe(false)
    expect(isUpdateDismissed(downloaded, '1.1.0')).toBe(true)
  })

  it('formats localized progress copy', () => {
    expect(updateMessage(downloading, 'zh')).toBe('正在下载更新 42%')
    expect(updateMessage(downloading, 'en')).toBe('Downloading update 42%')
  })
})

describe('accepting an update is what starts the download', () => {
  it('asks rather than announcing a download already under way', () => {
    const available: UpdateStatus = {
      phase: 'available',
      currentVersion: '0.4.3',
      availableVersion: '0.4.4',
      manual: false
    }
    expect(updateMessage(available, 'zh')).toBe('发现新版本 0.4.4，是否更新？')
    expect(updateMessage(available, 'en')).toBe('BISHENG 0.4.4 is available. Update now?')
  })

  it('shows a failed download without the underlying error', () => {
    const failed: UpdateStatus = {
      phase: 'error',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      manual: false,
      retryAction: 'download',
      message: 'socket hang up'
    }
    expect(shouldShowUpdate(failed)).toBe(true)
    expect(updateHeadline(failed, 'zh')).toEqual({
      title: '更新失败',
      description: '下载失败，请重试'
    })
    expect(updateHeadline(failed, 'en')).toEqual({
      title: 'Update failed',
      description: 'Download failed. Please retry.'
    })
    expect(
      shouldShowUpdate({ phase: 'error', currentVersion: '1.0.0', manual: false, message: 'nope' })
    ).toBe(false)
  })

  it('explains when the current build does not support updates', () => {
    const unsupported: UpdateStatus = {
      phase: 'unsupported',
      currentVersion: '1.0.0',
      manual: true,
      message: 'Online updates are unavailable in this build.'
    }
    expect(updateHeadline(unsupported, 'zh')).toEqual({
      title: '当前构建不支持在线更新',
      description: '当前构建不支持在线更新。'
    })
    expect(updateHeadline(unsupported, 'en')).toEqual({
      title: 'Online updates are not available',
      description: 'Online updates are unavailable in this build.'
    })
    expect(updateMessage(unsupported, 'zh')).toBe('当前构建不支持在线更新。')
    expect(updateMessage(unsupported, 'en')).toBe('Online updates are unavailable in this build.')
  })
})

describe('update card actions', () => {
  const base = { currentVersion: '1.0.0', availableVersion: '1.1.0', manual: false }

  it('leaves skip available until the user accepts', () => {
    expect(updateCardActions({ ...base, phase: 'available' }, { accepting: false, retrying: false })).toEqual({
      showSkip: true,
      disableSkip: false,
      disableClose: false,
      showRetryDownload: false,
      disableRetryDownload: false
    })
  })

  it('locks skip and close once the user accepts', () => {
    expect(updateCardActions({ ...base, phase: 'available' }, { accepting: true, retrying: false })).toEqual({
      showSkip: true,
      disableSkip: true,
      disableClose: true,
      showRetryDownload: false,
      disableRetryDownload: false
    })
  })

  it('hides skip and locks close while the download is running', () => {
    expect(updateCardActions({ ...base, phase: 'downloading', percent: 10 }, { accepting: false, retrying: false })).toEqual({
      showSkip: false,
      disableSkip: true,
      disableClose: true,
      showRetryDownload: false,
      disableRetryDownload: false
    })
  })

  it('offers install, skip, and close once the download is ready', () => {
    expect(updateCardActions({ ...base, phase: 'downloaded' }, { accepting: false, retrying: false })).toEqual({
      showSkip: true,
      disableSkip: false,
      disableClose: false,
      showRetryDownload: false,
      disableRetryDownload: false
    })
  })

  it('offers retry after a download failure and locks it while retrying', () => {
    const failed: UpdateStatus = { ...base, phase: 'error', retryAction: 'download' }
    expect(updateCardActions(failed, { accepting: false, retrying: false })).toEqual({
      showSkip: false,
      disableSkip: true,
      disableClose: false,
      showRetryDownload: true,
      disableRetryDownload: false
    })
    expect(updateCardActions(failed, { accepting: false, retrying: true }).disableClose).toBe(true)
    expect(updateCardActions(failed, { accepting: false, retrying: true }).disableRetryDownload).toBe(true)
  })

  it('keeps a generic error closable and without a retry action', () => {
    expect(updateCardActions(
      { phase: 'error', currentVersion: '1.0.0', manual: true, message: 'metadata request failed' },
      { accepting: false, retrying: false }
    )).toEqual({
      showSkip: false,
      disableSkip: true,
      disableClose: false,
      showRetryDownload: false,
      disableRetryDownload: false
    })
  })
})
