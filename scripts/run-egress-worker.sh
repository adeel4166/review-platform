#!/usr/bin/env bash
# T-01: start the isolated verification-egress worker on the host with a SCRUBBED environment (env -i): only REDIS_URL and
# VERIFY_DNS_SERVERS (+ PATH/HOME for node). Deliberately does not load .env, so no DATABASE_URL/S3_*/SMTP_URL can leak in.
set -euo pipefail
cd "$(dirname "$0")/.."
# Local default uses the ACL-restricted user from infra/redis/users.acl; override with EGRESS_REDIS_URL.
exec env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
  WORKER_GROUPS=verification-egress \
  REDIS_URL="${EGRESS_REDIS_URL:-redis://verif-egress:egress_local_pw@127.0.0.1:6379}" \
  VERIFY_DNS_SERVERS="${VERIFY_DNS_SERVERS:-1.1.1.1,8.8.8.8}" \
  pnpm --filter @rp/worker exec tsx src/main.ts
