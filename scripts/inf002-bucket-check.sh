#!/usr/bin/env bash
# INF-002 runtime check against the LOCAL compose MinIO (never a real bucket). Needs `mc`, curl.
# Asserts: anonymous GET on ingest/private -> 403; rp-web cannot GET/HEAD ingest or PUT public; anonymous GET of a public object -> 200.
# Env: RP_WEB_KEY / RP_WEB_SECRET (the rp-web user created from infra/minio/policies/rp-web.json), ROOT_USER / ROOT_PASSWORD.
set -uo pipefail
EP="${S3_ENDPOINT:-http://127.0.0.1:9000}"; fail=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
: "${RP_WEB_KEY:?}" "${RP_WEB_SECRET:?}" "${ROOT_USER:?}" "${ROOT_PASSWORD:?}"
mc alias set rproot "$EP" "$ROOT_USER" "$ROOT_PASSWORD" >/dev/null && mc alias set rpweb "$EP" "$RP_WEB_KEY" "$RP_WEB_SECRET" >/dev/null || exit 2
echo hi | mc pipe rproot/rp-ingest/in/inf002 >/dev/null; echo hi | mc pipe rproot/rp-private/media/inf002 >/dev/null; echo hi | mc pipe rproot/rp-public/m/inf002 >/dev/null
[ "$(code "$EP/rp-ingest/in/inf002")" = 403 ] && ok "anonymous GET ingest 403" || bad "anonymous GET ingest"
[ "$(code "$EP/rp-private/media/inf002")" = 403 ] && ok "anonymous GET private 403" || bad "anonymous GET private"
[ "$(code "$EP/rp-public/m/inf002")" = 200 ] && ok "anonymous GET public 200" || bad "anonymous GET public"
mc cat rpweb/rp-ingest/in/inf002 >/dev/null 2>&1 && bad "rp-web GET ingest allowed" || ok "rp-web GET ingest denied"
mc stat rpweb/rp-ingest/in/inf002 >/dev/null 2>&1 && bad "rp-web HEAD ingest allowed" || ok "rp-web HEAD ingest denied"
echo x | mc pipe rpweb/rp-public/m/evil >/dev/null 2>&1 && bad "rp-web PUT public allowed" || ok "rp-web PUT public denied"
echo x | mc pipe rpweb/rp-ingest/in/inf002-put >/dev/null 2>&1 && ok "rp-web PUT ingest in/* allowed" || bad "rp-web PUT ingest"
mc rm rproot/rp-ingest/in/inf002 rproot/rp-ingest/in/inf002-put rproot/rp-private/media/inf002 rproot/rp-public/m/inf002 >/dev/null 2>&1
exit $fail
