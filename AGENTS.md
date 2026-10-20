# Lexis Content Factory

Конвейер статей для lexisvoice.ru: Telegram-бот, генерация, проверки и публикация.

- Пакетный менеджер: pnpm 9.15.9 (Corepack). `pnpm install --frozen-lockfile`.
- Проверки: `pnpm typecheck`, `pnpm test`, `pnpm build`. Новые тесты обязательны для обработки сбоев/публикации.
- Модель по умолчанию: `gpt-5.6-terra`, Neuromedia OpenAI-compatible API.
- Прод: `root@201.34.139.242`, код `/opt/lexis-content-pipeline`.
- Данные `/var/lib/lexis-content-pipeline`; статьи `/var/lib/lexis-content`.
- Секреты `/etc/lexis-content-pipeline.env`: не выводить и не коммитить.
- Telegram-процесс `lexis-content-pipeline.service` сам не запускает ежедневную генерацию.
- Единственное расписание: `/etc/cron.d/lexis-content-pipeline-daily`, 05:00 UTC (08:00 МСК).
- Старый `lexis-content-daily.timer` отключён: его run-daily.js больше не существует.
- Логи cron: `/var/log/lexis-content-pipeline-daily.log`; итог прогона: `/var/lib/lexis-content-pipeline/daily-report.json`.
- Состояние бота: `systemctl status lexis-content-pipeline.service`; лог: `journalctl -u lexis-content-pipeline.service -n 50 --no-pager`.
- Запись статьи успешна только если её публичный URL отдаёт HTTP 200.
- `CONTENT_SCHEMA_VERSION=1` адаптирует example/takeaways/expert к старому renderer сайта без удаления текста. Не включать v2, пока сайт не поддерживает эти блоки.
- Не обходить проверки качества, не сбрасывать лимит ревизий массово, не удалять статьи/очередь.
- Перед обновлением сохранить код, env и обе папки данных в `/var/backups/lexis-content-pipeline` (архив с env должен иметь права 600).
- Commit/push/deploy только по просьбе владельца. Чужие незакоммиченные изменения не откатывать.
- Изменения конвейера не требуют деплоя SaaS/meet/landing. Не публиковать чужой WIP из monorepo.

Полная инструкция: docs/server-deploy.md. История ремонта: docs/repair-2026-10-20.md.
