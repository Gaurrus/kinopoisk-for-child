import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.title = 'Kinopoisk for child server';

const root = path.resolve(process.env.UPDATE_ROOT ?? 'dist-app');
const port = Number.parseInt(process.env.UPDATE_PORT ?? '8080', 10);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

if (!existsSync(root)) {
  console.error(`[updates] каталог не найден: ${root}`);
  process.exit(1);
}

const entries = readdirSync(root);
const winName = `kinopoisk-for-child-${version}-setup.exe`;
const win = existsSync(path.join(root, winName)) ? winName : null;
const mac =
  entries.find((name) => name.endsWith(`-${version}-mac.zip`)) ??
  entries.find((name) => /-mac\.zip$/i.test(name)) ??
  null;

writeFileSync(
  path.join(root, 'version.json'),
  `${JSON.stringify({ version, win, mac }, null, 2)}\n`,
  'utf8',
);

const contentTypes = {
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.zip': 'application/zip',
  '.dmg': 'application/x-apple-diskimage',
  '.blockmap': 'application/octet-stream',
};

function sendFile(req, res, file) {
  const size = statSync(file).size;
  const type = contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
      if (start <= end && end < size) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': 'no-store',
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  console.log(`[updates] ${req.method} ${pathname}`);
  const relative = pathname === '/' ? 'version.json' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  sendFile(req, res, file);
});

function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address);
    }
  }
  return result;
}

server.listen(port, () => {
  console.log(`[updates] версия ${version}`);
  console.log(`[updates] каталог ${root}`);
  console.log(`[updates] локально http://127.0.0.1:${port}/`);
  for (const address of lanAddresses()) {
    console.log(`[updates] в сети  http://${address}:${port}/`);
  }
  try {
    const scutil = existsSync('/usr/sbin/scutil') ? '/usr/sbin/scutil' : 'scutil';
    const localName = execFileSync(scutil, ['--get', 'LocalHostName'], {
      encoding: 'utf8',
    }).trim();
    if (localName) {
      console.log(`[updates] по имени http://${localName.toLowerCase()}.local:${port}/`);
    }
  } catch {
    /* not macOS */
  }
  console.log('[updates] укажите этот адрес в настройках приложения');
});
