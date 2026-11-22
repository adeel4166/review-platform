#!/usr/bin/env bash
# LIVE-05: one-command staging on a Docker host (docker-compose.staging.yml). Run from a clean checkout:
#   MODERATION_PROVIDER=anthropic|gemini MODERATION_API_KEY=<from your secret store> scripts/staging-up.sh        # preflight, build, up, migrate, seed, smoke
#   scripts/staging-up.sh down | stop | reseed | smoke | logs [service] | status
# Secrets: generated once into $STAGING_ENV_FILE (default .env.staging, mode 600, gitignored). Only variable NAMES are ever printed.
# MODERATION_PROVIDER / MODERATION_API_KEY are never generated or written: export them (or put them in the env file yourself).
# STAGING_HOST (required; the server's PUBLIC IPv4, refused if unset/private/loopback except on CI): see docs/ops/vps-quickstart.md.
# Optional env names: STAGING_ENV_FILE, WEB_PORT (3000), MINIO_PORT (9000), STAGING_SEED_DEMO (1), SKIP_SMOKE (0),
#   STAGING_TLS (0; 1 = compose profile "tls": Caddy gives https://<ip-dashed>.sslip.io + https://s3.<ip-dashed>.sslip.io, needs ports 80+443).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
ENV_FILE="${STAGING_ENV_FILE:-.env.staging}"
DC=(docker compose -p rp-staging -f docker-compose.staging.yml --env-file "$ENV_FILE")
cmd="${1:-up}"; shift || true
# shellcheck source=scripts/vps-preflight.sh
. "$(dirname "$0")/vps-preflight.sh"

die() { echo "staging-up: $*" >&2; exit 1; }
# Value of NAME from the process env, else from the env file (strips one layer of quotes). Never echo the result.
getv() { local v="${!1:-}"; if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//')" || true; fi; printf '%s' "$v"; }
rnd() { openssl rand -base64 "${1:-32}" | tr -d '\n=+/' | cut -c1-"${2:-40}"; }
b64key() { openssl rand -base64 32 | tr -d '\n'; }
add() { # add NAME VALUE: append only when missing; report the NAME only
  grep -qE "^$1=" "$ENV_FILE" 2>/dev/null && return 0
  printf "%s='%s'\n" "$1" "$2" >> "$ENV_FILE"; echo "  generated $1"
}
need_docker() { command -v docker >/dev/null || die "docker not found"; docker compose version >/dev/null 2>&1 || die "docker compose v2 not found"; docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"; }
exp_env() { set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a; }
setv() { # setv NAME VALUE: replace (or append) a derived, non-secret setting; report the NAME only
  { grep -vE "^$1=" "$ENV_FILE" 2>/dev/null || true; } > "$ENV_FILE.tmp"; printf "%s='%s'\n" "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"; echo "  set $1"
}
dropv() { { grep -vE "^$1=" "$ENV_FILE" 2>/dev/null || true; } > "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"; }
# Optional TLS profile (Caddy). STAGING_TLS in the process env wins over the env file; default off. The profile must be active for down/stop/logs too.
tls="${STAGING_TLS:-$(getv STAGING_TLS)}"; [ "$tls" = 1 ] || tls=0
[ "$tls" = 1 ] && DC=(docker compose -p rp-staging -f docker-compose.staging.yml --profile tls --env-file "$ENV_FILE")

case "$cmd" in
  down)   need_docker; "${DC[@]}" down --remove-orphans; exit 0 ;;                 # keeps volumes (data survives)
  stop)   need_docker; "${DC[@]}" stop; exit 0 ;;
  status) need_docker; "${DC[@]}" ps; exit 0 ;;
  logs)   need_docker; exec "${DC[@]}" logs --tail=200 -f "$@" ;;
  reseed) need_docker; exp_env; "${DC[@]}" run --rm migrate; exit 0 ;;               # migrate deploy + idempotent demo seed
  smoke)  need_docker; exp_env; exec "${DC[@]}" exec -T -e DEMO_PASSWORD -e SMOKE_BASE_URL=http://127.0.0.1:3000 web node /app/scripts/staging-smoke.mjs ;;
  up) ;;
  *) die "unknown command '$cmd' (up|down|stop|reseed|smoke|logs|status)" ;;
esac

command -v openssl >/dev/null || die "openssl not found"

# 1. Preflight, fail closed (names only). Evaluated BEFORE anything is built or started.
mod="$(getv MODERATION_PROVIDER)"
[ -n "$mod" ] || die "MODERATION_PROVIDER is not set: refusing to start (set a real provider, e.g. anthropic)"
[ "$mod" != "mock" ] || die "MODERATION_PROVIDER=mock is refused on staging (real provider required)"
case "$mod" in anthropic|gemini) ;; *) die "MODERATION_PROVIDER has an unsupported value (supported: anthropic, gemini)" ;; esac
[ -n "$(getv MODERATION_API_KEY)" ] || die "MODERATION_API_KEY is not set: required for MODERATION_PROVIDER=$mod"

# Host checks (fail closed, names only): public STAGING_HOST, Docker + Compose v2, >= 4 GB RAM, free ports, user namespaces.
ports=("${WEB_PORT:-$(getv WEB_PORT)}" "${MINIO_PORT:-$(getv MINIO_PORT)}"); ports[0]="${ports[0]:-3000}"; ports[1]="${ports[1]:-9000}"; [ "$tls" = 1 ] && ports+=(80 443)
vps_preflight "$(getv STAGING_HOST)" "$tls" "${ports[@]}" || die "preflight found $PF_FAILS problem(s) (see above); nothing was started"
need_docker

# 2. Secrets + endpoints: generate anything missing (idempotent; existing values are never overwritten or printed).
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
echo "env file: $ENV_FILE (names of newly generated variables below)"
host="$(getv STAGING_HOST)"; add STAGING_HOST "$host"
add WEB_PORT "${WEB_PORT:-3000}"; add MINIO_PORT "${MINIO_PORT:-9000}"
prev_tls="$(grep -E '^STAGING_TLS=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "'\"" || true)"
if [ "$tls" = 1 ]; then
  dashed="${host//./-}"
  # Derived endpoints are always rewritten in TLS mode so APP_URL, S3_PUBLIC_ENDPOINT, MEDIA_PUBLIC_BASE_URL and MinIO CORS (APP_URL) agree.
  setv STAGING_TLS 1; setv TLS_APP_HOST "$dashed.sslip.io"; setv TLS_S3_HOST "s3.$dashed.sslip.io"
  setv APP_URL "https://$dashed.sslip.io"; setv S3_PUBLIC_ENDPOINT "https://s3.$dashed.sslip.io"; setv MEDIA_PUBLIC_BASE_URL "https://s3.$dashed.sslip.io/rp-public"
else
  if [ "$prev_tls" = 1 ]; then # switched back to plain HTTP: drop the TLS-derived values so they are regenerated below
    for n in STAGING_TLS TLS_APP_HOST TLS_S3_HOST APP_URL S3_PUBLIC_ENDPOINT MEDIA_PUBLIC_BASE_URL; do dropv "$n"; done
    echo "  TLS settings removed (plain HTTP mode)"
  fi
  add APP_URL "http://$host:$(getv WEB_PORT)"
  add S3_PUBLIC_ENDPOINT "http://$host:$(getv MINIO_PORT)"
  add MEDIA_PUBLIC_BASE_URL "http://$host:$(getv MINIO_PORT)/rp-public"
fi
for n in MYSQL_ROOT_PASSWORD MYSQL_APP_PASSWORD REDIS_DEFAULT_PASSWORD REDIS_VERIF_EGRESS_PASSWORD MINIO_ROOT_PASSWORD RP_CORE_SECRET RP_MEDIA_SECRET RP_WEB_SECRET \
         S3_LEDGER_SECRET_ACCESS_KEY S3_LEDGER_READ_SECRET_ACCESS_KEY S3_AUDIT_ARCHIVE_SECRET_ACCESS_KEY; do add "$n" "$(rnd 48 40)"; done
add MINIO_ROOT_USER rpminioroot
for p in RP_CORE_KEY:rpcore RP_MEDIA_KEY:rpmedia RP_WEB_KEY:rpweb S3_LEDGER_ACCESS_KEY_ID:rpledgerw S3_LEDGER_READ_ACCESS_KEY_ID:rpledgerr S3_AUDIT_ARCHIVE_ACCESS_KEY_ID:rpauditw; do add "${p%%:*}" "${p##*:}"; done
add IP_HASH_KEY "$(rnd 48 48)"; add AUTH_SECRET "$(b64key)"
add TOTP_ENC_ACTIVE_KEY_ID s1; add TOTP_ENC_KEYS "{\"s1\":\"$(b64key)\"}"
add RECOVERY_CODE_ACTIVE_KEY_ID s1; add RECOVERY_CODE_PEPPERS "{\"s1\":\"$(b64key)\"}"
add DEMO_PASSWORD "$(rnd 48 20)" # shared password of the six demo role accounts: read it from the env file, it is never printed
add STAGING_SEED_DEMO "${STAGING_SEED_DEMO:-1}"
dp="$(getv DEMO_PASSWORD)"; [ "${#dp}" -ge 12 ] || die "DEMO_PASSWORD must be at least 12 characters"; unset dp

# Anything exported in the shell (incl. MODERATION_*) wins over the env file for compose substitution.
export MODERATION_PROVIDER="$mod" MODERATION_API_KEY="$(getv MODERATION_API_KEY)"
exp_env; export MODERATION_PROVIDER="$mod" MODERATION_API_KEY="$(getv MODERATION_API_KEY)"
"${DC[@]}" config -q || die "compose config is invalid (a required variable name is missing)"

# 3. Build + start. `migrate` (prisma migrate deploy + pnpm db:seed:demo) is a one-shot the web and workers wait for.
"${DC[@]}" up -d --build

# 4. Wait for the single public URL; fail fast if the one-shot jobs or a fail-closed worker died.
port="$(getv WEB_PORT)"; echo "waiting for http://127.0.0.1:$port/api/health ..."
for i in $(seq 1 180); do
  curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null && break
  for s in migrate minio-init; do
    cid="$("${DC[@]}" ps -a -q "$s" 2>/dev/null || true)"; [ -n "$cid" ] || continue
    st="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$cid")"
    case "$st" in "exited 0"|running|created) ;; exited*) "${DC[@]}" logs --tail=40 "$s" >&2; die "$s failed ($st)" ;; esac
  done
  [ "$i" -lt 180 ] || { "${DC[@]}" ps >&2; die "web did not become healthy in 15 min (try: scripts/staging-up.sh logs web)"; }
  sleep 5
done
echo "staging is up: $(getv APP_URL)  (mail sink UI: http://127.0.0.1:${MAILPIT_UI_PORT:-8025})"
"${DC[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}'

# 5. Smoke (home, product page, login, admin login, review -> moderation queue) from inside the web container, plus the published port.
[ "${SKIP_SMOKE:-0}" = 1 ] && { echo "smoke skipped (SKIP_SMOKE=1)"; exit 0; }
curl -fsS -o /dev/null "http://127.0.0.1:$port/" || die "published port $port does not serve /"
"$0" smoke | tee .staging-smoke.txt
