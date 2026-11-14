interface KpSettingsState {
  mode: 'start' | 'edit';
  episodeLimit: number;
  startUrl: string;
  updateUrl: string;
  player: 'browser' | 'electron';
  appVersion: string;
  limit: number;
  used: number;
  remaining: number | null;
}

interface KpSavePayload {
  episodeLimit: number;
  startUrl: string;
  updateUrl: string;
  start: boolean;
}

interface KpResult {
  ok: boolean;
  error?: string;
}

interface KpApi {
  getState(): Promise<KpSettingsState>;
  start(): Promise<KpResult>;
  save(payload: KpSavePayload): Promise<KpResult>;
  logout(): Promise<KpResult>;
  close(): Promise<void>;
  onState(callback: (state: unknown) => void): void;
}

interface Window {
  kp: KpApi;
}
