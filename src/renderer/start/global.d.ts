interface KpAuthStatus {
  loggedIn: boolean;
  login: string | null;
}

interface KpSettingsState {
  mode: 'start' | 'edit';
  episodeLimit: number;
  startUrl: string;
  hasPin: boolean;
  unlocked: boolean;
  limit: number;
  used: number;
  remaining: number | null;
  auth: KpAuthStatus;
  logPath: string;
  player: 'browser' | 'electron';
}

interface KpSavePayload {
  episodeLimit: number;
  startUrl: string;
  pin?: string;
  start: boolean;
}

interface KpResult {
  ok: boolean;
  error?: string;
  action?: 'login' | 'controlled';
}

interface KpApi {
  getState(): Promise<KpSettingsState>;
  start(): Promise<KpResult>;
  save(payload: KpSavePayload): Promise<KpResult>;
  verifyPin(pin: string): Promise<KpResult>;
  logout(): Promise<KpResult>;
  close(): Promise<void>;
  openLogs(): Promise<KpResult>;
  loginDone(): Promise<KpResult>;
  loginCancel(): Promise<KpResult>;
  relogin(): Promise<KpResult>;
  onLoginClosed(callback: () => void): void;
  onState(callback: (state: unknown) => void): void;
}

interface Window {
  kp: KpApi;
}
