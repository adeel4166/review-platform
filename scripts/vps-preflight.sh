#!/usr/bin/env bash
# LIVE-08: host preflight for the no-domain VPS staging deploy. Sourced by scripts/staging-up.sh; also runnable alone:
#   STAGING_HOST=<public ip> bash scripts/vps-preflight.sh [tls]
# Fails closed with a clear message. Prints variable/tool NAMES only, never values of secrets.
# Test seams (stubbed tests only): VPS_MEMINFO (default /proc/meminfo), VPS_SYSCTL_DIR (default /proc/sys). `CI=true` (GitHub Actions) relaxes
# the host-sizing checks and allows STAGING_HOST=127.0.0.1 so the staging-stack job keeps working unchanged.
VPS_MIN_MEM_KB="${VPS_MIN_MEM_KB:-3670016}" # 3.5 GiB usable: what a "4 GB" VPS reports after kernel reservations

pf_fail() { echo "preflight FAILED: $*" >&2; PF_FAILS=$((PF_FAILS + 1)); }
pf_ok() { echo "preflight ok: $*"; }

# classify an IPv4 literal: public | private | loopback | other (unspecified, link-local, CGNAT, multicast)
ipv4_class() {
  local a b c d; IFS=. read -r a b c d <<<"$1"
  [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo invalid; return; }
  for o in $a $b $c $d; do [ "$((10#$o))" -le 255 ] || { echo invalid; return; }; done
  a=$((10#$a)); b=$((10#$b))
  if [ "$a" = 127 ]; then echo loopback
  elif [ "$a" = 10 ] || { [ "$a" = 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } || { [ "$a" = 192 ] && [ "$b" = 168 ]; }; then echo private
  elif [ "$a" = 0 ] || { [ "$a" = 169 ] && [ "$b" = 254 ]; } || { [ "$a" = 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ]; } || [ "$a" -ge 224 ]; then echo other
  else echo public; fi
}

# check_staging_host <host> [tls]: refuses unset / non-public hosts unless CI=true and the host is loopback.
check_staging_host() {
  local h="${1:-}" tls="${2:-0}" ip cls
  if [ -z "$h" ]; then
    pf_fail "STAGING_HOST is not set. Set it to this server's PUBLIC IPv4 address, e.g.  export STAGING_HOST=203.0.113.10  (find it with: curl -4 ifconfig.me)"; return
  fi
  if [[ "$h" =~ ^[0-9.]+$ ]]; then ip="$h"; else ip="$(getent ahostsv4 "$h" 2>/dev/null | awk 'NR==1{print $1}')"; fi
  [ -n "$ip" ] || { pf_fail "STAGING_HOST does not resolve to an IPv4 address; set it to the server's public IPv4"; return; }
  cls="$(ipv4_class "$ip")"
  if [ "$cls" = invalid ]; then pf_fail "STAGING_HOST is not a valid IPv4 address"; return; fi
  if [ "$cls" != public ]; then
    if [ "${CI:-}" = true ] && [ "$cls" = loopback ]; then pf_ok "STAGING_HOST is loopback (CI run)"; return; fi
    pf_fail "STAGING_HOST resolves to a $cls address; browsers on other machines cannot reach it. Set it to the server's PUBLIC IPv4 (curl -4 ifconfig.me), e.g.  export STAGING_HOST=203.0.113.10"; return
  fi
  if [ "$tls" = 1 ] && ! [[ "$h" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then pf_fail "STAGING_TLS=1 needs STAGING_HOST to be the public IPv4 literal (the sslip.io name is derived from it)"; return; fi
  pf_ok "STAGING_HOST is a public IPv4 address"
}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then ss -ltnH 2>/dev/null | awk -v p=":$1" '{ if (substr($4, length($4) - length(p) + 1) == p) f = 1 } END { exit !f }'
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}

# check_machine <tls> <ports...>
check_machine() {
  local tls="$1"; shift
  command -v docker >/dev/null 2>&1 || pf_fail "docker not found (install Docker Engine: see docs/ops/vps-quickstart.md step 2)"
  if command -v docker >/dev/null 2>&1; then
    docker compose version >/dev/null 2>&1 && pf_ok "docker compose v2 present" || pf_fail "docker compose v2 plugin not found (install docker-compose-plugin)"
  fi
  if [ "${CI:-}" = true ]; then pf_ok "RAM / port / user-namespace checks skipped (CI run)"; return; fi
  local kb; kb="$(awk '/^MemTotal:/{print $2}' "${VPS_MEMINFO:-/proc/meminfo}" 2>/dev/null)"
  if [ -z "$kb" ]; then pf_fail "cannot read total RAM"
  elif [ "$kb" -lt "$VPS_MIN_MEM_KB" ]; then pf_fail "less than 4 GB RAM available ($((kb / 1024)) MiB seen, $((VPS_MIN_MEM_KB / 1024)) MiB needed): use a 4 GB plan"
  else pf_ok "RAM >= 4 GB plan ($((kb / 1024)) MiB)"; fi
  # Ports we publish. Our own running stack legitimately holds them on a re-run.
  local mine=""; command -v docker >/dev/null 2>&1 && mine="$(docker ps -q --filter label=com.docker.compose.project=rp-staging 2>/dev/null || true)"
  local p
  for p in "$@"; do
    if [ -n "$mine" ]; then pf_ok "port $p (held by this stack or free)"
    elif port_in_use "$p"; then pf_fail "port $p is already in use by another process (set WEB_PORT/MINIO_PORT to another value, or stop that service)"
    else pf_ok "port $p is free"; fi
  done
  # worker-media sandbox (bwrap) needs unprivileged user namespaces.
  local sd="${VPS_SYSCTL_DIR:-/proc/sys}" v ns_bad=0
  v="$(cat "$sd/kernel/unprivileged_userns_clone" 2>/dev/null || true)"; [ "$v" = 0 ] && ns_bad=1
  v="$(cat "$sd/user/max_user_namespaces" 2>/dev/null || true)"; [ "$v" = 0 ] && ns_bad=1
  if [ "$ns_bad" = 1 ]; then pf_fail "unprivileged user namespaces are disabled (needed by worker-media sandbox). Fix: sudo sysctl -w kernel.unprivileged_userns_clone=1 user.max_user_namespaces=15000"
  else pf_ok "unprivileged user namespaces available"; fi
}

# vps_preflight <host> <tls 0|1> <ports...>: returns non-zero (after printing every failure) when anything is wrong.
vps_preflight() {
  local host="$1" tls="$2"; shift 2; PF_FAILS=0
  check_staging_host "$host" "$tls"
  check_machine "$tls" "$@"
  [ "$PF_FAILS" -eq 0 ]
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  tls=0; [ "${1:-}" = tls ] && tls=1
  ports=("${WEB_PORT:-3000}" "${MINIO_PORT:-9000}"); [ "$tls" = 1 ] && ports+=(80 443)
  vps_preflight "${STAGING_HOST:-}" "$tls" "${ports[@]}" || { echo "preflight: $PF_FAILS problem(s); nothing was started" >&2; exit 1; }
fi
