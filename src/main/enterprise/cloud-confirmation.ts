import { dialog, type BrowserWindow } from 'electron'
import type { CloudEffect } from './cloud-workbench'

/** This decision is made by the native UI, outside Agent and renderer inputs. */
export async function confirmCloudEffect(effect: CloudEffect, parent: BrowserWindow | undefined, chinese: boolean): Promise<boolean> {
  if (!parent || parent.isDestroyed()) throw new Error('Open Desktop to confirm this cloud operation.')
  const publish = effect.operation === 'publish'
  const result = await dialog.showMessageBox(parent, {
    type: publish ? 'warning' : 'question',
    title: chinese ? '云端工作台确认' : 'Confirm cloud workbench operation',
    message: publish
      ? chinese ? '提交这份工作台代码到企业云端审批？' : 'Submit this workbench snapshot for enterprise approval?'
      : chinese ? '下载此应用版本的源码用于修改？' : 'Download this application version for editing?',
    detail: [effect.serverUrl, effect.appId || (chinese ? '新工作台' : 'New workbench'),
      effect.versionId || '', effect.path || '', effect.digest || '', effect.releaseNotes || ''].filter(Boolean).join('\n'),
    buttons: [chinese ? '取消' : 'Cancel', chinese ? '确认' : 'Confirm'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    ...(effect.schemaChange ? {
      checkboxLabel: chinese ? '我已了解并确认本次数据结构迁移及其数据影响' : 'I understand and approve this schema migration and its data impact',
      checkboxChecked: false
    } : {})
  })
  return !parent.isDestroyed() && result.response === 1 && (!effect.schemaChange || result.checkboxChecked)
}

export function assertCloudRendererRequest(input: unknown): void {
  const operation = input && typeof input === 'object' && 'operation' in input ? input.operation : undefined
  if (!['guide', 'list', 'limits', 'progress'].includes(String(operation))) throw new Error('Use the development tool for cloud source and publishing operations.')
}
