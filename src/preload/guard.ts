import { ipcRenderer } from 'electron';
import { startGuard } from '../browser/guard-runtime';
import { CHANNELS } from '../shared/channels';
import type { AttemptResult, LimiterSnapshot } from '../shared/types';

startGuard({
  attempt: async (key) => {
    const result = (await ipcRenderer.invoke(CHANNELS.guardAttempt, key)) as AttemptResult;
    return { allowed: result.allowed, snapshot: result.state };
  },
  onSnapshot: (callback) => {
    ipcRenderer.on(CHANNELS.guardState, (_event, snapshot: LimiterSnapshot) => {
      callback(snapshot);
    });
    ipcRenderer.send(CHANNELS.guardReady);
  },
  openSettings: () => {
    ipcRenderer.send(CHANNELS.guardOpenSettings);
  },
  quit: () => {
    ipcRenderer.send(CHANNELS.guardQuit);
  },
});
