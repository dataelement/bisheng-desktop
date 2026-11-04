// Existing Desktop profile baseline, including product-specific bundles.
const PROTECTED_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-desktop-log-bridge',
  'dsh-desktop-client-ui',
  'dsh-desktop-enterprise',
  'dsh-desktop-market-installer',
  'dsh-image-generation',
  'dsh-ppt',
  'dsh-ppt-composer',
  'dsh-desktop-hmr-fallback',
  'dsh-desktop-preset-transfer',
  'dsh-desktop-workbenches',
  'dsh-desktop-onboarding',
  'dsh-desktop-office'
])

export function isProtectedProfileBundle(name) {
  return PROTECTED_BUNDLES.has(name)
}

