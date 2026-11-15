import fs from 'node:fs';
import path from 'node:path';
import { normalizeLimit } from './limiter';

export const DEFAULT_START_URL = 'https://hd.kinopoisk.ru/film/48609c673b79f2e589e08b9cb9c4faf5';

export interface Settings {
  episodeLimit: number;
  startUrl: string;
  updateUrl: string;
}

const GITHUB_UPDATE_URL =
  'https://github.com/Gaurrus/kinopoisk-for-child/releases/latest/download/';
const LEGACY_UPDATE_URL = 'http://macbook-air-igor.local:8080/';

const DEFAULTS: Settings = {
  episodeLimit: 2,
  startUrl: DEFAULT_START_URL,
  updateUrl: GITHUB_UPDATE_URL,
};

const KINOPOISK_URL_RE = /^https:\/\/hd\.kinopoisk\.ru\//i;

function settingsFile(dir: string): string {
  return path.join(dir, 'settings.json');
}

export function isValidStartUrl(value: unknown): value is string {
  return typeof value === 'string' && KINOPOISK_URL_RE.test(value.trim());
}

export function isValidUpdateUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === '' || /^https?:\/\/\S+$/i.test(trimmed);
}

export function loadSettings(dir: string): Settings {
  try {
    const raw = fs.readFileSync(settingsFile(dir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const rawUpdateUrl =
      typeof parsed.updateUrl === 'string' ? parsed.updateUrl.trim() : '';
    return {
      episodeLimit: normalizeLimit(parsed.episodeLimit ?? DEFAULTS.episodeLimit),
      startUrl: isValidStartUrl(parsed.startUrl) ? parsed.startUrl.trim() : DEFAULTS.startUrl,
      updateUrl:
        rawUpdateUrl === '' || rawUpdateUrl === LEGACY_UPDATE_URL
          ? GITHUB_UPDATE_URL
          : isValidUpdateUrl(rawUpdateUrl)
            ? rawUpdateUrl
            : GITHUB_UPDATE_URL,
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
