#!/usr/bin/env bash
# One-command local start: env file, infra, DB schema, then web + worker in watch mode.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example"; }
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile || pnpm install
docker compose up -d --wait mysql redis minio
docker compose --profile init run --rm minio-init
pnpm db:generate
pnpm db:push
exec pnpm dev
