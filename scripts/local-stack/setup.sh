#!/usr/bin/env bash
# Локальный стек Supabase без Docker: Postgres (ваш) + GoTrue + PostgREST + мини-шлюз.
# Нужен, если `supabase start` недоступен (нет Docker). Основной путь — `pnpm db:start`.
#
#   PGURL=postgres://postgres:postgres@127.0.0.1:5432/postgres scripts/local-stack/setup.sh
#
# Создаёт БД orle_dev, роли Supabase, применяет миграции GoTrue и Orle, пишет .env.local.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/.local-stack"
BIN="$STACK/bin"
PGURL="${PGURL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
DB="${LOCAL_DB:-orle_dev}"
DBURL="${PGURL%/*}/$DB"
HOSTPORT="${PGURL#*@}"; HOSTPORT="${HOSTPORT%%/*}"
AUTHURL="postgres://supabase_auth_admin:${LOCAL_ROLE_PASSWORD:-postgres}@$HOSTPORT/$DB"
RESTURL="postgres://authenticator:${LOCAL_ROLE_PASSWORD:-postgres}@$HOSTPORT/$DB"
JWT_SECRET="${JWT_SECRET:-local-dev-jwt-secret-at-least-32-characters}"
PW="${LOCAL_ROLE_PASSWORD:-postgres}"
PGREST_VERSION=v12.2.3
AUTH_VERSION=v2.177.0

mkdir -p "$BIN" "$STACK/logs"

if [[ ! -x "$BIN/postgrest" ]]; then
  echo "→ downloading PostgREST $PGREST_VERSION"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$PGREST_VERSION/postgrest-$PGREST_VERSION-linux-static-x64.tar.xz" | tar xJ -C "$BIN"
fi
if [[ ! -x "$BIN/auth" ]]; then
  echo "→ downloading Supabase Auth (GoTrue) $AUTH_VERSION"
  curl -sSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar xz -C "$BIN"
fi

echo "→ recreating database $DB"
psql "$PGURL" -v ON_ERROR_STOP=1 -q <<SQL
drop database if exists $DB with (force);
create database $DB;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password '$PW'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login createrole password '$PW'; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
SQL

psql "$DBURL" -v ON_ERROR_STOP=1 -q <<SQL
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant create on database $DB to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
SQL

echo "→ GoTrue migrations"
(
  cd "$BIN"
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="$AUTHURL" \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_SITE_URL=http://localhost:3000 API_EXTERNAL_URL=http://localhost:54321/auth/v1 \
  ./auth migrate > "$STACK/logs/auth-migrate.log" 2>&1
)
psql "$DBURL" -q -c "grant execute on all functions in schema auth to anon, authenticated, service_role; grant select on auth.users to service_role;"

echo "→ Orle migrations + seed"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$DBURL" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done
psql "$DBURL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql" > /dev/null

eval "$(node "$ROOT/scripts/local-stack/jwt.mjs" "$JWT_SECRET")"
SMS_HOOK_SECRET="v1,whsec_$(node -e 'process.stdout.write(Buffer.from("local-sms-hook-secret-0123456789").toString("base64"))')"
cat > "$STACK/env" <<ENV
JWT_SECRET=$JWT_SECRET
DBURL=$DBURL
AUTHURL=$AUTHURL
RESTURL=$RESTURL
ANON_KEY=$ANON_KEY
SERVICE_KEY=$SERVICE_KEY
SMS_HOOK_SECRET='$SMS_HOOK_SECRET'
ENV

# .env.local: дописываем только отсутствующие переменные (свои значения не трогаем).
VAPID="$(node -e 'const w=require("web-push");const k=w.generateVAPIDKeys();console.log(k.publicKey+" "+k.privateKey)')"
add_env() { grep -q "^$1=" "$ROOT/.env.local" 2>/dev/null || echo "$1=$2" >> "$ROOT/.env.local"; }
add_env NEXT_PUBLIC_SUPABASE_URL http://127.0.0.1:54321
add_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON_KEY"
add_env SUPABASE_SERVICE_ROLE_KEY "$SERVICE_KEY"
add_env NEXT_PUBLIC_SITE_URL http://localhost:3000
add_env CRON_SECRET local-cron-secret
add_env NEXT_PUBLIC_SMS_ENABLED true
add_env SMS_PROVIDER dev
add_env SMS_DEV_DIR "$STACK/sms"
add_env SEND_SMS_HOOK_SECRET "$SMS_HOOK_SECRET"
add_env EMAIL_DEV_DIR "$STACK/email"
add_env NEXT_PUBLIC_VAPID_PUBLIC_KEY "${VAPID% *}"
add_env VAPID_PRIVATE_KEY "${VAPID#* }"
add_env VAPID_SUBJECT mailto:dev@orle.local
echo "✓ done. Start with: scripts/local-stack/start.sh"
