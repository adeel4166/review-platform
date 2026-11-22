# Staging on one VPS, no domain (step by step)

For: a 4 GB Ubuntu 22.04/24.04 server with a public IP. You will type about 10 commands. Nothing here goes to production.
Replace `203.0.113.10` with **your server's public IP** everywhere.

## 1. Connect
`ssh root@203.0.113.10` (or the user your provider gave you). Run the commands below on the server.

## 2. Install Docker (once)
```bash
curl -fsSL https://get.docker.com | sh
docker compose version        # must print "Docker Compose version v2..."
```
Add some swap so 4 GB is comfortable (once):
`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`

## 3. Get the code
```bash
git clone <repository-url> review-platform && cd review-platform
git checkout main
```

## 4. Set the three settings (the key is never written to disk)
```bash
export STAGING_HOST=203.0.113.10          # the PUBLIC IP (curl -4 ifconfig.me shows it)
export MODERATION_PROVIDER=anthropic
read -rs MODERATION_API_KEY && export MODERATION_API_KEY    # paste the key, press Enter (nothing is shown on screen)
```
These live only in this terminal session. Run step 5 in the same session. (To avoid the key appearing in shell history, do not type it as `export KEY=...`; use `read -rs` as above.)

## 5. Start
```bash
scripts/staging-up.sh
```
It first runs a **preflight** and stops with a plain message if something is wrong (Docker/Compose missing, less than 4 GB RAM, port 3000/9000 busy, user namespaces off, `STAGING_HOST` missing or a private/loopback address). Fix what it names and run it again; nothing was started. The first run builds images (10-20 min), then seeds demo data and runs a smoke test.

When it prints `staging is up`, open **http://203.0.113.10:3000** in your browser.

## 6. Firewall
Open only these inbound ports at your **provider's cloud firewall** (Docker publishes ports around `ufw`, so `ufw` alone will not protect them):
- `22` (SSH, ideally only from your IP), `3000` (app), `9000` (media/uploads: browsers use it directly).
- Do **not** open 8025 (Mailpit), 3306, 6379: they are not published publicly.

## 7. Logins, mail and staff 2FA
- Demo accounts: `demo.user@`, `demo.seller@`, `demo.moderator@`, `demo.senior-moderator@`, `demo.admin@`, `demo.super-admin@` followed by `demo.example`.
- The shared password is `DEMO_PASSWORD` in `.env.staging` on the server (the script never prints it). Read it yourself, e.g. `grep ^DEMO_PASSWORD .env.staging` in a private terminal.
- **Staff (moderator/admin) must enrol 2FA on first login**: sign in, scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password), enter the 6-digit code, and **save the recovery codes** somewhere safe.
- All outgoing mail (verification, etc.) goes to Mailpit, never the internet. Read it from your own computer:
  `ssh -L 8025:127.0.0.1:8025 root@203.0.113.10`, then open http://127.0.0.1:8025 locally.

## 8. Day to day (run in the repo folder; the three settings are not needed for these)
| What | Command |
|---|---|
| Status | `scripts/staging-up.sh status` |
| Logs | `scripts/staging-up.sh logs web` (also `worker-core`, `worker-media`) |
| Re-check the app | `scripts/staging-up.sh smoke` |
| Stop (keeps data) | `scripts/staging-up.sh stop` |
| Start again | repeat step 4 and `scripts/staging-up.sh` (data and generated secrets are kept) |
| Remove containers (keeps data) | `scripts/staging-up.sh down` |

## 9. Rollback
Staging data lives in Docker volumes and is kept across restarts. To go back to a previous version:
```bash
scripts/staging-up.sh stop
git log --oneline -5            # pick the last good commit
git checkout <good-commit>
# repeat step 4, then:
scripts/staging-up.sh
```
Database migrations only move forward; if a rollback needs a schema undo, ask engineering (see `restore-runbook.md`). To start completely fresh (**deletes all staging data**): `scripts/staging-up.sh down` then `docker volume ls | grep rp-staging` and remove those volumes yourself on purpose.

## Optional: free HTTPS (no domain needed)
Uses [sslip.io](https://sslip.io): `203.0.113.10` becomes `https://203-0-113-10.sslip.io` (app) and `https://s3.203-0-113-10.sslip.io` (media), with automatic Let's Encrypt certificates via Caddy. Off by default.
1. Also open ports **80** and **443** in the cloud firewall; you may then close 3000 and 9000.
2. Start with `export STAGING_TLS=1` in step 4 (it is remembered in `.env.staging`; `STAGING_TLS=0` switches back to plain HTTP).
3. Open **https://203-0-113-10.sslip.io**. The script sets `APP_URL`, `S3_PUBLIC_ENDPOINT`, `MEDIA_PUBLIC_BASE_URL` and MinIO CORS (which follows `APP_URL`) together.
Notes: the first certificate takes up to a minute; Let's Encrypt rate-limits per sslip.io domain, so avoid repeated fresh installs. `STAGING_HOST` must be the IP itself (not a name) in this mode.

## Troubleshooting
- `preflight FAILED: ...` lines say exactly what to change; the script stops before starting anything.
- worker-media restarting: your kernel blocks user namespaces; run the `sysctl` command the preflight prints.
- Page loads but uploads fail: port 9000 (or 443 in TLS mode) is not open in the cloud firewall, or `STAGING_HOST` is not the public IP.
