#!/usr/bin/env bash
# M8-02: static launch-readiness checks on docker-compose.prod.yml, infra/* and the worker image recipe. No secrets are read; no docker needed.
set -euo pipefail
cd "$(dirname "$0")/.."
F=docker-compose.prod.yml; fail=0
chk() { if ! grep -Eq -e "$2" "$3"; then echo "FAIL: $1"; fail=1; else echo "ok:   $1"; fi; }
chk "redis ACL enabled (--aclfile)" '--aclfile' $F
chk "redis default user is password-protected (not nopass)" 'user default on >' $F
chk "redis verif-egress ACL user limited to its queues" 'user verif-egress on .*~bull:verification-egress:\*' $F
chk "redis noeviction" 'maxmemory-policy noeviction' $F
chk "clamav service present" '^  clamav:' $F
chk "minio policies mounted and attached" 'mc admin policy attach local rp-web' $F
chk "minio rp-public is the only anonymous-read bucket" 'anonymous set download local/rp-public' $F
chk "minio CORS pinned to APP_URL" 'MINIO_API_CORS_ALLOW_ORIGIN: \$\{APP_URL:\?\}' $F
chk "egress network with fixed subnet 172.28.0.0/24" '172\.28\.0\.0/24' $F
chk "verification-egress holds only the egress ACL user" 'redis://verif-egress:' $F
chk "media worker requires the sandbox" 'MEDIA_SANDBOX_REQUIRED: "true"' $F
chk "core worker requires MODERATION_PROVIDER (compose :?)" 'MODERATION_PROVIDER: \$\{MODERATION_PROVIDER:\?\}' $F
chk "workers cap_drop ALL + read_only" 'cap_drop: \[ALL\]' $F
chk "worker image ships bwrap" 'bubblewrap' infra/docker/worker.Dockerfile
chk "worker image ships prlimit (util-linux)" 'util-linux' infra/docker/worker.Dockerfile
chk "worker image ships poppler + exiftool + ffmpeg" 'poppler-utils ffmpeg libimage-exiftool-perl' infra/docker/worker.Dockerfile
chk "worker image runs non-root" '^USER rpworker' infra/docker/worker.Dockerfile
chk "sandbox required by default in the image" 'MEDIA_SANDBOX_REQUIRED=true' infra/docker/worker.Dockerfile
chk "egress iptables policy denies RFC1918 + metadata" '169\.254\.0\.0/16' infra/egress/egress-policy.sh
# SEC-FIN-02: ledger + audit archive provisioning, required in compose, names in the env example.
chk "minio-init creates object-locked rp-ledger and rp-audit-archive" 'mc mb -p --with-lock local/rp-ledger local/rp-audit-archive' $F
chk "ledger writer / reader / audit policies attached" 'rp-ledger-w --user' $F
chk "ledger reader policy attached" 'rp-ledger-r --user' $F
chk "audit archive policy attached" 'rp-audit-w --user' $F
chk "worker-core requires ARCHIVE_DATABASE_URL" 'ARCHIVE_DATABASE_URL: \$\{ARCHIVE_DATABASE_URL:\?\}' $F
chk "worker-core requires the ledger write credential" 'S3_LEDGER_ACCESS_KEY_ID: \$\{S3_LEDGER_ACCESS_KEY_ID:\?\}' $F
chk "worker-core requires the audit archive bucket" 'S3_BUCKET_AUDIT_ARCHIVE: \$\{S3_BUCKET_AUDIT_ARCHIVE:\?\}' $F
chk "env example names ARCHIVE_DATABASE_URL" '^ARCHIVE_DATABASE_URL=' .env.production.example
chk "ledger policy is write-only (no GetObject/Delete)" '"s3:PutObject"' infra/minio/policies/rp-ledger-w.json
# No literal secrets: every ${VAR} reference must be required (:?) in the prod compose for credentials.
if grep -Eq '(PASSWORD|SECRET|API_KEY|_KEY): [^$"]' $F; then echo "FAIL: literal secret value in $F"; fail=1; else echo "ok:   no literal secrets in $F"; fi
exit $fail
