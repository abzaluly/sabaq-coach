# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Orle** — group habit tracker with gamification and honest, group-verified check-ins. Next.js 16 (App Router, TS strict) + Supabase (Auth, Postgres + RLS, Storage, Realtime, pg_cron). UI language: Russian (next-intl; kk/en planned). See README.md for the full picture (scoring formula, anti-cheat layers, deploy).

> `backend/` and `frontend/` are the previous project (Sabaq study assistant) and are not part of Orle; they are excluded from lint/tsconfig and slated for removal.

## Commands

```bash
pnpm dev | build | lint | typecheck
pnpm test                 # Vitest: unit + DB tests (needs Postgres ≥15, TEST_DATABASE_URL, default postgres:postgres@127.0.0.1:5432)
pnpm test:e2e             # Playwright; E2E_BACKEND=1 for full flows against a running Supabase
pnpm stack:setup / stack:start / stack:stop   # Supabase without Docker (scripts/local-stack)
pnpm seed:demo            # demo group, 4 people, 3 weeks of history
pnpm load-test            # synthetic data + EXPLAIN ANALYZE of key queries
pnpm icons                # regenerate PWA icons from the SVG character
```

In cloud containers: start Postgres with `pg_ctlcluster 16 main start`; Chromium is at `/opt/pw-browsers/chromium` (`PLAYWRIGHT_CHROMIUM_PATH`).

## Architecture rules (keep them)

- **Clients only read.** `authenticated` has SELECT (RLS: own groups) plus writes to `notification_prefs`/`push_subscriptions`. Every other write goes through `SECURITY DEFINER` functions in `supabase/migrations/*` with `set search_path = ''`.
- **New RPC function** → add an explicit `grant execute … to authenticated` (or service_role) AND add it to the whitelist in `tests/db/grants.test.ts`.
- **New error code** raised via `app_private.raise_error('code')` → add to `RPC_ERROR_CODES` in `src/lib/rpc.ts` and `messages/ru.json` `errors.*` (unit test enforces).
- **Points** only via `app_private.credit()` into the append-only `points_ledger` with a unique idempotency key. Never UPDATE/DELETE the ledger.
- **Server time** is `app_private.now()` (tests freeze it via `app_private.test_clock`). Local dates use the group timezone.
- **Coefficients** live in `config/scoring.ts` and must match `app_private.default_scoring_config()/default_rules()` (config-sync test).
- Migrations are numbered `20261009000N00_*.sql`; add new ones rather than editing applied ones once deployed.
- UI: Tailwind tokens (`bg-surface`, `text-muted`, `bg-primary`…), mobile-first, tap targets ≥ 44px, all strings in `messages/ru.json`.
