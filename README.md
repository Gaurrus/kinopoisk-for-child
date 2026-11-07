# Kinopoisk for child

Приложение для Windows: открывает Kinopoisk HD в **системном Chrome/Edge**
(режим `--app`, отдельный профиль), запоминает вход и ограничивает количество
серий, которое можно посмотреть за один запуск.

Electron используется только для окна настроек и управления — сам плеер работает
в настоящем браузере, поэтому Widevine/DRM функционирует без VMP-подписи.

## Что внутри

- **Системный Chrome/Edge** — production-подписанный браузер, DRM работает
  «из коробки». Запускается с `--user-data-dir=<userData>/browser-profile`,
  поэтому вход сохраняется между запусками и не смешивается с обычным профилем.
- **Лимит серий** — скрипт-страж внедряется в страницу через CDP
  (`--remote-debugging-port` + `Runtime.addBinding`). Логика та же, что раньше:
  счётчик, блокирующий экран, повторный просмотр не тратит лимит.
- **PIN** — необязательная защита настроек от детей.
- По умолчанию открывается сериал **«Три кота»**.
- **Fallback на Electron** — если Chrome/Edge не найден, приложение откроет
  встроенный плеер (castLabs ECS). Для production-DRM в нём нужна EVS-подпись,
  см. раздел ниже.

## Требования

- Windows 10/11 x64
- Установленный **Google Chrome** или **Microsoft Edge** (Edge есть в Windows
  по умолчанию)
- Node.js 22+ и Yarn 1.22 (`npm i -g yarn`) — для сборки
- Python 3.7+ — только для необязательного fallback с EVS

## Разработка

```bash
yarn install
yarn dev        # сборка + запуск
yarn test       # юнит-тесты парсинга серий и лимитера
yarn typecheck
```

`yarn dev` собирает TypeScript в `dist/`, бандлит страж через esbuild и запускает
Electron-окно настроек. При старте просмотра открывается системный браузер.

## Как это работает

1. При запуске открывается окно настроек: сколько серий разрешить (0 — без
   ограничений) и какую ссылку открыть.
2. После «Начать просмотр» приложение находит Chrome/Edge и запускает его:
   `--app=<url>`, отдельный профиль, `--remote-debugging-port=0`.
3. Через CDP в страницу внедряется `dist/browser/guard.js`. В правом верхнем углу
   появляется счётчик «Осталось серий».
4. Серия засчитывается после 5 секунд воспроизведения. Уже засчитанную серию
   можно пересматривать без списания лимита.
5. При попытке включить серию сверх лимита видео ставится на паузу и появляется
   блокирующий экран.
6. `Ctrl+Shift+L` на странице Kinopoisk — настройки (если задан PIN — потребуется
   он). Закрытие окна браузера завершает приложение.

Вход в аккаунт выполняется в том же окне браузера (Google/Яндекс) и сохраняется
в отдельном профиле. Кнопка «Выйти из аккаунта» очищает cookies этого профиля.

## Сборка установщика для Windows

Выполнять на Windows:

```bash
yarn install
yarn dist:win
```

Готовый установщик появится в `dist-app/kinopoisk-for-child-0.1.0-setup.exe`.
VMP/EVS для основного режима **не нужны**.

> Собирать Windows-установщик нужно на Windows: `electronDist` указывает на
> скачанный под текущую платформу бинарник castLabs.

## Переменные окружения

- `KP_BROWSER_PATH` — явный путь к `chrome.exe`/`msedge.exe`.
- `KP_NO_CDP=1` — режим входа: открывает обычное окно Chrome без remote debugging
  и без лимита. Нужен, если Google не пускает в управляемое окно.
- `KP_PLAYER=electron` — принудительно использовать встроенный Electron-плеер
  (fallback).
- `EVS_ACCOUNT_NAME` / `EVS_PASSWD` / `EVS_SIGN=1` / `EVS_REQUIRED=1` — только
  для VMP-подписи fallback-сборки.

## Widevine/VMP для fallback (необязательно)

Нужно только если используется `KP_PLAYER=electron` и хочется DRM во встроенном
плеере. Production-сервер Kinopoisk принимает только VMP-подпись:

```bash
py -3 -m pip install --upgrade castlabs-evs
py -3 -m castlabs_evs.account signup     # бесплатно, подтвердить email
yarn evs:sign:dev                        # подписать node_modules/electron/dist
py -3 -m castlabs_evs.vmp verify-pkg node_modules/electron/dist

# для установщика
$env:EVS_ACCOUNT_NAME="you@example.com"; $env:EVS_PASSWD="пароль"; yarn dist:win
py -3 -m castlabs_evs.vmp verify-pkg dist-app/win-unpacked
```

`yarn install` заново распаковывает Electron и стирает подпись — после него
`evs:sign:dev` нужно повторить.

## Диагностика

`drm.log` в `%APPDATA%\Kinopoisk for child\` относится к встроенному
Electron-fallback. В основном режиме DRM обслуживает Chrome/Edge, и лог не нужен.
Кнопка «Открыть папку с логами» есть в окне настроек.

## Если Google пишет «браузер не безопасен»

1. Закрой все окна приложения и Chrome с профилем приложения.
2. Запусти режим входа (обычное окно, без CDP):
   ```powershell
   $env:KP_NO_CDP="1"; yarn dev
   ```
3. Войди в Kinopoisk через Google и закрой окно.
4. Запусти приложение обычным способом — профиль уже авторизован:
   ```powershell
   Remove-Item Env:KP_NO_CDP
   yarn dev
   ```

Сессия хранится в общем профиле, поэтому повторять вход не нужно.

## Известные ограничения

- Ребёнок может закрыть окно браузера и открыть Kinopoisk в обычном браузере —
  как и закрыть само приложение. Это ограничение любого внешнего лаунчера.
- В окне Chrome/Edge доступны DevTools (`F12`); для надёжной защиты нужны
  политики Windows (DeveloperToolsAvailability) или расширение с PIN.
- Профиль браузера хранится в `userData/browser-profile`; PIN — в
  `settings.json` в открытом виде (защита от ребёнка, не от взрослого).
- Приложение не обходит подписку и DRM.

## Публикация в GitHub

Репозиторий: `Gaurrus/kinopoisk-for-child` (private).

```bash
git init -b main
git add .
git commit -m "feat: kinopoisk for child desktop app"
gh repo create Gaurrus/kinopoisk-for-child --private --source . --remote origin --push
```

Если `gh` не авторизован: `gh auth login`.
