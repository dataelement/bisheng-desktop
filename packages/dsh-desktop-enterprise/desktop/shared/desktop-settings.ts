export const DESKTOP_SETTINGS_ACTIONS = ['check-for-updates', 'show-harness-log', 'safe-mode'] as const
export type DesktopSettingsAction = typeof DESKTOP_SETTINGS_ACTIONS[number]

export function parseDesktopSettingsAction(value: unknown): DesktopSettingsAction {
  const action = DESKTOP_SETTINGS_ACTIONS.find(item => item === value)
  if (!action) throw new TypeError('Invalid Desktop settings action.')
  return action
}
