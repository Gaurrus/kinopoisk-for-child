import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const appCandidates = [
  path.join('dist-app', 'mac-arm64', 'Kinopoisk for child.app'),
  path.join('dist-app', 'mac', 'Kinopoisk for child.app'),
];
const appDir = appCandidates.find((candidate) => existsSync(candidate));

if (!appDir) {
  console.error('[mac-zip] приложение не найдено, сначала выполните yarn dist:mac');
  process.exit(1);
}

const output = path.join('dist-app', `Kinopoisk-for-child-${pkg.version}-mac.zip`);
execFileSync(
  'ditto',
  ['-c', '-k', '--sequesterRsrc', '--keepParent', appDir, output],
  { stdio: 'inherit' },
);
console.log(`[mac-zip] ${output}`);
