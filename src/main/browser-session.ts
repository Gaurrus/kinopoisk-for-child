import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import CDP = require('chrome-remote-interface');
import type { AuthStatus } from '../shared/types';
import { logDrm } from './diagnostics';
import type { EpisodeLimiter } from './limiter';

export interface BrowserCandidate {
  path: string;
  name: string;
}

const KINOPOISK_URL_RE = /^https:\/\/([a-z0-9-]+\.)*kinopoisk\.ru\//i;


function exists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findOnPath(names: string[]): string | null {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function findBrowser(): BrowserCandidate | null {
  const override = process.env.KP_BROWSER_PATH;
  if (override && exists(override)) {
    return { path: override, name: path.basename(override) };
  }

  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter((root): root is string => Boolean(root));

    const candidates = [
      ...roots.map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((root) =>
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) {
        return { path: candidate, name: path.basename(candidate, '.exe') };
      }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(
        process.env.HOME ?? '',
        'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return { path: candidate, name: path.basename(candidate) };
    }
    return null;
  }

  const onPath = findOnPath([
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
  ]);
  return onPath ? { path: onPath, name: path.basename(onPath) } : null;
}

export interface BrowserSessionOptions {
  profileDir: string;
  startUrl: string;
  guardSource: string;
  limiter: EpisodeLimiter;
  cdpEnabled?: boolean;
  onOpenSettings: () => void;
  onExit: () => void;
  onSnapshotChanged: () => void;
  onAuthChanged: (auth: AuthStatus) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserGuardSession {
  private child: ChildProcess | null = null;
  private port = 0;
  private clients = new Map<string, CDP.Client>();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private active = false;
  private stopping = false;
  private exitHandled = false;
  private sawPage = false;
  private emptyPolls = 0;
  private auth: AuthStatus = { loggedIn: false, login: null };

  constructor(private readonly options: BrowserSessionOptions) {}

  isActive(): boolean {
    return this.active && !this.stopping;
  }

  getAuth(): AuthStatus {
    return this.auth;
  }

  async start(): Promise<void> {
    const browser = findBrowser();
    if (!browser) {
      throw new Error('Google Chrome или Microsoft Edge не найден');
    }

    fs.mkdirSync(this.options.profileDir, { recursive: true });
    this.killStaleBrowser();
    await delay(400);

    const portFile = path.join(this.options.profileDir, 'DevToolsActivePort');
    try {
      fs.unlinkSync(portFile);
    } catch {
      /* no stale port */
    }

    const useCdp = this.options.cdpEnabled !== false && process.env.KP_NO_CDP !== '1';
    const args = [
      `--user-data-dir=${this.options.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--test-type',
      '--lang=ru',
    ];

    if (useCdp) {
      args.push(
        '--remote-debugging-port=0',
        '--autoplay-policy=no-user-gesture-required',
        `--app=${this.options.startUrl}`,
        '--disable-background-mode',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--start-maximized',
      );
    } else {
      args.push('--new-window', this.options.startUrl);
    }

    this.child = spawn(browser.path, args, { stdio: 'ignore' });
    this.child.on('exit', () => {
      if (!this.stopping) this.handleExit();
    });
    if (this.child.pid) {
      try {
        fs.writeFileSync(this.pidFile(), String(this.child.pid), 'utf8');
      } catch {
        /* ignore */
      }
    }

    if (!useCdp) {
      this.active = true;
      this.sawPage = true;
      return;
    }

    this.port = await this.waitForPort(portFile, 25_000);
    this.active = true;

    await this.pollTargets();
    this.pollTimer = setInterval(() => {
      void this.pollTargets();
    }, 700);
  }

  private pidFile(): string {
    return path.join(this.options.profileDir, 'browser.pid');
  }

  private killStaleBrowser(): void {
    const file = this.pidFile();
    let pid = 0;
    try {
      pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    } catch {
      pid = 0;
    }
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGTERM');
          setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              /* already gone */
            }
          }, 1200);
        }
        console.log('[browser] stopped stale browser process', pid);
      } catch {
        /* not running */
      }
    }
    try {
      fs.unlinkSync(file);
    } catch {
      /* no pid file */
    }
  }

  private async waitForPort(portFile: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const firstLine = fs.readFileSync(portFile, 'utf8').split('\n')[0]?.trim() ?? '';
        const port = Number.parseInt(firstLine, 10);
        if (Number.isInteger(port) && port > 0) return port;
      } catch {
        /* not written yet */
      }
      if (this.child && this.child.exitCode !== null) {
        throw new Error('Браузер завершился сразу после запуска');
      }
      await delay(150);
    }
    throw new Error('Браузер не открыл отладочный порт');
  }

  private async pollTargets(): Promise<void> {
    if (!this.active || this.stopping || this.polling) return;
    this.polling = true;
    try {
      const targets = await CDP.List({ port: this.port });
      const live = new Set<string>();

      for (const target of targets) {
        if (target.type !== 'page') continue;
        if (!/^https?:/i.test(target.url)) continue;
        live.add(target.id);
        if (!this.clients.has(target.id)) {
          await this.attach(target);
        }
      }

      for (const [id, client] of this.clients) {
        if (live.has(id)) continue;
        this.clients.delete(id);
        try {
          await client.close();
        } catch {
          /* already gone */
        }
      }

      if (live.size > 0) {
        this.sawPage = true;
        this.emptyPolls = 0;
      } else if (this.sawPage) {
        this.emptyPolls += 1;
        if (this.emptyPolls >= 4) this.handleExit();
      }
    } catch {
      /* browser is closing or not ready */
    } finally {
      this.polling = false;
    }
  }

  private async attach(target: CDP.Target): Promise<void> {
    let client: CDP.Client;
    try {
      client = await CDP({ port: this.port, target: target.id });
      await Promise.all([
        client.Page.enable(),
        client.Runtime.enable(),
        client.Network.enable(),
      ]);
      await client.Runtime.addBinding({ name: '__kpAttempt' });
      await client.Page.addScriptToEvaluateOnNewDocument({
        source: this.options.guardSource,
      });
    } catch {
      return;
    }

    client.on('Runtime.bindingCalled', (event) => {
      if (event.name !== '__kpAttempt') return;
      void this.handleMessage(client, event.payload);
    });
    client.on('disconnect', () => {
      this.clients.delete(target.id);
    });
    client.on('Page.frameNavigated', (event) => {
      if (!event.frame.parentId) {
        void this.refreshAuth(client);
        if (KINOPOISK_URL_RE.test(event.frame.url)) {
          void this.maximizeWindow(client, target.id);
        }
      }
    });

    this.clients.set(target.id, client);

    if (KINOPOISK_URL_RE.test(target.url)) {
      try {
        await client.Runtime.evaluate({ expression: this.options.guardSource });
        await this.sendSnapshot(client);
      } catch {
        /* page may be navigating */
      }
      await this.maximizeWindow(client, target.id);
    }

    await this.refreshAuth(client);
  }

  private async handleMessage(client: CDP.Client, payload: string): Promise<void> {
    let data: { type?: string; id?: string; key?: string };
    try {
      data = JSON.parse(payload) as typeof data;
    } catch {
      return;
    }

    if (data.type === 'ready') {
      await this.sendSnapshot(client);
      return;
    }

    if (data.type === 'attempt') {
      const outcome = this.options.limiter.attempt(
        typeof data.key === 'string' ? data.key : null,
      );
      const snapshot = this.options.limiter.snapshot();
      this.options.onSnapshotChanged();

      const id = JSON.stringify(String(data.id ?? ''));
      const snapshotJson = JSON.stringify(JSON.stringify(snapshot));
      const expression = `window.__kpDecision && window.__kpDecision(${id}, ${outcome.allowed}, ${snapshotJson})`;
      try {
        await client.Runtime.evaluate({ expression });
      } catch {
        /* page may be gone */
      }

      if (outcome.allowed) {
        void this.enterFullscreenWithRetries(client);
      } else {
        await this.stop();
        this.options.onExit();
      }
      return;
    }

    if (data.type === 'playbackStart') {
      void this.enterFullscreenWithRetries(client);
      return;
    }

    if (data.type === 'openSettings') {
      this.options.onOpenSettings();
      return;
    }

    if (data.type === 'quit') {
      await this.stop();
      this.options.onExit();
    }
  }

  private async maximizeWindow(client: CDP.Client, targetId: string): Promise<void> {
    try {
      const { windowId } = await client.Browser.getWindowForTarget({ targetId });
      await client.Browser.setWindowBounds({
        windowId,
        bounds: { windowState: 'maximized' },
      });
      return;
    } catch {
      /* fall back to explicit bounds */
    }

    try {
      const size = await client.Runtime.evaluate({
        expression: 'JSON.stringify({ width: screen.availWidth, height: screen.availHeight })',
        returnByValue: true,
      });
      const parsed = JSON.parse(String(size.result.value)) as {
        width: number;
        height: number;
      };
      const { windowId } = await client.Browser.getWindowForTarget({ targetId });
      await client.Browser.setWindowBounds({
        windowId,
        bounds: {
          left: 0,
          top: 0,
          width: parsed.width,
          height: parsed.height,
          windowState: 'normal',
        },
      });
    } catch {
      /* window may already be closing */
    }
  }

  private async enterFullscreenWithRetries(client: CDP.Client): Promise<void> {
    for (const wait of [0, 700, 1200, 1800, 2500]) {
      if (wait > 0) await delay(wait);
      if (await this.enterFullscreen(client)) return;
    }
    logDrm('[fullscreen] не удалось развернуть видео после нескольких попыток');
  }

  private async enterFullscreen(client: CDP.Client): Promise<boolean> {
    const expression = `(() => {
      try {
        if (document.fullscreenElement) return 'already';

        const videos = Array.from(document.querySelectorAll('video')).filter((video) => {
          const rect = video.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            Number.isFinite(video.duration) &&
            video.duration >= 60
          );
        });
        const video = videos.sort(
          (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width,
        )[0];
        if (!video) return 'no-episode-video';

        const label = (el) => {
          const parts = [];
          try { parts.push(el.getAttribute('aria-label') || ''); } catch (e) {}
          try { parts.push(el.getAttribute('title') || ''); } catch (e) {}
          try { parts.push(typeof el.className === 'string' ? el.className : ''); } catch (e) {}
          return parts.join(' ').toLowerCase();
        };
        const fullscreenLabel =
          /fullscreen|full-screen|full_screen|полный экран|полноэкран|весь экран/;

        const container =
          video.closest('[data-testid*="player" i],[class*="player" i]') ||
          video.parentElement ||
          video;
        const scopes = [container, container.parentElement].filter(Boolean);

        for (const scope of scopes) {
          const button = Array.from(
            scope.querySelectorAll(
              'button,[role="button"],[class*="fullscreen" i],[data-testid*="fullscreen" i]',
            ),
          ).find(
            (el) =>
              fullscreenLabel.test(label(el)) &&
              el.getBoundingClientRect().width > 0,
          );
          if (button) {
            button.click();
            return 'button';
          }
        }

        const request = container.requestFullscreen || container.webkitRequestFullscreen;
        if (!request) return 'no-request';
        Promise.resolve(request.call(container)).catch(() => {
          try { video.requestFullscreen(); } catch (e) {}
        });
        return 'request';
      } catch (e) {
        return 'error:' + (e && e.message);
      }
    })()`;

    try {
      const result = await client.Runtime.evaluate({
        expression,
        userGesture: true,
        returnByValue: true,
      });
      const status = String(result.result.value ?? '');
      await delay(600);
      const check = await client.Runtime.evaluate({
        expression: '!!document.fullscreenElement',
        returnByValue: true,
      });
      const ok = check.result.value === true;
      logDrm(`[fullscreen] ${status} -> ${ok ? 'ok' : 'no'}`);
      return ok;
    } catch (error) {
      logDrm(
        `[fullscreen] eval error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async sendSnapshot(client: CDP.Client): Promise<void> {
    const snapshotJson = JSON.stringify(JSON.stringify(this.options.limiter.snapshot()));
    const expression = `window.__kpApplyState && window.__kpApplyState(${snapshotJson})`;
    try {
      await client.Runtime.evaluate({ expression });
    } catch {
      /* page may be gone */
    }
  }

  broadcast(): void {
    for (const client of this.clients.values()) {
      void this.sendSnapshot(client);
    }
  }

  async debugEvaluate(expression: string): Promise<unknown> {
    for (const client of this.clients.values()) {
      try {
        const { result } = await client.Runtime.evaluate({
          expression,
          returnByValue: true,
        });
        return result.value;
      } catch {
        /* try next page */
      }
    }
    return null;
  }

  private async refreshAuth(client: CDP.Client): Promise<void> {
    try {
      const { cookies } = await client.Network.getCookies({
        urls: [
          'https://hd.kinopoisk.ru/',
          'https://passport.yandex.ru/',
          'https://yandex.ru/',
        ],
      });
      const rawLogin = cookies.find((cookie) => cookie.name === 'yandex_login')?.value ?? null;
      const login = rawLogin && rawLogin.length > 0 ? rawLogin : null;
      const hasSession = cookies.some((cookie) =>
        /^(session_id|sessionid)$/i.test(cookie.name),
      );
      const next: AuthStatus = { loggedIn: Boolean(login) || hasSession, login };

      if (next.loggedIn !== this.auth.loggedIn || next.login !== this.auth.login) {
        this.auth = next;
        this.options.onAuthChanged(next);
      }
    } catch {
      /* network domain not ready */
    }
  }

  async clearSession(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.Network.clearBrowserCookies();
        await client.Page.reload();
      } catch {
        /* ignore */
      }
    }
    this.auth = { loggedIn: false, login: null };
    this.options.onAuthChanged(this.auth);
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.active = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();

    try {
      fs.unlinkSync(this.pidFile());
    } catch {
      /* no pid file */
    }

    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    }
  }

  private handleExit(): void {
    if (this.exitHandled) return;
    this.exitHandled = true;
    void this.stop().finally(() => this.options.onExit());
  }
}
