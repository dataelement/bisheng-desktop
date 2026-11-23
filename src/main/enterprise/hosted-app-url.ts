/** A hosted app page on the signed-in enterprise: `{origin}/apps/{slug}[/...]`. */
export interface HostedAppTarget { slug: string; url: string }
const HOSTED_APP_PATH = /^\/apps\/([a-z0-9][a-z0-9-]{0,63})(?:\/|$)/u

/**
 * Recognizes a hosted app address. The web workspace opens hosted apps with
 * `window.open('/apps/{slug}')`; any other origin or path is not a hosted app,
 * including look-alike paths such as `/apps-admin` or `/apps/` with no slug.
 */
export function hostedAppTarget(url: string, origin: string): HostedAppTarget | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return undefined
  const slug = HOSTED_APP_PATH.exec(parsed.pathname)?.[1]
  return slug ? { slug, url: parsed.href } : undefined
}
