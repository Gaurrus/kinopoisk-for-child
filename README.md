# Kinopoisk for child

Приложение для Windows: открывает Kinopoisk HD в **системном Chrome/Edge**
(режим `--app`, отдельный профиль) и ограничивает количество серий, которое можно
посмотреть за один запуск.

Electron используется только для окна настроек. Плеер работает в настоящем
браузере, поэтому Widevine/DRM функционирует без VMP-подписи.

## Что внутри

- **Системный Chrome/Edge** — production-подписанный браузер, DRM работает
  «из коробки». Запускается с `--user-data-dir=<userData>/browser-profile`,
  поэтому вход сохраняется между запусками и не смешивается с обычным профилем.
- **Лимит серий** — скрипт-страж внедряется в страницу через CDP
  (`--remote-debugging-port` + `Runtime.addBinding`): счётчик, автозакрытие окна
  после исчерпания лимита, повторный просмотр не тратит лимит.
- **Автопродолжение** — после загрузки страницы приложение само нажимает
  «Продолжить просмотр».
- По умолчанию открывается сериал **«Три кота»**.
- **Fallback на Electron** — если Chrome/Edge не найден, откроется встроенный
  плеер (castLabs ECS). Для production-DRM в нём нужна EVS-подпись, см. ниже.

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

## Как это работает

1. При запуске открывается окно настроек: сколько серий разрешить (0 — без
   ограничений) и что смотреть — «Три кота» или «Машины-помощники». Кнопка
   мультфильма сразу запускает просмотр.
2. Приложение запускает Chrome/Edge:
   `--app=<url>`, отдельный профиль, `--remote-debugging-port=0`.
3. Через CDP в страницу внедряется `dist/browser/guard.js`, счётчик появляется
   в правом верхнем углу, а кнопка «Продолжить просмотр» нажимается автоматически.
4. Серия засчитывается после 5 секунд воспроизведения. Уже засчитанную серию
   можно пересматривать без списания лимита.
5. Когда заканчивается последняя разрешённая серия или ребёнок пытается включить
   следующую сверх лимита, окно браузера закрывается автоматически.
6. `Ctrl+Shift+L` на странице Kinopoisk — настройки. Закрытие окна браузера
   завершает приложение.

Вход считается выполненным: сессия хранится в профиле браузера и сохраняется
между запусками. Кнопка «Выйти из аккаунта» очищает cookies этого профиля.

## Сборка установщика для Windows

Выполнять на Windows:

```bash
yarn install
yarn dist:win
```

Готовый установщик появится в `dist-app/kinopoisk-for-child-<version>-setup.exe`.
VMP/EVS для основного режима **не нужны**.

> Собирать Windows-установщик нужно на Windows: `electronDist` указывает на
> скачанный под текущую платформу бинарник castLabs.

## Сборка для macOS

```bash
yarn install
yarn dist:mac
```

Готовое приложение: `dist-app/mac-arm64/Kinopoisk for child.app` (на Intel —
`dist-app/mac/Kinopoisk for child.app`). Установка:

```bash
ditto "dist-app/mac-arm64/Kinopoisk for child.app" "/Applications/Kinopoisk for child.app"
```

Приложение не подписано — при первом запуске macOS может попросить подтвердить
открытие. Для плеера нужен установленный Google Chrome (или Edge).

## Переменные окружения

- `KP_BROWSER_PATH` — явный путь к `chrome.exe`/`msedge.exe`.
- `KP_NO_CDP=1` — диагностический режим: обычное окно Chrome без remote debugging
  и без лимита. Нужен, если требуется войти в аккаунт заново (Google не пускает
  вход в управляемое окно). Войдите, закройте окно и запустите приложение обычно.
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

## Обновления по локальной сети

На Mac (сервер обновлений):

```bash
yarn serve:updates
```

Скрипт раздаёт `dist-app` на порту 8080, генерирует `version.json` и печатает
адреса вида `http://192.168.1.10:8080/`.

Адрес сервера по имени — `http://<LocalHostName>.local:8080/`. Локальное имя
Mac можно узнать так:

```bash
scutil --get LocalHostName
```

Например, для `MacBook-Air-Igor` адрес будет
`http://macbook-air-igor.local:8080/`. Этот адрес прописан в приложении по
умолчанию; отдельного поля в настройках нет (на самом Mac работает и
`http://127.0.0.1:8080/`).

Скачать вручную из браузера:

- Windows: `http://macbook-air-igor.local:8080/latest.exe`
- macOS: `http://macbook-air-igor.local:8080/latest-mac.zip`

Ссылки `latest.*` всегда отдают текущую версию; прямые ссылки с номером версии
тоже доступны (см. `version.json`). Windows 10+ резолвит `.local` через mDNS.
Если в сети multicast закрыт, установите Bonjour или используйте IP-адрес Mac.

При запуске приложение проверяет обновления:

- **Windows** — через `latest.yml` и `electron-updater`: предлагает скачать и
  установить новую версию. Установщик не подписан, поэтому SmartScreen может
  попросить подтверждение.
- **macOS** — через `version.json`: предлагает скачать zip и заменить
  приложение вручную. Настоящее автообновление Squirrel.Mac требует подписи
  Apple Developer, поэтому для неподписанной сборки недоступно.

Для macOS-обновления соберите zip:

```bash
yarn dist:mac
yarn pack:mac:zip
```

### Автозапуск сервера на macOS

Сервер поставлен в LaunchAgent и стартует при входе пользователя:

```
~/Library/LaunchAgents/local.kinopoisk.update-server.plist
```

При падении launchd перезапускает его (`KeepAlive`). Лог:
`~/Library/Logs/kinopoisk-update-server.log`.

Процесс называется **`Kinopoisk for child server`** (это копия Node в
`~/Library/Application Support/Kinopoisk for child/server/`), поэтому в
Activity Monitor видно понятное имя, а не просто `node`.

Остановить и удалить автозапуск:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.kinopoisk.update-server.plist
rm ~/Library/LaunchAgents/local.kinopoisk.update-server.plist
```

LaunchAgent запускается после входа в систему. Если сервер нужен до входа
(до логина), потребуется LaunchDaemon в `/Library/LaunchDaemons` с правами root.

Сервер и обновления работают по HTTP в локальной сети; используйте доверенную
сеть. Сервер должен быть запущен, порт 8080 — доступен.

## Известные ограничения

- Ребёнок может закрыть окно браузера и открыть Kinopoisk в обычном браузере —
  как и закрыть само приложение. Это ограничение любого внешнего лаунчера.
- В окне Chrome/Edge доступны DevTools (`F12`); для надёжной защиты нужны
  политики Windows (DeveloperToolsAvailability) или расширение.
- Профиль браузера хранится в `userData/browser-profile`.
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
