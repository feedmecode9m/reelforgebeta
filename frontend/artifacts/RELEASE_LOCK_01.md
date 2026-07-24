# RELEASE-LOCK-01 — Source Lock Evidence

**Mission:** Make production fully reproducible from Git.  
**Verdict:** **NOT SOURCE LOCKED** — GitHub push blocked (invalid `gh` token); remote `main` does not match local release commits.

---

## Release identity

| Field | Value |
|-------|--------|
| **Release tag** | `RELEASE-01` (resolve: `git rev-parse RELEASE-01`) |
| **Frontend commit SHA** | `0d6ffee0de1c86574d2349771305f50af1efe585` |
| **Lock artifact commit** | `git rev-parse HEAD` after checkout `RELEASE-01` |
| **Backend commit SHA** | `48c60fab05083c44000b4d6181ccb31d812b9487` |
| **GitHub `main` SHA** | `ba569924d74dc3733ba593f6069da91ea8ef9102` ⚠️ **STALE** |
| **Netlify deploy ID** | `6a630941cc47021713ddc6f4` |
| **Railway deploy ID** | `8678b458-1bdb-42b0-a338-daaec1ba63ab` |
| **Live bundle** | `index-q8wTbWuf.js` |
| **Bundle SHA-256** | `e42a51796bceb3820b37f82851064cea668e35dc2b002328b69b29b03f92f6b7` |
| **Frontend URL** | https://strong-lolly-a9fcb4.netlify.app/ |
| **Backend URL** | https://reelforge-deploy-production.up.railway.app |

---

## Alignment matrix

| Surface | Commit / artifact | Matches release? |
|---------|-------------------|------------------|
| Local `main` HEAD | `0d6ffee` (frontend) + lock artifact; ancestry includes `48c60fa` | ✅ |
| GitHub `origin/main` | `ba56992` (missing `48c60fa` + `0d6ffee`) | ❌ |
| Netlify production | Deploy `6a630941…` → bundle `index-q8wTbWuf.js` with ghost-purge symbols | ✅ |
| Railway production | Deploy `8678b458…` → backend `48c60fa` | ✅ |

**Blocker:** `git push origin main` fails — `gh auth git-credential` token invalid. Run `gh auth login -h github.com`, then push and re-run verification.

---

## What this release contains

### Frontend (`0d6ffee`)

- Video vault ghost purge: `pruneGhostVideoVaultEntries`, `isPendingLocalVideoVaultEntry` (`deletionSync.js`)
- Bootstrap reconcile: backend catalog wins (`mediaBootstrap.js`)
- Tombstone filter on reload/persist (`viewerContext.js`)
- Thumbnail vault hydration/delete hardening (`thumbnailVault.js`, `VaultExperience.svelte`)
- R2 signed upload client (`media.js`, `config.js`)
- Release validation harness (`vault-verify-03.mjs`, `release-gate-01.mjs`, `video-delete-resurrection-01.mjs`)

### Backend (`48c60fa`)

- BG-7I: signed upload routes for R2 presigned PUT flow
- Parent: SECURITY-AUTH-01 (`ba56992`) admin Bearer on mutating routes

---

## Deployment commands

### 1. Push source to GitHub (required before SOURCE LOCKED)

```bash
cd /home/youloose2dafish/projects/reelforge
gh auth login -h github.com   # if credential helper token is expired
git push origin main
git push origin RELEASE-01 --force   # retag remote; local tag moved from legacy 91ec9bb
```

### 2. Frontend — Netlify production

```bash
cd /home/youloose2dafish/projects/reelforge/frontend
npm run build   # uses netlify.toml build env when deployed via Netlify CLI
netlify deploy --prod --dir=dist \
  --site=791fc14c-cee0-4876-986b-a5c455f10d2a \
  --message="RELEASE-01 $(git -C .. rev-parse --short HEAD)"
```

Or via script (requires `NETLIFY_AUTH_TOKEN` or logged-in Netlify CLI):

```bash
bash frontend/scripts/deploy-netlify.sh "RELEASE-01 $(git rev-parse --short HEAD)"
```

**Build env (from `frontend/netlify.toml`):**

- `VITE_USE_SAME_ORIGIN_API=true`
- `VITE_ALLOW_UI_PLACEHOLDERS=false`
- `VITE_USE_SIGNED_UPLOADS=true`
- `VITE_DIRECT_UPLOAD_BASE_URL=https://reelforge-deploy-production.up.railway.app`
- `VITE_SIGNED_UPLOADS_MIN_BYTES=25000000`

> Note: `__DEPLOY_TIMESTAMP__` in `vite.config.js` embeds `Date.now()` — bundle **filename** and SHA-256 change on every build even from identical Git tree. Functional source is reproducible; byte-identical bundle is not.

### 3. Backend — Railway production

```bash
cd /home/youloose2dafish/projects/reelforge
git checkout 48c60fab05083c44000b4d6181ccb31d812b9487
railway up -d -y -s reelforge-deploy
```

---

## Rollback commands

### Frontend rollback (Netlify)

```bash
# Redeploy previous known-good deploy
netlify deploy --prod --site=791fc14c-cee0-4876-986b-a5c455f10d2a \
  --alias=6a62f9d35a89dc03412d7f49
# Or via Netlify UI: Deploys → 6a62f9d35a89dc03412d7f49 → Publish deploy
```

Previous deploy: `6a62f9d35a89dc03412d7f49` (same bundle hash, pre-lock Netlify ID).

### Backend rollback (Railway)

```bash
git checkout ba569924d74dc3733ba593f6069da91ea8ef9102
railway up -d -y -s reelforge-deploy
# Prior deployment: 9aa4473e-f684-4ffe-9f88-e417ba0ea917
```

### Git rollback

```bash
git checkout RELEASE-01   # → 0d6ffee (frontend lock commit)
# Backend pin: git checkout 48c60fa
```

---

## Verification commands

### Git alignment

```bash
cd /home/youloose2dafish/projects/reelforge
LOCAL=$(git rev-parse HEAD)
REMOTE=$(curl -sS https://api.github.com/repos/feedmecode9m/reelforgebeta/commits/main | jq -r .sha)
echo "local=$LOCAL remote=$REMOTE"
test "$LOCAL" = "$REMOTE" && echo PASS || echo FAIL
```

### Netlify bundle

```bash
SITE=https://strong-lolly-a9fcb4.netlify.app
BUNDLE=$(curl -sS "$SITE/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "bundle=$BUNDLE"
curl -sS "$SITE/assets/$BUNDLE" | sha256sum
curl -sS "$SITE/assets/$BUNDLE" | grep -q pruneGhostVideoVaultEntries && echo ghost-purge=OK
```

Expected bundle SHA-256 for current production:  
`e42a51796bceb3820b37f82851064cea668e35dc2b002328b69b29b03f92f6b7`

### Railway backend

```bash
curl -sS https://reelforge-deploy-production.up.railway.app/health | jq .
railway deployment list | head -3
# Active: 8678b458-1bdb-42b0-a338-daaec1ba63ab
```

### Release acceptance smoke

```bash
cd /home/youloose2dafish/projects/reelforge/frontend
ADMIN_PASSWORD=admin123 node scripts/video-delete-resurrection-01.mjs
ADMIN_PASSWORD=admin123 node scripts/vault-verify-03.mjs --skip-large-r2 --skip-hero
```

---

## Commits in release stack (local, not yet on GitHub)

```
ff8c3ac RELEASE-LOCK-01: add source lock evidence artifact (tag RELEASE-01 tip)
0d6ffee RELEASE-LOCK-01: commit deployed frontend (ghost-purge + vault hardening)
48c60fa BG-7I: register signed upload routes for R2 presigned PUT flow
ba56992 SECURITY-AUTH-01: enforce admin Bearer auth on mutating API routes  ← GitHub HEAD
```

---

## SOURCE LOCKED checklist

| Requirement | Status |
|-------------|--------|
| All deployed frontend changes committed | ✅ `0d6ffee` |
| Pushed to GitHub | ❌ auth failure |
| Local HEAD = GitHub HEAD | ❌ |
| Netlify bundle built from committed source | ✅ deploy `6a630941…` |
| Railway on backend commit `48c60fa` | ✅ deploy `8678b458…` |
| Tag `RELEASE-01` on release commit | ✅ local only |
| Artifact `RELEASE_LOCK_01.md` | ✅ this file |

**Return `SOURCE LOCKED` only after:** `git push origin main && git push origin RELEASE-01 --force` succeeds and `git rev-parse HEAD` equals `git ls-remote origin refs/heads/main | cut -f1`.

---

*Generated: 2026-07-24T06:42Z — RELEASE-LOCK-01*
