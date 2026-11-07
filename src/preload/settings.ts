import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';
import type { ActionResult, SavePayload, SettingsState } from '../shared/types';

contextBridge.exposeInMainWorld('kp', {
  getState: (): Promise<SettingsState> => ipcRenderer.invoke(CHANNELS.settingsGet),
  start: (): Promise<ActionResult> => ipcRenderer.invoke(CHANNELS.settingsStart),
  save: (payload: SavePayload): Promise<ActionResult> =>
    ipcRenderer.invoke(CHANNELS.settingsSave, payload),
  verifyPin: (pin: string): Promise<ActionResult> =>
    ipcRenderer.invoke(CHANNELS.settingsVerifyPin, pin),
  logout: (): Promise<ActionResult> => ipcRenderer.invoke(CHANNELS.sessionLogout),
  close: (): Promise<void> => ipcRenderer.invoke(CHANNELS.settingsClose),
  openLogs: (): Promise<ActionResult> => ipcRenderer.invoke(CHANNELS.openLogs),
  onState: (callback: (state: unknown) => void): void => {
    ipcRenderer.on(CHANNELS.guardState, (_event, snapshot: unknown) => callback(snapshot));
  },
});
