# ReelForge production deployment

## Quick start (Docker)

```bash
cd ~/projects/reelforge
docker compose up -d --build
```

Set `MEDIA_PUBLIC_BASE` and `REELFORGE_CORS_ORIGINS` in `docker-compose.yml` for your public hostname before going live.

## Dev → prod migration

```bash
# On dev machine
./backend/scripts/export-dev.sh

# On prod (Postgres running, empty or restorable DB)
./backend/scripts/import-prod.sh ./export

# After backend is up
./backend/scripts/post-deploy-verify.sh
```

## Environment

See [backend/.env.example](../backend/.env.example) and [frontend/.env.example](../frontend/.env.example).

Production frontend build **requires** `VITE_BACKEND_URL` at build time.

## One-time legacy media import

Only when video files exist on disk but are not in Postgres:

```bash
ADMIN_PASSWORD=... BACKEND=https://your-host ./backend/scripts/migrate-media.sh
```

Run once per environment; re-running is safe (skips existing basenames).
