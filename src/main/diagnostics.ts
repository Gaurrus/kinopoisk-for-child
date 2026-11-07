import fs from 'node:fs';
import path from 'node:path';

const DRM_URL_RE = /(widevine|drm|license)/i;

let logFile: string | null = null;

export function initDrmLog(dir: string): void {
  logFile = path.join(dir, 'drm.log');
}

export function logDrm(line: string): void {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    /* diagnostics must never break playback */
  }
}

export function installDrmLogging(ses: Electron.Session): void {
  ses.webRequest.onCompleted((details) => {
    if (DRM_URL_RE.test(details.url)) {
      logDrm(`[http] ${details.method} ${details.statusCode} ${details.url}`);
    }
  });
  ses.webRequest.onErrorOccurred((details) => {
    if (DRM_URL_RE.test(details.url)) {
      logDrm(`[http] error=${details.error} ${details.url}`);
    }
  });
}
