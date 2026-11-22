#!/usr/bin/env bash
# LIVE-08: stubbed test of scripts/vps-preflight.sh + the staging-up.sh host gate. No docker, no network, no secrets.
set -uo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; fail=0
mkdir -p "$T/bin" "$T/sys/kernel" "$T/sys/user"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/docker"; chmod +x "$T/bin/docker"       # stub: compose version OK, nothing running
printf '#!/bin/sh\nexit 0\n' > "$T/bin/ss"; chmod +x "$T/bin/ss"                 # stub: no listeners
printf 'MemTotal:        3900000 kB\n' > "$T/mem_ok"; printf 'MemTotal:        1000000 kB\n' > "$T/mem_low"
echo 1 > "$T/sys/kernel/unprivileged_userns_clone"; echo 15000 > "$T/sys/user/max_user_namespaces"
# run <name> <expect 0|1> <stdout/stderr pattern|-> [VAR=val ...]: runs the preflight standalone in a clean env
run() {
  local name="$1" want="$2" pat="$3"; shift 3
  local out rc; out="$(env -i PATH="$T/bin:/usr/bin:/bin" VPS_MEMINFO="$T/mem_ok" VPS_SYSCTL_DIR="$T/sys" "$@" bash scripts/vps-preflight.sh 2>&1)"; rc=$?
  if [ "$((rc != 0))" != "$want" ] || { [ "$pat" != - ] && ! grep -Eq -e "$pat" <<<"$out"; }; then echo "FAIL: $name (rc=$rc)"; echo "$out" | sed 's/^/    /'; fail=1; else echo "ok:   $name"; fi
}
run "public IP, healthy host passes"           0 -                         STAGING_HOST=203.0.113.10
run "unset STAGING_HOST refused"               1 'STAGING_HOST is not set'
run "RFC1918 10/8 refused"                     1 'private address'         STAGING_HOST=10.1.2.3
run "RFC1918 172.16/12 refused"                1 'private address'         STAGING_HOST=172.20.0.5
run "RFC1918 192.168/16 refused"               1 'private address'         STAGING_HOST=192.168.1.9
run "172.32.x is public (boundary)"            0 -                         STAGING_HOST=172.32.0.1
run "loopback refused off CI"                  1 'loopback address'        STAGING_HOST=127.0.0.1
run "loopback allowed on CI"                   0 'CI run'                  STAGING_HOST=127.0.0.1 CI=true
run "private still refused on CI"              1 'private address'         STAGING_HOST=10.0.0.1 CI=true
run "low RAM refused"                          1 'less than 4 GB RAM'      STAGING_HOST=203.0.113.10 VPS_MEMINFO="$T/mem_low"
echo 0 > "$T/sys/kernel/unprivileged_userns_clone"
run "userns disabled refused"                  1 'user namespaces are disabled' STAGING_HOST=203.0.113.10
echo 1 > "$T/sys/kernel/unprivileged_userns_clone"
printf '#!/bin/sh\necho "LISTEN 0 4096 0.0.0.0:3000 0.0.0.0:*"\n' > "$T/bin/ss"
run "busy WEB_PORT refused"                    1 'port 3000 is already in use' STAGING_HOST=203.0.113.10
run "other WEB_PORT passes"                    0 -                         STAGING_HOST=203.0.113.10 WEB_PORT=3100
printf '#!/bin/sh\nexit 127\n' > "$T/bin/docker"
run "missing docker compose v2 refused"        1 'compose v2 plugin not found' STAGING_HOST=203.0.113.10 WEB_PORT=3100
printf '#!/bin/sh\nexit 0\n' > "$T/bin/docker"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/ss"
# every failure is reported at once, and no env values are printed
out="$(env -i PATH="$T/bin:/usr/bin:/bin" VPS_MEMINFO="$T/mem_low" VPS_SYSCTL_DIR="$T/sys" STAGING_HOST=10.0.0.1 MODERATION_API_KEY=sekrit-value bash scripts/vps-preflight.sh 2>&1)"
grep -q 'private address' <<<"$out" && grep -q 'less than 4 GB' <<<"$out" && ! grep -q sekrit-value <<<"$out" && echo "ok:   all problems reported together, no value leaked" || { echo "FAIL: aggregate/leak"; fail=1; }
# staging-up.sh gate: private host => exit 1 before any docker call (docker stub would exit 0, so a pass-through shows as rc=0)
env -i PATH="$T/bin:/usr/bin:/bin" VPS_MEMINFO="$T/mem_ok" VPS_SYSCTL_DIR="$T/sys" MODERATION_PROVIDER=anthropic MODERATION_API_KEY=x STAGING_HOST=192.168.0.2 STAGING_ENV_FILE="$T/e.env" bash scripts/staging-up.sh up >"$T/o" 2>&1
rc=$?; if [ $rc -ne 0 ] && grep -q 'private address' "$T/o" && [ ! -s "$T/e.env" ]; then echo "ok:   staging-up.sh refuses a private STAGING_HOST before writing the env file"; else echo "FAIL: staging-up gate (rc=$rc)"; cat "$T/o"; fail=1; fi
exit $fail
