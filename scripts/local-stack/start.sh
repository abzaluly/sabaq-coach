#!/usr/bin/env bash
# Запускает GoTrue, PostgREST, хранилище, SMTP-ловушку и шлюз в фоне.
# Логи: .local-stack/logs/*.log. Остановка: scripts/local-stack/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/.local-stack"
BIN="$STACK/bin"
# shellcheck disable=SC1091
source "$STACK/env"
LOGS="$STACK/logs"
mkdir -p "$LOGS"

start() {
  local name=$1; shift
  nohup "$@" > "$LOGS/$name.log" 2>&1 &
  echo $! > "$STACK/$name.pid"
  echo "→ $name (pid $!)"
}

MAIL_DIR="$STACK/mail" TEMPLATES_DIR="$ROOT/supabase/templates" start mail node "$ROOT/scripts/local-stack/smtp-sink.mjs"

cd "$BIN"
GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
GOTRUE_DB_DRIVER=postgres DATABASE_URL="$AUTHURL" \
GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" \
GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false \
GOTRUE_MAILER_OTP_EXP=600 GOTRUE_MAILER_OTP_LENGTH=6 \
GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=noreply@orle.local GOTRUE_SMTP_SENDER_NAME=Orle \
GOTRUE_SMTP_MAX_FREQUENCY=1s GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_VERIFY=1000 GOTRUE_RATE_LIMIT_OTP=1000 \
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="http://127.0.0.1:54324/templates/magic_link.html" \
GOTRUE_MAILER_TEMPLATES_CONFIRMATION="http://127.0.0.1:54324/templates/magic_link.html" \
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK="Ваш код для входа в Orle" GOTRUE_MAILER_SUBJECTS_CONFIRMATION="Ваш код для входа в Orle" \
GOTRUE_EXTERNAL_PHONE_ENABLED=true GOTRUE_SMS_AUTOCONFIRM=false GOTRUE_SMS_OTP_EXP=600 GOTRUE_SMS_OTP_LENGTH=6 \
GOTRUE_SMS_PROVIDER=twilio GOTRUE_SMS_TWILIO_ACCOUNT_SID=unused GOTRUE_SMS_TWILIO_AUTH_TOKEN=unused GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID=unused \
GOTRUE_HOOK_SEND_SMS_ENABLED=true GOTRUE_HOOK_SEND_SMS_URI=http://localhost:3000/api/auth/sms-hook GOTRUE_HOOK_SEND_SMS_SECRETS="$SMS_HOOK_SECRET" \
GOTRUE_SMS_MAX_FREQUENCY=1s \
GOTRUE_LOG_LEVEL=warn \
  start auth ./auth serve

PGRST_DB_URI="$RESTURL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" PGRST_SERVER_PORT=3001 PGRST_DB_MAX_ROWS=1000 \
  start rest ./postgrest

cd "$ROOT"
STORAGE_DIR="$STACK/storage" JWT_SECRET="$JWT_SECRET" start storage node "$ROOT/scripts/local-stack/storage.mjs"
start gateway node "$ROOT/scripts/local-stack/gateway.mjs"
sleep 2
curl -sf http://127.0.0.1:54321/auth/v1/health > /dev/null && echo "✓ auth ok" || { echo "✗ auth failed, see $LOGS/auth.log"; exit 1; }
curl -sf -H "apikey: $ANON_KEY" http://127.0.0.1:54321/rest/v1/achievements > /dev/null && echo "✓ rest ok" || { echo "✗ rest failed, see $LOGS/rest.log"; exit 1; }
