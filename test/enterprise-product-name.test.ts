import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLoginCallbackServer } from '../packages/dsh-desktop-enterprise/desktop/login-callback-server'
import { enterpriseProductName } from '../packages/dsh-desktop-enterprise/product-name.js'

afterEach(() => vi.unstubAllEnvs())

describe('enterprise product identity', () => {
  it.each([undefined, '', '   '])('keeps the Web fallback for %j', value => {
    expect(enterpriseProductName({ DSH_DESKTOP_PRODUCT_NAME: value })).toBe('BISHENG')
  })

  it.each([undefined, 'Example & <Dev>'])('renders the actual login callback with a safe identity: %j', async productName => {
    const accepted = vi.fn()
    const callback = await startLoginCallbackServer({
      expectedState: 'state', expectedAuthId: () => 'auth', productName, onAccepted: accepted
    })
    try {
      const url = new URL(callback.redirectUri)
      url.search = new URLSearchParams({ state: 'state', auth_id: 'auth', identity_ticket: 'ticket' }).toString()
      const response = await fetch(url, { headers: { connection: 'close' } })
      expect(response.status).toBe(200)
      const html = await response.text()
      const escaped = productName ? 'Example &amp; &lt;Dev&gt;' : 'BISHENG'
      expect(html).toContain(`<title>Return to ${escaped}</title>`)
      expect(html).toContain(`return to ${escaped}.`)
      expect(html).not.toContain('<Dev>')
      expect(accepted).toHaveBeenCalledOnce()
    } finally { await callback.close() }
  })
})
