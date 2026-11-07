import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } from 'electron';
import * as electron from 'electron';
import path from 'node:path';
import { CHANNELS } from '../shared/channels';
import type {
  ActionResult,
  AttemptResult,
  AuthStatus,
  SettingsState,
  SettingsWindowMode,
} from '../shared/types';
import { initDrmLog, installDrmLogging, logDrm } from './diagnostics';
import { EpisodeLimiter, normalizeLimit } from './limiter';
import {
  isValidPin,
  isValidStartUrl,
  loadSettings,
  saveSettings,
  type Settings,
} from './store';

const isDev = process.argv.includes('--dev');
const PARTITION = 'persist:kinopoisk';

interface EcsComponents {
  whenReady: () => Promise<void>;
  status: () => unknown;
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let settingsWindowMode: SettingsWindowMode = 'start';
let settingsUnlocked = false;
let pinFailures = 0;
let limiter: EpisodeLimiter | null = null;
let settings: Settings;
let widevineReady: Promise<void> = Promise.resolve();

// Do NOT spoof the user agent: Kinopoisk's Widevine license server rejects
// playback when the Chromium UA does not match the actual DRM client.
app.setName('Kinopoisk for child');
app.setAppUserModelId('ru.gaurrus.kinopoisk-child');

async function ensureWidevine(): Promise<void> {
  const components = (electron as unknown as { components?: EcsComponents }).components;
  if (!components || typeof components.whenReady !== 'function') {
    console.warn('[widevine] components API is unavailable (stock Electron build)');
    return;
  }
  try {
    await Promise.race([
      components.whenReady(),
      new Promise<void>((resolve) => setTimeout(resolve, 20_000)),
    ]);
    const status = components.status();
    console.log('[widevine] ready', status);
    logDrm(`[widevine] ready ${JSON.stringify(status)}`);
  } catch (error) {
    console.error('[widevine] initialization failed', error);
    logDrm(`[widevine] failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isAllowedInApp(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'about:' ||
      url.protocol === 'devtools:' ||
      url.protocol === 'https:' ||
      url.protocol === 'http:'
    );
  } catch {
    return false;
  }
}

function openExternal(raw: string): void {
  if (!/^https?:\/\//i.test(raw)) return;
  void shell.openExternal(raw).catch((error: unknown) => {
    console.error('[shell] failed to open external url', error);
  });
}

async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const ses = session.fromPartition(PARTITION);
    const [kinopoiskCookies, yandexCookies] = await Promise.all([
      ses.cookies.get({ domain: '.kinopoisk.ru' }),
      ses.cookies.get({ domain: '.yandex.ru' }),
    ]);
    const login =
      kinopoiskCookies.find((cookie) => cookie.name === 'yandex_login')?.value ??
      yandexCookies.find((cookie) => cookie.name === 'yandex_login')?.value ??
      null;
    const hasSession =
      yandexCookies.some((cookie) => /^(session_id|sessionid)$/i.test(cookie.name)) ||
      kinopoiskCookies.some((cookie) => /^(session_id|sessionid)$/i.test(cookie.name));
    return { loggedIn: Boolean(login) || hasSession, login };
  } catch {
    return { loggedIn: false, login: null };
  }
}

function fallbackSnapshot() {
  const limit = normalizeLimit(settings.episodeLimit);
  return {
    limit,
    used: 0,
    remaining: limit === 0 ? null : limit,
    allowed: [] as string[],
  };
}

async function getSettingsState(): Promise<SettingsState> {
  const snapshot = limiter ? limiter.snapshot() : fallbackSnapshot();
  return {
    mode: settingsWindowMode,
    episodeLimit: settings.episodeLimit,
    startUrl: settings.startUrl,
    hasPin: settings.pin.length > 0,
    unlocked: settingsUnlocked,
    auth: await getAuthStatus(),
    logPath: path.join(app.getPath('userData'), 'drm.log'),
    ...snapshot,
  };
}

function broadcastState(): void {
  if (!limiter) return;
  const snapshot = limiter.snapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(CHANNELS.guardState, snapshot);
    }
  }
}

function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
  settingsWindow = null;
}

function openSettingsWindow(mode: SettingsWindowMode): void {
  settingsWindowMode = mode;
  pinFailures = 0;
  settingsUnlocked = settings.pin.length === 0;

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: mode === 'start' ? 720 : 660,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Kinopoisk — настройки',
    backgroundColor: '#12141a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      devTools: isDev,
      spellcheck: false,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  void settingsWindow.loadFile(path.join(__dirname, '../renderer/start/index.html'), {
    query: { mode },
  });
}

/**
 * Keep the whole login flow inside the app: Google/Yandex redirects after
 * authorization must not jump to the system browser. Only non-web schemes are
 * blocked.
 */
function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedInApp(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true },
      };
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedInApp(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'Kinopoisk',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/guard.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      devTools: isDev,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  window.setMenuBarVisibility(false);
  hardenWebContents(window);

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = null;
  });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload] error', preloadPath, error);
  });

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const withModifier = input.control && input.shift;

    if (withModifier && key === 'l') {
      event.preventDefault();
      openSettingsWindow('edit');
      return;
    }
    if (key === 'f11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
      return;
    }
    if (isDev && (key === 'f12' || (withModifier && key === 'i'))) {
      event.preventDefault();
      window.webContents.toggleDevTools();
    }
  });

  return window;
}

async function startSession(limit: number, startUrl: string): Promise<void> {
  settings.episodeLimit = normalizeLimit(limit);
  settings.startUrl = isValidStartUrl(startUrl) ? startUrl.trim() : settings.startUrl;
  saveSettings(app.getPath('userData'), settings);

  limiter = new EpisodeLimiter(settings.episodeLimit);

  await widevineReady;

  if (!mainWindow) {
    mainWindow = createMainWindow();
  }
  closeSettingsWindow();
  void mainWindow.loadURL(settings.startUrl);
  broadcastState();
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.settingsGet, () => getSettingsState());

  ipcMain.handle(CHANNELS.settingsStart, async (): Promise<ActionResult> => {
    await startSession(settings.episodeLimit, settings.startUrl);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.settingsVerifyPin, (_event, pin: unknown): ActionResult => {
    if (settings.pin.length === 0) {
      settingsUnlocked = true;
      return { ok: true };
    }
    if (pinFailures >= 5) {
      return { ok: false, error: 'Слишком много попыток. Перезапустите приложение.' };
    }
    if (typeof pin === 'string' && pin === settings.pin) {
      settingsUnlocked = true;
      pinFailures = 0;
      return { ok: true };
    }
    pinFailures += 1;
    return { ok: false, error: 'Неверный PIN' };
  });

  ipcMain.handle(CHANNELS.settingsSave, async (_event, payload: unknown): Promise<ActionResult> => {
    if (settings.pin.length > 0 && !settingsUnlocked) {
      return { ok: false, error: 'Сначала введите PIN' };
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, error: 'Некорректные данные' };
    }

    const data = payload as Record<string, unknown>;
    const limit = normalizeLimit(data.episodeLimit);
    const startUrl = data.startUrl;

    if (!isValidStartUrl(startUrl)) {
      return { ok: false, error: 'Ссылка должна вести на https://hd.kinopoisk.ru/' };
    }
    if ('pin' in data && !isValidPin(data.pin)) {
      return { ok: false, error: 'PIN должен состоять из 4–8 цифр или быть пустым' };
    }

    settings.episodeLimit = limit;
    settings.startUrl = startUrl.trim();
    if ('pin' in data && typeof data.pin === 'string') {
      settings.pin = data.pin;
    }
    saveSettings(app.getPath('userData'), settings);

    if (data.start === true) {
      await startSession(limit, settings.startUrl);
      return { ok: true };
    }

    if (limiter) {
      limiter.setLimit(limit);
      broadcastState();
    }
    closeSettingsWindow();
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.settingsClose, () => {
    closeSettingsWindow();
  });

  ipcMain.handle(CHANNELS.openLogs, async (): Promise<ActionResult> => {
    const error = await shell.openPath(app.getPath('userData'));
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle(CHANNELS.sessionLogout, async (): Promise<ActionResult> => {
    try {
      await session.fromPartition(PARTITION).clearStorageData();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on(CHANNELS.guardReady, (event) => {
    if (limiter) {
      event.sender.send(CHANNELS.guardState, limiter.snapshot());
    }
  });

  ipcMain.handle(CHANNELS.guardAttempt, (_event, key: unknown): AttemptResult => {
    if (!limiter) {
      return {
        allowed: true,
        alreadyCounted: false,
        state: fallbackSnapshot(),
      };
    }
    const outcome = limiter.attempt(typeof key === 'string' ? key : null);
    broadcastState();
    return { ...outcome, state: limiter.snapshot() };
  });

  ipcMain.on(CHANNELS.guardQuit, () => {
    app.quit();
  });

  ipcMain.on(CHANNELS.guardOpenSettings, () => {
    openSettingsWindow('edit');
  });
}

async function bootstrap(): Promise<void> {
  settings = loadSettings(app.getPath('userData'));
  initDrmLog(app.getPath('userData'));
  logDrm(`[app] userAgent=${app.userAgentFallback}`);
  Menu.setApplicationMenu(null);
  registerIpc();
  installDrmLogging(session.fromPartition(PARTITION));
  openSettingsWindow('start');
  widevineReady = ensureWidevine();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openSettingsWindow('start');
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  let googleRejectNoticeShown = false;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-navigate', (_navigateEvent, url) => {
      if (googleRejectNoticeShown) return;
      if (!/^https:\/\/accounts\.google\.com\//i.test(url)) return;
      if (!/signin\/rejected|deniedsigninrejected/i.test(url)) return;
      googleRejectNoticeShown = true;
      void dialog
        .showMessageBox({
          type: 'warning',
          title: 'Google блокирует вход',
          message: 'Google не разрешает вход из встроенного браузера',
          detail:
            'Войдите в Яндекс ID по логину и паролю — этот способ работает всегда. ' +
            'Если аккаунт создан через Google, пароль можно задать на id.yandex.ru.',
          buttons: ['Понятно', 'Открыть id.yandex.ru'],
          defaultId: 0,
          cancelId: 0,
        })
        .then((result) => {
          if (result.response === 1) {
            openExternal('https://id.yandex.ru/security');
          }
        });
    });
  });

  void app.whenReady().then(bootstrap).catch((error: unknown) => {
    console.error('[app] failed to start', error);
    app.quit();
  });
}
