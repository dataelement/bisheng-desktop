/** Host identity supplied by Desktop; standalone Web keeps the enterprise default. */
export function enterpriseProductName(env = process.env) {
  const value = env.DSH_DESKTOP_PRODUCT_NAME
  return typeof value === 'string' && value.trim() ? value : 'BISHENG'
}

// A Web host cannot provide desktop authorization, even when its display name is configured.
export const DESKTOP_AUTHORIZATION_UNAVAILABLE = 'Enterprise plugins require the desktop authorization service. Open the market in the desktop app or contact your administrator.'
