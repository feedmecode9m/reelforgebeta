# Pre-deploy checklist

Run this list **in order** before every production release.  
Production backend: `https://reelforge-deploy-production.up.railway.app`  
Production frontend (historical): `https://strong-lolly-a9fcb4.netlify.app`

**Never use placeholder URLs** like `your-prod-host` — they cause `fetch failed`.

Test connectivity first:

```bash
curl -s https://reelforge-deploy-production.up.railway.app/api/series/status
```

---

## Phase A — Code ready (merge before deploy)

### A1. Mobile Theater: pure-gesture only (production)

Per `.cursor/rules/mobile-theater-production-guardrails.mdc`, production mobile Theater must be **gesture-first** — no bottom playback dock.

| Item | Required at deploy | Current note |
|------|-------------------|--------------|
| Remove bottom **Play / Pause / Mute pill** (`.theater-mobile-controls`) on mobile portrait | ✅ Must ship | Still in `TheaterExperience.svelte` — **remove before prod deploy** |
| Single tap on video → play/pause | ✅ Keep | `handleTheaterVideoInteraction` + wrapper gestures |
| Double tap left/right → ±10s seek | ✅ Keep | Landscape + gesture handlers |
| Double tap center → mute/unmute | ✅ Keep | Per guardrails |
| Horizontal slide → scrub | ✅ Keep | Per guardrails |
| Native `<video controls>` off on mobile | ✅ Keep | `controls={!isMobileTheater}` |
| **No** side-docked episode rail on mobile | ✅ Keep | `seriesDrawerDocked = !isMobileTheater` |
| **No** auto-open All Episodes overlay on mobile Watch Now | ✅ Keep | `heroCtaSuppressAutoOpen` |
| **No** center progress ring / timeline dots on mobile theater | ✅ Must verify | Disable via publishing profile or gate `ReelshortExperience` `theater-chrome` on mobile |
| **No** bottom CLOSE THEATER / meta panel on mobile | ✅ Keep | Already gated with `!isMobileTheater` |
| Episodes via header **All Episodes** button only (explicit open) | ✅ Keep | User opens drawer deliberately |

**Pre-deploy code gate:** merge PR that removes `.theater-mobile-controls` block and relies on pure-gesture layer only.

**Phone verify (required):**

1. Open Theater on iPhone/Android portrait — **no bottom dock**
2. Tap video → play/pause works
3. Landscape → gesture hints only, no dock
4. All Episodes opens from header, not auto-blocking video
5. Run: `npm run validate:mobile-presentation` and `npm run validate:mobile-experience-hardening`

---

## Phase B — Infrastructure & build

- [ ] `REELFORGE_SERIES_API=true` on production backend
- [ ] `MEDIA_PUBLIC_BASE` = production HTTPS origin
- [ ] `REELFORGE_CORS_ORIGINS` includes live frontend hostname
- [ ] `ADMIN_PASSWORD` set (real secret — not `admin123`)
- [ ] Frontend built with `VITE_BACKEND_URL=https://reelforge-deploy-production.up.railway.app`
- [ ] Postgres migrated if promoting from dev (`export-dev.sh` → `import-prod.sh`)
- [ ] `./backend/scripts/post-deploy-verify.sh` passes after backend up

---

## Phase C — Media on production

- [ ] Vic G episode MP4s uploaded and playable
- [ ] STIRRED MP4 uploaded — `MICROS STIRRED V1` (note reel UUID from `/api/reels`)
- [ ] Vic G face poster PNG available: `974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4(1).png`
- [ ] STIRRED creator PDFs on file: `Stirred.pdf`, `STIRRED_Ep1_9x16_DP_Shot_List.pdf`

---

## Phase D — Vic G catalog (face poster + stack)

**Doc:** [PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md)

- [ ] Copy PNG → `public/thumbs/vic-g-face-poster-power-of-support.png`
- [ ] Run seed:

```bash
cd frontend
export REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app
export ADMIN_PASSWORD='YOUR_REAL_PASSWORD'
export VIC_G_FACE_POSTER_SOURCE='/path/to/974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4(1).png'
npm run seed:vic-g-face-poster
```

- [ ] Verify: `series-vic-g.poster` = `/thumbs/vic-g-face-poster-power-of-support.png`
- [ ] Verify: episode `thumbnailUrl` values **unchanged** (stack behind face)

---

## Phase E — STIRRED catalog (poster + Drama metadata)

**Doc:** [PRODUCTION_HANDOFF_STIRRED_CATALOG.md](./PRODUCTION_HANDOFF_STIRRED_CATALOG.md)

Production today may show **wrong state** — fix at deploy:

| Wrong | Correct |
|-------|---------|
| Vic G face poster on STIRRED | STIRRED MP4 still `/thumbs/{REEL_ID}.jpg` |
| `GATE_DESC_A` description | Synopsis from `Stirred.pdf` |
| Romance / missing genre | **Drama** |
| `Themes detected: vic` NLP lines | Removed — creator metadata only |
| Stale `series-stirred-gate` pollution | Updated via seed below |

- [ ] Run seed (production uses gate series IDs):

```bash
cd frontend
export REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app
export ADMIN_PASSWORD='YOUR_REAL_PASSWORD'
export STIRRED_SERIES_ID=series-stirred-gate
export STIRRED_EPISODE_ID=ep-series-stirred-gate-s1e4
npm run seed:stirred-production-catalog
```

- [ ] Verify poster is **not** Vic G:

```bash
curl -s "$REELFORGE_API_BASE/api/series/series-stirred-gate" | jq '{title, genre, poster, description}'
```

- [ ] Verify-only:

```bash
REELFORGE_API_BASE=$REELFORGE_API_BASE npm run seed:stirred-production-catalog -- --verify-only
```

### Poster isolation (critical)

| Series | Poster |
|--------|--------|
| Vic G | `vic-g-face-poster-power-of-support.png` only |
| STIRRED | STIRRED reel still only — **never** Vic G art |

---

## Phase F — Studio cleanup (if NLP pollution persists)

After API seed, on production Smart Production Studio:

- [ ] Creator Catalog → STIRRED → Drama + real synopsis (no `GATE_DESC_A`)
- [ ] Video Vault → MICROS STIRRED V1 → Edit package → Save (no “vic” tags)
- [ ] If one browser still shows gate junk: clear `reelforge_series_metadata` + `reelforge_series_api_offline_cache`, hard refresh

---

## Phase G — Viewer acceptance (production)

### Home / catalog

- [ ] Original Productions shows **Vic G** (Power of Support face) **and** **STIRRED** (own still)
- [ ] `/series/vic-g` and `/series/stirred` load with correct posters, genre, synopsis
- [ ] STIRRED Episode 1 playable

### Mobile Theater (after Phase A code ships)

- [ ] Portrait: pure gestures only — **no bottom dock**
- [ ] Tap video play/pause reliable on iOS
- [ ] Landscape fills screen; gesture hints only
- [ ] All Episodes does not auto-cover video on Watch Now

### Desktop Theater

- [ ] Side-docked episode rail OK on desktop/wide canvas only
- [ ] Vic G stack + STIRRED browse cards correct

---

## Phase H — Validation commands (run from `frontend/`)

```bash
npm run validate:mobile-presentation
npm run validate:mobile-experience-hardening
npm run validate:viewer-production-projection
npm run validate:viewer-series-browse-catalog
REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app \
  npm run seed:vic-g-face-poster -- --verify-only
REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app \
  npm run seed:stirred-production-catalog -- --verify-only
```

---

## Quick reference — production seeds

```bash
export REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app
export ADMIN_PASSWORD='…'

# Vic G
VIC_G_FACE_POSTER_SOURCE='/path/to/poster.png' npm run seed:vic-g-face-poster

# STIRRED
STIRRED_SERIES_ID=series-stirred-gate \
STIRRED_EPISODE_ID=ep-series-stirred-gate-s1e4 \
npm run seed:stirred-production-catalog
```

---

## Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md)
- [PRODUCTION_HANDOFF_STIRRED_CATALOG.md](./PRODUCTION_HANDOFF_STIRRED_CATALOG.md)
- `.cursor/rules/mobile-theater-production-guardrails.mdc`
