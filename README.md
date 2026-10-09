# Orle

Групповые привычки с геймификацией и честной проверкой. Друзья объединяются в группы, ставят себе измеримые привычки, отмечают выполнение с фото, проверяют друг друга и соревнуются за очки. Mobile-first PWA, интерфейс на русском (заложен i18n для казахского и английского).

> **Статус:** этап 1 из 7 — каркас, вход по email, онбординг, полная схема БД, RLS и тесты RLS.
> Полный README (деплой, подробности подсчёта очков, seed) появится к этапу 7.

## Стек

- Next.js 16 (App Router) + TypeScript strict, Tailwind CSS 4 + компоненты в стиле shadcn/ui
- Supabase: Auth (email OTP / magic link), Postgres + RLS, Storage, Realtime, pg_cron
- Zod, next-intl, Vitest (юнит + тесты БД), Playwright (e2e)

## Быстрый старт

Нужны Node ≥ 20.9, pnpm, Docker (для локального Supabase).

```bash
pnpm install
pnpm db:start             # поднимает Supabase локально и применяет миграции + seed
cp .env.example .env.local
# вставьте NEXT_PUBLIC_SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY из вывода db:start
pnpm dev                  # http://localhost:3000
```

Письма с кодом входа в локальной среде не уходят наружу — откройте Mailpit/Inbucket на http://localhost:54324.

### Переменные окружения

| Переменная | Где | Зачем |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | клиент + сервер | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | клиент + сервер | публичный ключ (все права ограничены RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | только сервер | обработка пруфов и cron; **никогда** не отдаётся клиенту |
| `NEXT_PUBLIC_SITE_URL` | клиент + сервер | ссылки в письмах |
| `TEST_DATABASE_URL`, `TEST_SUPABASE` | тесты | см. ниже |

## Тесты

```bash
pnpm test        # юнит-тесты + тесты БД (RLS, серверные функции)
pnpm test:e2e    # Playwright, мобильный viewport
pnpm lint && pnpm typecheck
```

**Тесты БД** не требуют Docker: им достаточно любого Postgres ≥ 15 с правами суперпользователя (`TEST_DATABASE_URL`, по умолчанию `postgres://postgres:postgres@127.0.0.1:5432/postgres`). Global setup создаёт БД `orle_test`, накатывает тонкий шим Supabase (`tests/db/supabase-shim.sql`: роли `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`) и все миграции. Чтобы гонять те же тесты против настоящего Supabase: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres TEST_SUPABASE=1 pnpm test`.

Каждый тест работает в транзакции с откатом и переключает роли (`db.as.user(id)`, `db.as.anon()`, `db.as.service()`). Время сервера фиксируется через `app_private.test_clock` — таблицу, недоступную клиентам.

## Как устроена честность (кратко)

**Полностью исключить обман в приложении для привычек невозможно.** Можно сфотографировать чужие отжимания или выбрать фото из галереи вместо камеры. Задача Orle — сделать обман неудобным, заметным и невыгодным:

1. **Клиент только читает.** У роли `authenticated` есть лишь `SELECT` (с RLS «только свои группы»). Любая запись идёт через `SECURITY DEFINER`-функции, которые проверяют права и инварианты.
2. **Очки — append-only журнал** `points_ledger`: клиенту запрещён `INSERT`, а `UPDATE`/`DELETE`/`TRUNCATE` блокирует триггер даже для суперпользователя. Уникальный `idempotency_key` не даёт крону начислить дважды. Журнал любого участника виден всей группе.
3. **Серверное время.** Дату и период отметки вычисляет `create_checkin()` по часовому поясу группы. Клиент может лишь попросить «вчера», и только в grace-окно после полуночи (по умолчанию 2 часа).
4. **Одна отметка на слот** — `unique (habit_id, period_start, slot)` и не больше одной действующей отметки привычки за сутки.
5. **Пруфы регистрирует только сервер** (`register_proof` доступна лишь `service_role`): EXIF и pHash считает Route Handler, повтор изображения и старые фото помечаются и попадают в аудит.
6. **Проверка группой:** за свою отметку голосовать нельзя; оспаривание требует комментария; вес подтверждений одного судьи одному автору убывает (1, ½, ⅓…) — против сговора.
7. **Rate limit** отметок с записью в `audit_log`.

Все коэффициенты очков и правила проверки — в одном файле [`config/scoring.ts`](config/scoring.ts). Тест `config-sync` падает, если SQL-дефолты с ним разошлись.

## Структура

```
config/scoring.ts          коэффициенты очков и правила (единый источник)
messages/ru.json           тексты интерфейса и коды ошибок
supabase/migrations/       схема, RLS, серверные функции
supabase/seed.sql          каталоги (персонажи/достижения), позже — демо-группа
src/app/                   страницы (App Router)
src/lib/supabase/          клиенты Supabase (браузер / сервер / proxy)
src/components/character.tsx  процедурный SVG-персонаж «орлёнок»
tests/db/                  тесты RLS и серверных функций
tests/unit/                юнит-тесты
e2e/                       Playwright
```
