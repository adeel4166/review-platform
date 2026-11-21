# Verification-egress worker group (T-01 / F-01, ADR-0015 §7)

The only code that fetches attacker-controlled URLs or resolves their DNS runs in its own process, with no secrets worth stealing.

## Pipeline
1. Outbox relay / sweepers enqueue `verification.check {claimId}` on `verification` (consumed by the **core** group).
2. Core loads the claim (DB), and if it needs a check enqueues `verification.egress {claimId, method, domain}` on `verification-egress`.
3. **Egress** group (`WORKER_GROUPS=verification-egress`) validates the request, runs DNS_TXT / META_TAG through the SSRF-safe fetcher, and enqueues `verification.result {claimId, observed[], error, proofHost?}` on `verification-result`.
4. Core consumes `verification-result` and applies the claim transition. Egress never decides outcomes or writes the DB.

## Isolation controls
- **Groups:** `WORKER_GROUPS` is `core` (default) or `verification-egress`, exactly one. Core never imports `createProductionFetcher` (unit-tested).
- **Environment:** egress gets only `REDIS_URL` and `VERIFY_DNS_SERVERS` (`scripts/run-egress-worker.sh` uses `env -i` and does not load `.env`).
- **Startup assertion** (`apps/worker/src/groups.ts`): exit 1 if `DATABASE_URL`, any `S3_*` or `SMTP_URL` is present, or `REDIS_URL` is missing. Values are never logged.
- **Redis ACL** (`infra/redis/users.acl`): user `verif-egress` may touch only `bull:verification-egress:*` and `bull:verification-result:*`; admin/dangerous commands denied. Production must use the same ACL with a secret-managed password (the file's password is a local throwaway).
- **Network policy** (`infra/egress/egress-policy.sh`, reference iptables for the egress subnet; same intent as a Kubernetes NetworkPolicy):
  - TCP 80/443 to the internet, except RFC1918, CGNAT 100.64/10, loopback, link-local 169.254/16 (cloud metadata), multicast/reserved and cluster pod/service CIDRs (add yours to `DENY`).
  - DNS (53 udp/tcp) only to `VERIFY_DNS_SERVERS`.
  - TCP 6379 only to Redis. Everything else dropped.
- `docker compose --profile egress up -d verification-egress` runs it as a container (read-only FS, all caps dropped) on the `egress` network (172.28.0.0/24).

## Deployment note
The core group must be able to enqueue to `verification-egress` and consume `verification-result` (default Redis user). Run at least one egress process, or claim checks stay queued (they retry; claims time out through the normal expiry sweepers).
