'use strict';

const { spawnSync } = require('node:child_process');

const INSTALL_HINT =
  'Установи клиент EVS: py -3 -m pip install --upgrade castlabs-evs';

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

function fail(message) {
  if (process.env.EVS_REQUIRED === '1') throw new Error(message);
  console.warn(message);
}

/**
 * VMP-sign the packed Windows app before electron-builder creates the
 * installer. The prebuilt castLabs binaries only carry a *development*
 * signature, which production license servers (Kinopoisk) reject.
 *
 * Enable with EVS_ACCOUNT_NAME + EVS_PASSWD (see README), or EVS_SIGN=1 for
 * an interactive run. Set EVS_REQUIRED=1 to fail the build on errors.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (process.env.EVS_SKIP === '1') {
    console.log('[evs] пропущено (EVS_SKIP=1)');
    return;
  }

  const hasCredentials = Boolean(
    process.env.EVS_ACCOUNT_NAME && process.env.EVS_PASSWD,
  );
  if (!hasCredentials && process.env.EVS_SIGN !== '1') {
    console.log(
      '[evs] VMP-подпись не запрошена (для режима системного браузера не нужна)',
    );
    return;
  }

  const python = findPython();
  if (!python) {
    fail(`[evs] не найден Python с модулем castlabs-evs.\n${INSTALL_HINT}`);
    return;
  }

  const result = spawnSync(
    python,
    ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir],
    { stdio: 'inherit', env: process.env },
  );

  if (!result.error && result.status === 0) {
    console.log(`[evs] VMP-подпись применена: ${context.appOutDir}`);
    return;
  }

  fail(
    [
      '[evs] не удалось подписать приложение.',
      INSTALL_HINT,
      'Проверь EVS_ACCOUNT_NAME / EVS_PASSWD и выполни reauth при необходимости.',
      'Без подписи Kinopoisk покажет «Устройство не поддерживается».',
    ].join('\n'),
  );
};
