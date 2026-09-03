# ReelForge production deployment

**Full pre-deploy checklist:** [PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md) (catalog seeds + mobile pure-gesture gate).

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

## STIRRED Original Productions catalog

When promoting STIRRED to production (home browse row + poster), see [PRODUCTION_HANDOFF_STIRRED_CATALOG.md](./PRODUCTION_HANDOFF_STIRRED_CATALOG.md).

```bash
cd frontend
REELFORGE_API_BASE=https://your-host ADMIN_PASSWORD=... npm run seed:stirred-production-catalog
```

## Vic G face poster (Original Productions stack)

Vic G uses **Power of Support** key art as the **face poster** in front of stacked episodes. See [PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md).

```bash
cd frontend
REELFORGE_API_BASE=https://your-host \
VIC_G_FACE_POSTER_SOURCE=/path/to/974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4\(1\).png \
ADMIN_PASSWORD=... npm run seed:vic-g-face-poster
```
