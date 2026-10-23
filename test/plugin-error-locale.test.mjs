import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, it } from 'vitest'

const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function localizeHostDiagnostic')
const end = source.indexOf('function managementText')
const localizeHostDiagnostic = vm.runInNewContext(`${source.slice(start, end)}\nlocalizeHostDiagnostic`)

const copy = {
  zh: {
    reasonPolicyPlugins: '当前企业未开放网络插件安装',
    reasonPolicyWorkbenches: '当前企业未开放网络工作台安装',
    reasonNeedsSchedule: '{plugins} 未启动，需要先启用官方插件「自动化任务」',
    sentenceSeparator: ''
  },
  en: {
    reasonPolicyPlugins: 'This enterprise has not opened network plugin installation',
    reasonPolicyWorkbenches: 'This enterprise has not opened network workbench installation',
    reasonNeedsSchedule: '{plugins} did not start. Enable the official Automation plugin first',
    sentenceSeparator: ' '
  }
}

function translate(locale) {
  return (key, values = {}) => (copy[locale][key] ?? key).replaceAll('{plugins}', values.plugins ?? '')
}

it('follows the interface language for a closed plugin market and a missing schedule service', () => {
  const policy = 'POLICY_DISABLED: current enterprise has not opened network plugin installation.'
  const schedule = 'dsh: warning: 1 entry did not activate\ndeepseek-harness-daily (deepseek-harness-daily): pending (waiting for service: schedule)\n'
  expect(localizeHostDiagnostic(policy, translate('zh'))).toBe('当前企业未开放网络插件安装')
  expect(localizeHostDiagnostic(policy, translate('en'))).toBe('This enterprise has not opened network plugin installation')
  expect(localizeHostDiagnostic(schedule, translate('zh'))).toBe('deepseek-harness-daily 未启动，需要先启用官方插件「自动化任务」')
  expect(localizeHostDiagnostic(schedule, translate('en'))).toBe('deepseek-harness-daily did not start. Enable the official Automation plugin first')
  expect(localizeHostDiagnostic('disk full', translate('zh'))).toBeUndefined()
  expect(source).toContain('localizeHostDiagnostic(problem.reason, t)')
})
