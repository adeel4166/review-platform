#!/usr/bin/env bash
# LIVE-05: static checks of docker-compose.staging.yml + scripts/staging-up.sh (no docker, no secrets read).
set -euo pipefail
cd "$(dirname "$0")/.."
F=docker-compose.staging.yml; fail=0
chk() { if ! grep -Eq -e "$2" "$3"; then echo "FAIL: $1"; fail=1; else echo "ok:   $1"; fi; }
for s in mysql redis minio minio-init clamav migrate web worker-core worker-media verification-egress; do chk "service $s present" "^  $s:" $F; done
chk "redis ACL + noeviction" '--aclfile /tmp/users.acl' $F
chk "ledger + audit archive buckets object-locked" 'mc mb -p --with-lock local/rp-ledger local/rp-audit-archive' $F
chk "migrate runs prisma migrate deploy" 'pnpm --filter @rp/db migrate:deploy' $F
chk "migrate runs db:seed:demo" 'pnpm db:seed:demo' $F
chk "demo seed runs outside NODE_ENV=production" 'NODE_ENV: development' $F
chk "web waits for migrate" 'migrate: \{ condition: service_completed_successfully \}' $F
chk "web is the one published app port" 'ports: \["\$\{WEB_PORT:-3000\}:3000"\]' $F
chk "core worker requires MODERATION_PROVIDER (compose :?)" 'MODERATION_PROVIDER: \$\{MODERATION_PROVIDER:\?\}' $F
chk "core worker requires MODERATION_API_KEY" 'MODERATION_API_KEY: \$\{MODERATION_API_KEY:\?\}' $F
chk "media worker requires the sandbox" 'MEDIA_SANDBOX_REQUIRED: "true"' $F
chk "egress worker holds only the egress ACL user" 'redis://verif-egress:' $F
chk "MinIO CORS pinned to APP_URL" 'MINIO_API_CORS_ALLOW_ORIGIN: \$\{APP_URL:\?\}' $F
chk "web image runs non-root + next start" '^USER rpweb' infra/docker/web.Dockerfile
chk "preflight refuses mock provider" 'MODERATION_PROVIDER=mock is refused' scripts/staging-up.sh
chk "preflight refuses unset provider" 'MODERATION_PROVIDER is not set: refusing to start' scripts/staging-up.sh
chk "env file is mode 600" 'chmod 600' scripts/staging-up.sh
chk "env example names DEMO_PASSWORD" '^DEMO_PASSWORD=' .env.staging.example
if grep -Eq '(PASSWORD|SECRET|API_KEY|_KEY): [^$"]' $F; then echo "FAIL: literal secret value in $F"; fail=1; else echo "ok:   no literal secrets in $F"; fi
# staging-up.sh must never echo a secret value: only `add` (prints NAME) and die messages (static text) may print.
if grep -nE 'echo[^|]*getv (DEMO_PASSWORD|MODERATION_API_KEY|AUTH_SECRET)|echo[^|]*\$\{?(DEMO_PASSWORD|MODERATION_API_KEY|AUTH_SECRET)' scripts/staging-up.sh; then echo "FAIL: staging-up.sh echoes a secret"; fail=1; else echo "ok:   staging-up.sh prints no secret values"; fi
exit $fail
