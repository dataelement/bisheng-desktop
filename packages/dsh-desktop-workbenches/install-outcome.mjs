/**
 * A replacement publishes new files, but Harness may retain the old server module
 * even when its general reload reports applied. Require a process restart so the
 * workbench never advertises unverified hot-upgrade success. Fresh installs can
 * still become available immediately through the normal activation path.
 * @param {import('@deepseek-ai/dsh-plugin-manager').ChangeResult | undefined} result
 * @param {boolean} replacement
 */
export function workbenchInstallOutcome(result, replacement) {
  if (replacement === true && result?.application === 'applied') {
    return { ...result, application: 'restart-required', restartReason: 'package-moved' }
  }
  return result
}
