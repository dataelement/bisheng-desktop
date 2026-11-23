export type CloudFetch = (path: string, init?: RequestInit) => Promise<{ response: Response, base: string, connectionKey: string }>
/** Where a listed hosted app is served. Resolved from the server catalog, never from renderer input. */
export interface CloudEntry { appId: string; slug: string; entryUrl: string; connectionKey: string }
const ID = /^[a-f0-9]{32}$/u
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/u
// The catalog pages by application id; this bounds a lookup for an app the user can no longer use.
const MAX_ENTRY_PAGES = 50
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud workbench request.')
  return input as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid application or version identity.')
  return value
}
async function json(response: Response): Promise<Record<string, unknown>> {
  const data = record(await response.json())
  if (!response.ok || data.status_code !== 200) throw new Error(typeof data.status_message === 'string' ? data.status_message : 'Cloud workbench request failed.')
  return record(data.data)
}

/**
 * Cloud workbenches are the enterprise's hosted apps that this user may use:
 * the same online, same-tenant set the web app square lists. Desktop only reads
 * that catalog. Publishing follows the platform's own path (platform key + CLI,
 * then approval), and pages open with the user's web login, so Desktop no longer
 * packages, publishes or downloads source, nor exchanges launch tickets.
 */
export class CloudWorkbenchService {
  constructor(private readonly fetch: CloudFetch) {}

  /** The host page may only read the catalog. */
  async request(input: unknown): Promise<unknown> {
    const request = record(input)
    if (request.operation !== 'list') throw new Error('Unsupported cloud workbench operation.')
    const page = await this.page(request.cursor)
    return { ...page.data, connectionKey: page.connectionKey }
  }

  /** Revalidates access through the catalog before a page is opened. */
  async entry(appId: unknown): Promise<CloudEntry> {
    const wanted = id(appId)
    let cursor: string | undefined
    for (let index = 0; index < MAX_ENTRY_PAGES; index++) {
      const page = await this.page(cursor)
      const items = Array.isArray(page.data.items) ? page.data.items : []
      const item = items.find((value): value is Record<string, unknown> => !!value && typeof value === 'object' && (value as Record<string, unknown>).id === wanted)
      if (item) {
        const slug = item.slug
        if (typeof slug !== 'string' || !SLUG.test(slug) || item.entry_path !== `/apps/${slug}/`) throw new Error('Invalid hosted application entry.')
        return { appId: wanted, slug, entryUrl: `${page.base.replace(/\/$/u, '')}/apps/${slug}/`, connectionKey: page.connectionKey }
      }
      const next = page.data.next_cursor
      if (next === undefined || next === null) break
      cursor = id(next)
    }
    throw new Error('This cloud workbench is no longer available to you.')
  }

  private async page(cursor: unknown) {
    const query = new URLSearchParams()
    if (cursor !== undefined && cursor !== null) query.set('cursor', id(cursor))
    const result = await this.fetch(`/api/v1/dsh/apps?${query}`)
    // A missing collection route means the server has no hosted-workbench API;
    // it is not an empty catalog or an invalid user credential.
    if (result.response.status === 404) {
      await result.response.body?.cancel().catch(() => undefined)
      throw new Error('CLOUD_WORKBENCH_API_UNAVAILABLE')
    }
    return { data: await json(result.response), base: result.base, connectionKey: result.connectionKey }
  }
}
