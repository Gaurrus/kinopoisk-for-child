import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEV_DIR = resolve('node_modules/electron/dist');
const PACKAGED_DIR = resolve('dist-app/win-unpacked');
const INSTALL_HINT =
  'Установи клиент EVS: py -3 -m pip install --upgrade castlabs-evs';

function resolveTarget() {
  const flagIndex = process.argv.indexOf('--target');
  const target = flagIndex === -1 ? 'auto' : process.argv[flagIndex + 1];
  if (target === 'dev') return DEV_DIR;
  if (target === 'packaged') return PACKAGED_DIR;
  return existsSync(PACKAGED_DIR) ? PACKAGED_DIR : DEV_DIR;
}

function findPython() {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ['python', 'py'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import castlabs_evs'], {
      stdio: 'ignore',
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

if (!existsSync(DEV_DIR) && !existsSync(PACKAGED_DIR)) {
  console.error('[evs] бинарник Electron не найден. Сначала выполни yarn install.');
  process.exit(1);
}

const python = findPython();
if (!python) {
  console.error(`[evs] не найден Python с модулем castlabs-evs.\n${INSTALL_HINT}`);
  process.exit(1);
}

const target = resolveTarget();
if (!existsSync(target)) {
  console.error(`[evs] каталог не найден: ${target}`);
  console.error('Сначала собери приложение: yarn build (dev) или yarn dist:win.');
  process.exit(1);
}

console.log(`[evs] VMP-подпись: ${target}`);
const result = spawnSync(
  python,
  ['-m', 'castlabs_evs.vmp', 'sign-pkg', target],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
