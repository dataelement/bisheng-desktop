import { expect, it } from 'vitest'
import { claimedUserMessages, visibleClaimedMessages } from '../packages/dsh-desktop-enterprise/claimed-echo.js'

const user = {
  id: 'm-user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: '手机发来的任务' }]
}
const runtime = {
  id: 'm-runtime',
  source: { kind: 'runtime-context' },
  content: [{ type: 'text', text: '不要显示' }]
}

it('keeps only user messages removed by one claim', () => {
  const pending = {
    kind: 'splice',
    previous: { kind: 'snapshot', ids: [] },
    start: 0,
    removedCount: 0,
    inserted: [user, runtime]
  }
  expect(claimedUserMessages(pending, { start: 0, removedCount: 2, inserted: [] })).toEqual([
    { id: 'm-user', text: '手机发来的任务' }
  ])
  expect(claimedUserMessages(pending, { start: 0, removedCount: 2, outcome: 'canceled' })).toEqual([])
  expect(claimedUserMessages(pending, { start: 0, removedCount: 0, inserted: [user] })).toEqual([])
  expect(claimedUserMessages(undefined, { start: 0, removedCount: 1 })).toEqual([])
})

it('keeps the rpc id of a claimed user message', () => {
  const pending = {
    kind: 'snapshot',
    ids: [{
      id: 'm-desktop',
      source: { kind: 'user', rpcId: 'req-desktop' },
      content: [{ type: 'text', text: '电脑上发送' }]
    }]
  }
  expect(claimedUserMessages(pending, { start: 0, removedCount: 1, inserted: [] })).toEqual([
    { id: 'm-desktop', rpcId: 'req-desktop', text: '电脑上发送' }
  ])
})

it('hides a claimed message once the same user id is in the loaded window', () => {
  const messages = [{ id: 'm-user', text: '手机发来的任务' }, { id: 'm-other', text: '另一句' }]
  const hidden = visibleClaimedMessages(messages, [
    { type: 'user/message', data: { id: 'm-user', source: { kind: 'user' }, content: [] } },
    { type: 'user/message', data: { id: 'm-runtime', source: { kind: 'runtime-context' } } }
  ])
  expect(hidden).toEqual([{ id: 'm-other', text: '另一句' }])
  expect(visibleClaimedMessages([{ text: '没有编号' }], [
    { event: { type: 'user/message', data: { id: 'm-user', message: { source: { kind: 'user' } } } } }
  ])).toEqual([])
})

it('hides a desktop submission by rpc id and still shows a different message with the same text', () => {
  const messages = [
    { id: 'echo-1', rpcId: 'req-desktop', text: '继续' },
    { id: 'echo-2', rpcId: 'req-phone', text: '继续' }
  ]
  expect(visibleClaimedMessages(messages, [], { localRequestIds: ['req-desktop'] })).toEqual([
    { id: 'echo-2', rpcId: 'req-phone', text: '继续' }
  ])
  expect(visibleClaimedMessages(messages, [
    { type: 'user/message', data: { id: 'logged-other', source: { kind: 'user', rpcId: 'req-phone' }, content: [] } }
  ])).toEqual([
    { id: 'echo-1', rpcId: 'req-desktop', text: '继续' }
  ])
  expect(visibleClaimedMessages(messages, [], {
    matches: [{ id: 'drawn-other', rpcId: 'req-desktop' }]
  })).toEqual([
    { id: 'echo-2', rpcId: 'req-phone', text: '继续' }
  ])
})
