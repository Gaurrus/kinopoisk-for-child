import { extractContentId, parseSeasonEpisode, strongEpisodeKey } from '../shared/episode';

export interface GuardSnapshot {
  limit: number;
  used: number;
  remaining: number | null;
  allowed: string[];
}

export interface GuardAttemptResult {
  allowed: boolean;
  snapshot?: GuardSnapshot;
}

export interface GuardTransport {
  attempt(key: string): Promise<GuardAttemptResult>;
  onSnapshot(callback: (snapshot: GuardSnapshot) => void): void;
  onPlaybackStart?(key: string): void;
  openSettings(): void;
  quit(): void;
}

const UI_ROOT_ID = 'kp-child-guard-ui';
const COUNT_THRESHOLD_SEC = 5;
const MIN_WEAK_DURATION_SEC = 60;
const AUTO_CONTINUE_DELAYS_MS = [0, 800, 1600, 3000, 5000, 8000, 12000];
const AUTO_CONTINUE_TARGETS = ['продолжить просмотр', 'смотреть сериал'];
const KINOPOISK_HOST_RE = /(^|\.)kinopoisk\.ru$/i;

interface CurrentPlayback {
  key: string;
  strong: boolean;
  reported: boolean;
  video: HTMLVideoElement;
  url: string;
  duration: number;
}

interface ResolvedKey {
  key: string;
  strong: boolean;
}

interface DomEpisode {
  season: number | null;
  episode: number;
}

let transport: GuardTransport | null = null;
let limit = 2;
let used = 0;
const allowedKeys = new Set<string>();

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let badge: HTMLDivElement | null = null;
let badgeText: HTMLSpanElement | null = null;

let blocked = false;
let current: CurrentPlayback | null = null;
let lastKey: string | null = null;
let lastEnded = false;
let autoContinueDone = false;
const repeatCounters = new Map<string, number>();

function isUnlimited(): boolean {
  return limit === 0;
}

function remaining(): number | null {
  return isUnlimited() ? null : Math.max(0, limit - used);
}

function applyState(snapshot: GuardSnapshot): void {
  if (typeof snapshot.limit === 'number') limit = snapshot.limit;
  if (typeof snapshot.used === 'number') used = snapshot.used;

  if (Array.isArray(snapshot.allowed)) {
    allowedKeys.clear();
    for (const key of snapshot.allowed) allowedKeys.add(key);
  }

  renderBadge();
}

function renderBadge(): void {
  if (!badge || !badgeText) return;
  if (isUnlimited()) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'flex';
  const left = remaining() ?? 0;
  badgeText.textContent =
    left > 0 ? `Осталось серий: ${left} из ${limit}` : 'Лимит серий исчерпан';
  badge.classList.toggle('danger', left === 0);
}

function seasonEpisodeFromDom(): DomEpisode | null {
  const texts: string[] = [];
  try {
    texts.push(document.title);
  } catch {
    /* ignore */
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) texts.push(ogTitle.getAttribute('content') ?? '');

  const candidates = document.querySelectorAll(
    '[data-testid*="episode" i],[data-testid*="season" i],[class*="episode" i],[class*="season" i]',
  );
  let inspected = 0;
  for (const element of Array.from(candidates)) {
    if (inspected >= 30) break;
    inspected += 1;
    const text = (element.textContent ?? '').trim();
    if (text.length > 0 && text.length < 160) texts.push(text);
  }

  for (const text of texts) {
    const parsed = parseSeasonEpisode(text);
    if (parsed.episode !== null) {
      return { season: parsed.season, episode: parsed.episode };
    }
  }
  return null;
}

function resolveKey(video: HTMLVideoElement): ResolvedKey | null {
  const href = location.href;
  const strong = strongEpisodeKey(href);
  if (strong) return { key: strong, strong: true };

  const contentId = extractContentId(href) ?? 'unknown';

  const dom = seasonEpisodeFromDom();
  if (dom) {
    return {
      key: `dom:${contentId}:s${dom.season ?? 0}:e${dom.episode}`,
      strong: true,
    };
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration >= MIN_WEAK_DURATION_SEC) {
    return { key: `dur:${contentId}:${Math.round(duration)}`, strong: false };
  }

  return null;
}

function beginPlayback(video: HTMLVideoElement): void {
  if (blocked) {
    if (!video.paused) video.pause();
    return;
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const samePlayback =
    current !== null &&
    current.video === video &&
    current.url === location.href &&
    Math.abs(current.duration - duration) < 1;
  if (samePlayback) return;

  const resolved = resolveKey(video);
  if (!resolved) {
    current = null;
    return;
  }

  let key = resolved.key;
  if (!resolved.strong && lastEnded && lastKey === key) {
    const next = (repeatCounters.get(key) ?? 1) + 1;
    repeatCounters.set(key, next);
    key = `${key}#${next}`;
  }

  if (!isUnlimited() && used >= limit && !allowedKeys.has(key)) {
    blocked = true;
    if (!video.paused) video.pause();
    transport?.quit();
    return;
  }

  lastEnded = false;
  lastKey = key;

  const alreadyCounted = allowedKeys.has(key);
  current = {
    key,
    strong: resolved.strong,
    reported: alreadyCounted,
    video,
    url: location.href,
    duration,
  };

  transport?.onPlaybackStart?.(key);
}

async function attempt(key: string): Promise<boolean> {
  if (!transport) return true;
  try {
    const result = await transport.attempt(key);
    if (result.snapshot) applyState(result.snapshot);
    if (result.allowed) return true;

    blocked = true;
    if (current && !current.video.paused) current.video.pause();
    transport.quit();
    return false;
  } catch (error) {
    console.error('[guard] attempt failed', error);
    return true;
  }
}

function onPlay(event: Event): void {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement)) return;
  beginPlayback(video);
}

function onTimeUpdate(event: Event): void {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement)) return;

  if (blocked) {
    if (!video.paused) video.pause();
    return;
  }

  if (!current || current.video !== video || current.reported) return;
  if (!Number.isFinite(video.currentTime)) return;
  if (video.currentTime < COUNT_THRESHOLD_SEC) return;

  current.reported = true;
  const key = current.key;
  void attempt(key);
}

function onEnded(event: Event): void {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement)) return;

  const endedKey = current && current.video === video ? current.key : null;
  lastEnded = true;
  if (current && current.video === video) {
    current = null;
  }

  if (
    endedKey &&
    !isUnlimited() &&
    used >= limit &&
    allowedKeys.has(endedKey)
  ) {
    blocked = true;
    window.setTimeout(() => transport?.quit(), 1200);
  }
}

function injectUi(): void {
  if (document.getElementById(UI_ROOT_ID)) return;

  host = document.createElement('div');
  host.id = UI_ROOT_ID;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(UI_STYLES);
  shadow.adoptedStyleSheets = [sheet];
  shadow.innerHTML = UI_MARKUP;

  badge = shadow.querySelector<HTMLDivElement>('.badge');
  badgeText = shadow.querySelector<HTMLSpanElement>('.badge__text');

  document.documentElement.appendChild(host);
  renderBadge();
}

function tryAutoContinue(): void {
  if (autoContinueDone || blocked) return;

  const nodes = document.querySelectorAll<HTMLElement>('button, a, [role="button"]');
  const candidates: Array<{ node: HTMLElement; text: string }> = [];

  for (const node of Array.from(nodes)) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const text = [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (text.length === 0 || text.length > 60) continue;
    candidates.push({ node, text });
  }

  for (const target of AUTO_CONTINUE_TARGETS) {
    const hit = candidates.find((candidate) => candidate.text === target);
    if (!hit) continue;
    autoContinueDone = true;
    try {
      hit.node.click();
    } catch {
      /* ignore */
    }
    return;
  }
}

function scheduleAutoContinue(): void {
  for (const delay of AUTO_CONTINUE_DELAYS_MS) {
    window.setTimeout(tryAutoContinue, delay);
  }
}

function safeInjectUi(): void {
  try {
    injectUi();
  } catch (error) {
    console.error('[guard] ui injection failed', error);
  }
}

/**
 * Shared guard runtime used both by the Electron preload and by the script
 * injected into the system browser through CDP.
 */
export function startGuard(nextTransport: GuardTransport): void {
  const global = window as unknown as { __kpGuardStarted?: boolean };
  if (global.__kpGuardStarted) return;
  if (!KINOPOISK_HOST_RE.test(location.hostname)) return;
  global.__kpGuardStarted = true;
  transport = nextTransport;

  transport.onSnapshot(applyState);

  document.addEventListener('play', onPlay, true);
  document.addEventListener('playing', onPlay, true);
  document.addEventListener('timeupdate', onTimeUpdate, true);
  document.addEventListener('ended', onEnded, true);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      transport?.openSettings();
    }
  });

  window.addEventListener('beforeunload', () => {
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('playing', onPlay, true);
    document.removeEventListener('timeupdate', onTimeUpdate, true);
    document.removeEventListener('ended', onEnded, true);
  });

  if (document.documentElement) {
    safeInjectUi();
  } else {
    document.addEventListener('DOMContentLoaded', safeInjectUi, { once: true });
  }

  scheduleAutoContinue();
}

const UI_MARKUP = `
  <div class="badge" role="status">
    <span class="badge__dot"></span>
    <span class="badge__text">...</span>
  </div>
`;

const UI_STYLES = `
  :host {
    all: initial;
  }
  .badge {
    position: fixed;
    top: 14px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(16, 19, 26, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f4f6fb;
    font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    letter-spacing: 0.01em;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    opacity: 0.72;
    z-index: 1;
  }
  .badge.danger {
    border-color: rgba(255, 96, 96, 0.55);
    color: #ffd7d7;
    opacity: 1;
  }
  .badge__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #35d07f;
  }
  .badge.danger .badge__dot {
    background: #ff5c5c;
  }
`;
