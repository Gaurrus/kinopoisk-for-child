import { app, dialog, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_DELAY_MS = 2500;

interface VersionInfo {
  version?: string;
  win?: string | null;
  mac?: string | null;
}

function normalizeBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value.endsWith('/') ? value : `${value}/`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function initUpdater(updateUrl: string | undefined): void {
  const base = updateUrl ? normalizeBaseUrl(updateUrl) : null;
  if (!base || !app.isPackaged) return;

  setTimeout(() => {
    void check(base);
  }, CHECK_DELAY_MS);
}

async function check(base: string): Promise<void> {
  if (process.platform === 'win32') {
    await checkWindows(base);
    return;
  }
  if (process.platform === 'darwin') {
    await checkMac(base);
  }
}

async function checkWindows(base: string): Promise<void> {
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: base });
    autoUpdater.on('error', (error) => {
      console.warn('[updater] error:', error.message);
    });
    autoUpdater.on('update-available', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          title: 'Обновление',
          message: `Доступна версия ${info.version}`,
          detail: 'Скачать и установить обновление?',
          buttons: ['Скачать', 'Позже'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) void autoUpdater.downloadUpdate();
        });
    });
    autoUpdater.on('update-downloaded', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          title: 'Обновление готово',
          message: `Версия ${info.version} загружена`,
          detail: 'Перезапустить приложение и установить обновление?',
          buttons: ['Перезапустить', 'Позже'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.warn('[updater] windows check failed:', error);
  }
}

async function checkMac(base: string): Promise<void> {
  try {
    const response = await net.fetch(`${base}version.json`, { cache: 'no-store' });
    if (!response.ok) return;

    const info = (await response.json()) as VersionInfo;
    if (!info.version || compareVersions(info.version, app.getVersion()) <= 0) {
      return;
    }

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Обновление',
      message: `Доступна версия ${info.version}`,
      detail:
        'На macOS обновление устанавливается вручную: скачайте новую сборку и замените приложение в Applications.',
      buttons: ['Скачать', 'Позже'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      const target = info.mac ? new URL(info.mac, base).toString() : base;
      await shell.openExternal(target);
    }
  } catch (error) {
    console.warn('[updater] mac check failed:', error);
  }
}
