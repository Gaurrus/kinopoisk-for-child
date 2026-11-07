export type SettingsWindowMode = 'start' | 'edit';

export interface AuthStatus {
  loggedIn: boolean;
  login: string | null;
}

export interface LimiterSnapshot {
  limit: number;
  used: number;
  remaining: number | null;
  allowed: string[];
}

export interface SettingsState extends LimiterSnapshot {
  mode: SettingsWindowMode;
  episodeLimit: number;
  startUrl: string;
  player: 'browser' | 'electron';
}

export interface SavePayload {
  episodeLimit: number;
  startUrl: string;
  start: boolean;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface AttemptResult {
  allowed: boolean;
  alreadyCounted: boolean;
  state: LimiterSnapshot;
}
