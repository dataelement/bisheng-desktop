import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('verifies signed test notification behavior', () => {
  execFileSync('python3', ['test/signed-test-notification.test.py'], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
}, 15_000)

it('notifies only after publication and requires a webhook for signed dispatches', () => {
  const yaml = createRequire(import.meta.url)('js-yaml') as {
    load: (source: string) => { jobs: Record<string, { steps: Array<{ name?: string; if?: string; env?: Record<string, string>; run?: string }> }> }
  }
  const workflow = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8'))
  const guard = workflow.jobs['validate-dispatch']?.steps.find(step => step.name === 'Require Feishu webhook for signed test builds')
  const evaluate = new Function('github', 'inputs', 'return (' + guard?.if + ')')
  expect(evaluate({ event_name: 'workflow_dispatch' }, { mode: 'signed' })).toBe(true)
  for (const mode of ['development', 'prerelease']) {
    expect(evaluate({ event_name: 'workflow_dispatch' }, { mode })).toBe(false)
  }
  expect(evaluate({ event_name: 'push' }, { mode: 'signed' })).toBe(false)
  expect(guard?.run).toContain('exit 1')
  const steps = workflow.jobs['publish-signed']?.steps ?? []
  const index = steps.findIndex(step => step.name === 'Verify signed test downloads and send Feishu notification')
  expect(index).toBeGreaterThan(steps.findIndex(step => step.name === 'Verify public ModelScope signed test metadata'))
  expect(steps[index]?.if).toBe('success()')
  expect(steps[index]?.env?.FEISHU_RELEASE_WEBHOOK).toBe('${{ secrets.FEISHU_RELEASE_WEBHOOK }}')
  expect(steps[index]?.run).toContain('signed_test_notification.py')
})
