# ReelForge

Smart Production Studio — React frontend + Rust/Actix backend.

## Architecture

| Layer | Stack | URL |
| --- | --- | --- |
| Backend | Rust / Actix / PostgreSQL | `https://reelforge-deploy-production.up.railway.app` |
| Frontend | React / Vite | Netlify Drop or Netlify site |

## What was fixed

1. **Frontend API base URL** — all requests use `import.meta.env.VITE_API_URL` (no hardcoded `localhost`).
2. **Production env** — `frontend/.env.production` and `frontend/netlify.toml` bake in the Railway URL at build time.
3. **Backend CORS** — Netlify origins are explicitly allowed in `backend/src/cors.rs`.
4. **Endpoint alignment** — frontend calls `/api/reels`; backend exposes `GET /api/reels` and `POST /api/reels/seed`.
5. **Placeholder cards** — backend seeds demo reels when the table is empty; frontend shows local fallback cards if the API is unreachable or returns `[]`.

## Local development

```bash
# Terminal 1 — backend (requires PostgreSQL)
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/reelforge
cd backend
cargo run

# Terminal 2 — frontend
cd frontend
cp .env.example .env.local   # or use the included .env.local
npm install
npm run dev
```

Or use the helper script (starts both):

```bash
./scripts/start-dev.sh
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:8080`

## Production build & Netlify Drop deploy

```bash
cd frontend
npm install
npm run build
```

Then drag `frontend/dist/` to [Netlify Drop](https://app.netlify.com/drop).

If you use the Netlify dashboard instead of Drop, set:

```env
VITE_API_URL=https://reelforge-deploy-production.up.railway.app
```

## Railway backend redeploy

Push this repo to Railway (or run locally with the same env vars):

```env
DATABASE_URL=<your-railway-postgres-url>
PORT=7463
HOST=0.0.0.0
```

After deploy, verify:

```bash
curl https://reelforge-deploy-production.up.railway.app/health
curl https://reelforge-deploy-production.up.railway.app/api/reels
```

If `/api/reels` is empty, seed placeholders:

```bash
curl -X POST https://reelforge-deploy-production.up.railway.app/api/reels/seed
```

## Verification checklist

- [ ] `npm run build` succeeds in `frontend/`
- [ ] Browser Network tab shows `200` requests to `https://reelforge-deploy-production.up.railway.app/api/reels`
- [ ] No CORS errors in the browser console
- [ ] Placeholder cards render on the Netlify URL
- [ ] Local dev at `http://localhost:5173` still works

## Public URL format

After Netlify Drop upload you receive a URL like:

`https://<random-name>.netlify.app`

Share that URL once cards load successfully against the Railway backend.
