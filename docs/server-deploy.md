# Сопровождение конвейера

Репозиторий: https://github.com/Classicart54/lexis-content-factory
Рабочая копия владельца: `/Users/romanrazumovich/Developer/lexis-content-pipeline`.

## Проверка каждый день

Подключение — отдельный SSH-ключ сотрудника; секреты не копировать из сервера в репозиторий.

```sh
ssh root@201.34.139.242
systemctl is-active lexis-content-pipeline.service cron
cat /opt/lexis-content-pipeline/REVISION
cat /etc/cron.d/lexis-content-pipeline-daily
cat /var/lib/lexis-content-pipeline/daily-report.json
tail -80 /var/log/lexis-content-pipeline-daily.log
```

Отчёт должен быть свежим после 05:00 UTC (08:00 МСК / 12:00 Новосибирск), `ok: true`, `published > 0`.
Работающий Telegram-бот сам по себе не доказывает работу генерации. Проверить публичный URL из отчёта: HTTP 200.
`running` после завершения процесса — зависшая запись; очередной прогон восстанавливает её в pending.
Ошибки API прекращают прогон, сохраняют тему для повторения и дают ненулевой код завершения.
Для незавершённой темы допускается не более одной попытки за один дневной запуск.

## Пути

- Код: `/opt/lexis-content-pipeline`, сборка `dist/`, идентификатор версии `REVISION`.
- Секреты: `/etc/lexis-content-pipeline.env`, права 600.
- Заявки, очередь и итог дня: `/var/lib/lexis-content-pipeline`.
- Опубликованные статьи: `/var/lib/lexis-content/guide` (вне каталога сайта).
- Фактура: `/opt/lexis-handoff-konveyer/fakty`.
- Бот: `lexis-content-pipeline.service`.
- Единственное расписание: `/etc/cron.d/lexis-content-pipeline-daily` из `ops/`.
- Старый `lexis-content-daily.timer` должен оставаться disabled/inactive.

## Проверки перед обновлением

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Не запускать локально бота с production-токеном: два polling-процесса конфликтуют.
Никаких mock-агентов в ежедневном production-запуске: runner требует API-ключ модели и токен публикации.

## Обновление (с разрешения владельца)

1. Сохранить код, env и обе папки данных в архив `/var/backups/lexis-content-pipeline/`, права 600.
2. Передать проверенные `src`, `docs`, `ops`, `AGENTS.md`, README, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .npmrc, tsconfig.json и локально собранный `dist`. Не передавать `.env`, `.git`, `node_modules`, `data*`, `out`.
3. В `REVISION` записать SHA переданного коммита. Сверить контрольные суммы исходников и сборки.
4. В env: `NEUROMEDIA_MODEL=gpt-5.6-terra`, `CONTENT_SCHEMA_VERSION=1` для текущего старого renderer сайта.
5. Установить cron из `ops/lexis-content-pipeline-daily`. `systemctl disable --now lexis-content-daily.timer`.
6. Перезапустить только `lexis-content-pipeline.service`.
7. Контрольный выпуск одной статьи с тем же flock, что использует cron:

```sh
flock -n /var/lock/lexis-content-pipeline-daily.lock bash -lc 'cd /opt/lexis-content-pipeline && set -a && . /etc/lexis-content-pipeline.env && set +a && node dist/core/run-daily-topics-local.js 1'
```

Успех — статья прошла проверки, записана в хранилище и её публичный URL открывается.
Не снимать блокировку со всех старых заявок: часть достигла лимита 20 ревизий и требует редакторского разбора.

## Совместимость статей

Renderer сайта пока не поддерживает example/expert/takeaways. В режиме `CONTENT_SCHEMA_VERSION=1` конвейер переводит их в prose/quote, сохраняя текст. Включать 2 только после обновления сайта.

Восстановление уже записанных несовместимых файлов (сначала архив):

```sh
CONTENT_DIR=/var/lib/lexis-content LANDING_SOURCE_DIR=/opt/lexis-landing node dist/core/repair-legacy-store.js
# После проверки dry run:
CONTENT_DIR=/var/lib/lexis-content LANDING_SOURCE_DIR=/opt/lexis-landing node dist/core/repair-legacy-store.js --apply
```

Скрипт применяет только преобразования, прошедшие валидатор установленного сайта. Даты/slug/источники не меняются.
