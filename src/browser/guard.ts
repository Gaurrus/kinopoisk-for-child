import { startGuard, type GuardAttemptResult, type GuardSnapshot } from './guard-runtime';

interface KpBindingWindow extends Window {
  __kpAttempt?: (message: string) => void;
  __kpApplyState?: (snapshotJson: string) => void;
  __kpDecision?: (id: string, allowed: boolean, snapshotJson: string) => void;
}

const target = window as KpBindingWindow;
const pending = new Map<string, (result: GuardAttemptResult) => void>();
const listeners = new Set<(snapshot: GuardSnapshot) => void>();
let sequence = 0;

target.__kpApplyState = (snapshotJson: string) => {
  try {
    const snapshot = JSON.parse(snapshotJson) as GuardSnapshot;
    for (const listener of listeners) listener(snapshot);
  } catch {
    /* ignore malformed state */
  }
};

target.__kpDecision = (id: string, allowed: boolean, snapshotJson: string) => {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  let snapshot: GuardSnapshot | undefined;
  try {
    snapshot = JSON.parse(snapshotJson) as GuardSnapshot;
  } catch {
    snapshot = undefined;
  }
  resolve({ allowed, snapshot });
};

function send(message: unknown): void {
  try {
    target.__kpAttempt?.(JSON.stringify(message));
  } catch {
    /* binding is not installed yet */
  }
}

startGuard({
  attempt: (key) =>
    new Promise<GuardAttemptResult>((resolve) => {
      const id = `${Date.now()}-${++sequence}`;
      pending.set(id, resolve);
      send({ type: 'attempt', id, key });
      setTimeout(() => {
        if (pending.delete(id)) resolve({ allowed: true });
      }, 5000);
    }),
  onSnapshot: (callback) => {
    listeners.add(callback);
    send({ type: 'ready' });
  },
  onPlaybackStart: (key) => {
    send({ type: 'playbackStart', key });
  },
  openSettings: () => {
    send({ type: 'openSettings' });
  },
  quit: () => {
    send({ type: 'quit' });
  },
});
