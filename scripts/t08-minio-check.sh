#!/usr/bin/env bash
# T-08 runtime check (m3b gate report §5.3) against the LOCAL compose MinIO. Never point at a real bucket.
# Prereq: `pnpm install` and `pnpm infra:up` (MinIO + minio-init). Needs docker, curl, node.
# Exit 0 = all pass. PUT-after-confirm is recorded (printed), not pass/fail.
set -uo pipefail
cd "$(dirname "$0")/.."

ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
BUCKET="${S3_BUCKET_INGEST:-rp-ingest}"
AK="${S3_ACCESS_KEY_ID:-minio_local}"
SK="${S3_SECRET_ACCESS_KEY:-minio_local_secret}"
APP_ORIGIN="${APP_URL:-http://localhost:3000}"
N=1024
KEY="t08-check/$(date +%s)-$$.bin"
fail=0
ok()  { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=1; }

curl -s -o /dev/null --max-time 5 "$ENDPOINT/minio/health/live" || { echo "MinIO not reachable at $ENDPOINT (run pnpm infra:up)"; exit 2; }

presign() { # prints a presigned PUT URL with content-length signed
  S3_ENDPOINT="$ENDPOINT" AK="$AK" SK="$SK" BUCKET="$BUCKET" KEY="$KEY" N="$N" \
  node --input-type=module -e '
    import { createRequire } from "node:module";
    const req = createRequire(process.cwd() + "/packages/core/package.json");
    const { S3Client, PutObjectCommand } = req("@aws-sdk/client-s3");
    const { getSignedUrl } = req("@aws-sdk/s3-request-presigner");
    const e = process.env;
    const s3 = new S3Client({ region: "auto", endpoint: e.S3_ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: e.AK, secretAccessKey: e.SK } });
    console.log(await getSignedUrl(s3, new PutObjectCommand({ Bucket: e.BUCKET, Key: e.KEY,
      ContentType: "image/png", ContentLength: Number(e.N) }), { expiresIn: 300 }));'
}
URL_SIGNED="$(presign)" || { echo "presign failed"; exit 2; }

put() { # $1 = bytes ; $2 = file-suffix
  head -c "$1" /dev/zero > "$TMP/body"
  curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X PUT -H "Content-Type: image/png" --data-binary "@$TMP/body" "$URL_SIGNED"
}
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# 1. signed content-length
c="$(put $((N+1)))"; [[ "$c" == 403 ]] && ok "N+1 bytes rejected ($c)" || bad "N+1 bytes: expected 403, got $c"
c="$(put "$N")";     [[ "$c" == 200 ]] && ok "N bytes accepted ($c)"  || bad "N bytes: expected 200, got $c"

# 2. PUT after confirm: same URL, different bytes. Record only.
head -c "$N" /dev/urandom > "$TMP/body"
c="$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: image/png" --data-binary "@$TMP/body" "$URL_SIGNED")"
echo "INFO  PUT-after-confirm (same URL, different bytes): HTTP $c  (200 = overwrite allowed; bounded TOCTOU, worker must re-verify; see M2 review)"

# 3. CORS preflight
hdr="$(curl -s -D - -o /dev/null -X OPTIONS -H "Origin: $APP_ORIGIN" -H "Access-Control-Request-Method: PUT" "$ENDPOINT/$BUCKET/$KEY")"
acao="$(printf '%s' "$hdr" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
[[ "$acao" == "$APP_ORIGIN" ]] && ok "CORS allows app origin ($acao)" || bad "CORS allow-origin for app origin: got '${acao:-<none>}'"
hdr2="$(curl -s -D - -o /dev/null -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: PUT" "$ENDPOINT/$BUCKET/$KEY")"
acao2="$(printf '%s' "$hdr2" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
if [[ -z "$acao2" ]]; then ok "foreign origin gets no allow-origin"; else bad "foreign origin got allow-origin '$acao2' (wildcard?)"; fi

# 4. lifecycle
ilm="$(docker compose --profile init run --rm --no-deps --entrypoint /bin/sh minio-init -c \
  "mc alias set local http://minio:9000 $AK $SK >/dev/null && mc ilm rule ls local/$BUCKET" 2>&1)" || true
echo "$ilm"
if printf '%s' "$ilm" | grep -Eiq 'expir|1 ?day|Days.*1'; then ok "ilm expiry rule present on $BUCKET"; else bad "no expiry rule on $BUCKET"; fi

exit "$fail"
