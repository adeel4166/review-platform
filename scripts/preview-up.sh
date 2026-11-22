#!/usr/bin/env bash
# Rebuild + restart the :5101 preview from a dedicated checkout that tracks `main` only.
# Never serves the agent workspace. Run after every merge to main (e.g. from a post-merge hook or the deploy step).
#
#   scripts/preview-up.sh          # sync worktree to origin/main (or local main), clean build, restart, smoke check
#
# Env (names only): PREVIEW_DIR (default: <repo>/../review-platform-preview), PREVIEW_PORT (5101),
# PREVIEW_REF (main), PREVIEW_USE_CWD (1 = build this checkout instead of a main worktree; CI smoke job only), PREVIEW_ENV_FILE (optional path to an env file copied by reference; never printed).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_DIR="${PREVIEW_DIR:-$REPO/../review-platform-preview}"
PORT="${PREVIEW_PORT:-5101}"
REF="${PREVIEW_REF:-main}"
PIDFILE="$PREVIEW_DIR/.preview.pid"
LOG="$PREVIEW_DIR/.preview.log"

# 0. Preflight (fail closed, names only): the preview must not come up with the unsafe mock moderation provider in a production-mode run.
if [ "${NODE_ENV:-}" = "production" ] && { [ -z "${MODERATION_PROVIDER:-}" ] || [ "${MODERATION_PROVIDER:-}" = "mock" ]; }; then
  echo "preview-up: refusing to start: MODERATION_PROVIDER must be a real provider when NODE_ENV=production" >&2
  exit 1
fi

# 1. Dedicated detached worktree of main (never a branch an agent can check out).
if [ "${PREVIEW_USE_CWD:-0}" = "1" ]; then
  PREVIEW_DIR="$REPO"; PIDFILE="$PREVIEW_DIR/.preview.pid"; LOG="$PREVIEW_DIR/.preview.log"
else
  git -C "$REPO" fetch --quiet origin "$REF" 2>/dev/null || true
  TARGET="$(git -C "$REPO" rev-parse --verify -q "origin/$REF" || git -C "$REPO" rev-parse --verify "$REF")"
  if [ ! -d "$PREVIEW_DIR" ]; then
    git -C "$REPO" worktree add --detach "$PREVIEW_DIR" "$TARGET"
  else
    git -C "$PREVIEW_DIR" checkout --quiet --detach "$TARGET"
  fi
fi
echo "preview @ $(git -C "$PREVIEW_DIR" rev-parse --short HEAD)"

cd "$PREVIEW_DIR"
if [ -n "${PREVIEW_ENV_FILE:-}" ] && [ -f "$PREVIEW_ENV_FILE" ]; then cp "$PREVIEW_ENV_FILE" .env; fi
export NEXT_DIST_DIR=.next            # preview owns .next; dev uses .next-dev (see next.config.mjs)

# 2. Clean production build into a staging dist dir, so the running server keeps serving until the swap.
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm db:generate
rm -rf apps/web/.next-build
NEXT_DIST_DIR=.next-build pnpm --filter @rp/web build

# 3. Stop old server, swap dist, start `next start`.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")" || true
  for _ in $(seq 1 20); do kill -0 "$(cat "$PIDFILE")" 2>/dev/null || break; sleep 0.5; done
fi
rm -rf apps/web/.next
mv apps/web/.next-build apps/web/.next
cd apps/web
nohup node ../../node_modules/next/dist/bin/next start -p "$PORT" -H 0.0.0.0 >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
cd "$PREVIEW_DIR"

# 4. Smoke check (fails loudly -> non-zero exit).
for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 1; done
node scripts/preview-smoke.mjs "http://127.0.0.1:$PORT"
