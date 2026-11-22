# Production worker image (core / media / verification-egress groups share it; WORKER_GROUPS selects one).
# Media sandbox prerequisites (M5 SEC-M5-01, MED-047): bubblewrap (bwrap), util-linux (prlimit), poppler-utils (pdfinfo/pdftoppm),
# ffmpeg, exiftool. The startup self-test (assertMediaSandbox) exits 1 when bwrap is missing, the network is reachable or /usr is writable.
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    MEDIA_SANDBOX_REQUIRED=true \
    MEDIA_EXIFTOOL_REQUIRED=true \
    CI=
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap util-linux poppler-utils ffmpeg libimage-exiftool-perl ca-certificates tini openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app
COPY . .
# Dev dependencies are needed: the worker runs from source through tsx (apps/worker `start`).
RUN NODE_ENV=development pnpm install --frozen-lockfile && NODE_ENV=development pnpm db:generate \
 && useradd --system --uid 10001 --home /app rpworker && chown -R rpworker /app
USER rpworker
WORKDIR /app/apps/worker
ENTRYPOINT ["/usr/bin/tini", "--"]
# No secrets baked in: every value arrives as an environment variable (names in .env.production.example).
CMD ["node_modules/.bin/tsx", "src/main.ts"]
