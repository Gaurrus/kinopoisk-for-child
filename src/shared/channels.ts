export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsStart: 'settings:start',
  settingsSave: 'settings:save',
  settingsVerifyPin: 'settings:verifyPin',
  settingsClose: 'settings:close',
  sessionLogout: 'session:logout',
  openLogs: 'diagnostics:openLogs',
  guardReady: 'guard:ready',
  guardAttempt: 'guard:attempt',
  guardQuit: 'guard:quit',
  guardOpenSettings: 'guard:openSettings',
  guardState: 'guard:state',
} as const;
