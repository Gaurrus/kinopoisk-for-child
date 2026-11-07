# Kinopoisk for child

Desktop-приложение на Chromium (Electron) для Windows: открывает Kinopoisk HD,
запоминает вход между запусками и ограничивает количество серий, которое можно
посмотреть за один запуск.

## Что внутри

- **Chromium + Widevine** — сборка [castLabs Electron for Content Security](https://github.com/castlabs/electron-releases),
  потому что обычный Electron не умеет проигрывать DRM-видео Kinopoisk.
- **Постоянная сессия** — профиль `persist:kinopoisk`, вход выполняется один раз
  в окне приложения и сохраняется между запусками.
- **Лимит серий** — задаётся перед стартом (или по `Ctrl+Shift+L` во время просмотра).
  Счётчик живёт до закрытия приложения, повторный просмотр уже засчитанной серии
  лимит не тратит.
- **PIN** — необязательная защита настроек от детей. Если PIN задан, изменить
  лимит можно только после его ввода.
- По умолчанию открывается сериал **«Три кота»**.

## Требования

- Node.js 22+
- Yarn 1.22 (`npm i -g yarn`)
- Python 3.7+ — только для VMP-подписи (Widevine) на Windows
- Windows 10/11 x64 — для запуска и сборки установщика

## Разработка

```bash
yarn install
yarn evs:sign:dev   # VMP-подпись бинарника Electron (один раз, см. ниже)
yarn dev            # сборка + запуск с DevTools
yarn test           # юнит-тесты парсинга серий и лимитера
yarn typecheck
```

`yarn dev` собирает TypeScript в `dist/` и запускает Electron. VMP-подпись нужно
повторять после каждого `yarn install`, потому что npm заново распаковывает
бинарник Electron.

## Сборка установщика для Windows

Выполнять на Windows:

```bash
yarn install
$env:EVS_ACCOUNT_NAME="you@example.com"
$env:EVS_PASSWD="<пароль EVS>"
yarn dist:win
```

Готовый установщик появится в `dist-app/kinopoisk-for-child-0.1.0-setup.exe`.
Хук `afterPack` сам VMP-подпишет `dist-app/win-unpacked` перед сборкой NSIS,
если заданы `EVS_ACCOUNT_NAME`/`EVS_PASSWD`. Проверить подпись можно так:

```bash
py -3 -m castlabs_evs.vmp verify-pkg dist-app/win-unpacked
```

> Собирать Windows-установщик нужно на Windows: `electronDist` указывает на
> скачанный под текущую платформу бинарник castLabs.

## Widevine и VMP-подпись (обязательно для Windows)

Kinopoisk отдаёт DRM-лицензию только клиенту с **production VMP-подписью**.
castLabs-сборка поставляется с development-подписью, поэтому без шагов ниже
плеер показывает «Воспроизведение видео невозможно. Устройство не поддерживается».

1. Установить клиент EVS (сервис бесплатный):

   ```bash
   py -3 -m pip install --upgrade castlabs-evs
   ```

2. Создать аккаунт и подтвердить email (один раз):

   ```bash
   py -3 -m castlabs_evs.account signup
   ```

3. Подписать бинарник для разработки:

   ```bash
   yarn evs:sign:dev
   ```

4. Для сборки задать `EVS_ACCOUNT_NAME`/`EVS_PASSWD` (см. выше) либо запустить
   `yarn evs:sign:packaged` после `electron-builder --dir`.

Если EVS недоступен и `EVS_REQUIRED=1` не задан, сборка продолжится без подписи
с предупреждением. Для CI стоит выставлять `EVS_REQUIRED=1`, чтобы не выпустить
нерабочий установщик.

## Как работает лимит

1. При запуске открывается окно настроек: сколько серий разрешить (0 — без
   ограничений) и какую ссылку открыть.
2. После «Начать просмотр» открывается Kinopoisk. В правом верхнем углу виден
   счётчик «Осталось серий».
3. Серия засчитывается после 5 секунд воспроизведения. Уже засчитанную серию
   можно пересматривать без списания лимита.
4. При попытке включить серию сверх лимита видео ставится на паузу и появляется
   блокирующий экран.
5. `Ctrl+Shift+L` — настройки во время просмотра (если задан PIN — потребуется он).

Определение серии идёт по URL (`season/episode`, `content_id`), а если плеер не
меняет URL — по длительности видео. Реклама и трейлеры короче 60 секунд не
считаются.

## Известные ограничения

- **Widevine/VMP.** Нужна production VMP-подпись через EVS — см. раздел выше.
  Без неё Kinopoisk показывает «Устройство не поддерживается».
- Kinopoisk может показывать капчу при входе — она открывается в том же окне.
- **Вход через Google.** Google блокирует OAuth во встроенных браузерах, но
  оригинальный User-Agent Electron он принимает. Мы намеренно **не подменяем UA**:
  подмена ломает выдачу DRM-лицензии. Если Google всё же откажет, войдите в
  Яндекс ID по логину и паролю; пароль для аккаунта, созданного через Google,
  задаётся на `id.yandex.ru`.
- Приложение не обходит подписку и DRM: это просто обёртка над сайтом.
- PIN хранится в `settings.json` в открытом виде (userData). Это защита от
  ребёнка, а не от взрослого с доступом к файлам.

## Публикация в GitHub

Репозиторий: `Gaurrus/kinopoisk-for-child` (private).

```bash
git init -b main
git add .
git commit -m "feat: kinopoisk for child desktop app"
gh repo create Gaurrus/kinopoisk-for-child --private --source . --remote origin --push
```

Если `gh` не авторизован: `gh auth login`.
