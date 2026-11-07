import fs from 'node:fs';
import path from 'node:path';
import { normalizeLimit } from './limiter';

export const DEFAULT_START_URL = 'https://hd.kinopoisk.ru/film/48609c673b79f2e589e08b9cb9c4faf5';

export interface Settings {
  episodeLimit: number;
  startUrl: string;
  pin: string;
}

const DEFAULTS: Settings = {
  episodeLimit: 2,
  startUrl: DEFAULT_START_URL,
  pin: '',
};

const KINOPOISK_URL_RE = /^https:\/\/hd\.kinopoisk\.ru\//i;

function settingsFile(dir: string): string {
  return path.join(dir, 'settings.json');
}

export function isValidStartUrl(value: unknown): value is string {
  return typeof value === 'string' && KINOPOISK_URL_RE.test(value.trim());
}

export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^\d{4,8}$/.test(value));
}

export function loadSettings(dir: string): Settings {
  try {
    const raw = fs.readFileSync(settingsFile(dir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      episodeLimit: normalizeLimit(parsed.episodeLimit ?? DEFAULTS.episodeLimit),
      startUrl: isValidStartUrl(parsed.startUrl) ? parsed.startUrl.trim() : DEFAULTS.startUrl,
      pin: isValidPin(parsed.pin) ? parsed.pin : DEFAULTS.pin,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = settingsFile(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
