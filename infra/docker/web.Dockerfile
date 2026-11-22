# Staging web image (LIVE-05): `next start` of the production build. Also used (as the `migrate` service) to run
# `prisma migrate deploy` and `pnpm db:seed:demo`, which need the workspace and dev dependencies (prisma, tsx).
# No secrets are baked in: every value arrives as an environment variable at run time. DATABASE_URL below is a build-only placeholder.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini openssl \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile \
 && NODE_ENV=development DATABASE_URL=mysql://build:build@127.0.0.1:3306/build pnpm db:generate \
 && DATABASE_URL=mysql://build:build@127.0.0.1:3306/build pnpm --filter @rp/web build \
 && useradd --system --uid 10002 --home /app rpweb && chown -R rpweb /app
USER rpweb
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
