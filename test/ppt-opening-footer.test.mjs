import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const source = await readFile(process.env.DSH_TEST_CHAT_SOURCE || 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', 'utf8')
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const react = {
  memo: value => value,
  createElement: (type, props) => ({ type, props })
}
const jsx = { jsx: (type, props) => ({ type, props }) }
const ChatNodeSeat = () => {}
const PendingSubmissionBubble = () => {}
const ChatFlow = new Function('react', 'react_jsx_runtime', 'ChatNodeSeat', 'PendingSubmissionBubble', `
  const chatRenderKey = entry => entry.key
  ${slice('function openingUserMessageTarget', 'function observedInputs')}
  ${slice('const ChatFlow =', '//#endregion')}
  return ChatFlow
`)(react, jsx, ChatNodeSeat, PendingSubmissionBubble)

function render({ hasMore = false, pending = false } = {}) {
  const node = { kind: 'user' }
  const chat = {
    order: pending ? [] : ['first'],
    nodes: new Map(pending ? [] : [['first', node]]),
    navigation: { items: () => [] }
  }
  const session = { hasMore, running: false }
  const footer = { template: 'Selected PPT' }
  const renderSlot = vi.fn(() => footer)
  const rows = ChatFlow({
    entries: pending ? [] : [{ kind: 'node', key: 'first' }],
    pendingInputs: pending ? [{ requestId: 'echo', placement: 'transcript' }] : [],
    useSession: selector => selector(session),
    useChat: selector => selector(chat),
    useChatNode: (_key, selector) => selector(undefined),
    renderSlot
  })
  return { rows, footer, renderSlot }
}

describe('PPT opening message footer', () => {
  it('passes the template footer to the first user message using session pagination', () => {
    const { rows, footer, renderSlot } = render()
    expect(renderSlot).toHaveBeenCalledWith('conversation.chat.userMessageFooter', { leading: true })
    expect(rows[0].props).toMatchObject({ nodeKey: 'first', leadingUserKey: 'first', messageFooter: footer })
  })

  it('shows the footer on the opening submission echo', () => {
    const { rows, footer } = render({ pending: true })
    expect(rows[0]).toMatchObject({ type: PendingSubmissionBubble, props: { footer } })
  })

  it('does not attach the footer while older history remains unloaded', () => {
    const { rows, renderSlot } = render({ hasMore: true })
    expect(renderSlot).not.toHaveBeenCalled()
    expect(rows[0].props.messageFooter).toBeNull()
  })
})
