# Production handoff — Vic G face poster (Original Productions)

**Status:** Applied in local dev (2026-09-03). Replicate in production when promoting Vic G to the home **Original Productions** row.

## Intent

On the home browse row, **Vic G** shows a **face poster** in front with **episode cards stacked behind** (multi-episode production). The face art is the official **Power of Support** key art — not an MP4 ingest still.

| Surface | Behavior |
|---------|----------|
| **Series poster** (`series.poster`) | Face card — authoritative for browse + Original Productions |
| **Episode posters** (`episode.thumbnailUrl`) | Individual episode stills behind the stack (unchanged) |
| **Stack depth** | Driven by published episode count + related material collapse (`stackLayers` in `SeriesBrowsePosterCard`) |

## Canonical asset (dev)

| Field | Value |
|-------|--------|
| **Source file (creator)** | `974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4(1).png` |
| **Deployed thumb path** | `/thumbs/vic-g-face-poster-power-of-support.png` |
| **Series ID** | `series-vic-g` |
| **Aspect** | 941×1672 PNG (9:16-style vertical key art) |
| **Artwork title on poster** | *Power of Support* — 7-part micro doc series (Vic G center) |

Keep the creator PNG in release assets; production deploy copies it to the media thumbs directory under the stable filename above.

## Prerequisites (production)

| Requirement | Notes |
|-------------|--------|
| `REELFORGE_SERIES_API=true` | Series API enabled |
| Admin session | `POST /admin/auth` |
| Media thumbs writable | `public/thumbs/` (or `MEDIA_ROOT/thumbs/`) |
| Vic G episodes published | Stack layers need ≥1 discoverable episode |

## Deploy steps

### 1. Copy face poster to media root

```bash
# From repo root — adjust MEDIA_ROOT if overridden in prod
cp /path/to/974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4\(1\).png \
   public/thumbs/vic-g-face-poster-power-of-support.png
```

Or upload the same file via Thumbnail Vault and note the resulting `/thumbs/…` URL (prefer the stable filename for repeatability).

### 2. Set series poster via API

```bash
TOKEN=$(curl -s -X POST "$REELFORGE_API_BASE/admin/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .token)

curl -s -X PUT "$REELFORGE_API_BASE/api/series/series-vic-g" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Vic G",
    "description": "Production moves to the soundstage as the studio shoot gets underway and the team'\''s performance, camera, and lighting work start coming together.",
    "poster": "/thumbs/vic-g-face-poster-power-of-support.png",
    "tags": ["creator-package", "creator-confirmed"]
  }'
```

### 3. Studio UI mirror (optional)

Smart Production Studio → **Creator Catalog → Vic G → Series metadata → Series artwork URL**:

```
/thumbs/vic-g-face-poster-power-of-support.png
```

Save series. Episode-level posters stay on their own rows — do **not** replace episode `thumbnailUrl` with the face poster.

## One-command seed (dev / prod)

```bash
cd frontend
REELFORGE_API_BASE=https://your-host \
VIC_G_FACE_POSTER_SOURCE=/path/to/974F90F4-3D3D-4EE6-BE38-45E2FFC0D5B4(1).png \
ADMIN_PASSWORD=... \
npm run seed:vic-g-face-poster
```

## Verification

```bash
# API
curl -s "$REELFORGE_API_BASE/api/series/series-vic-g" | jq '{title, poster, episodes: .seasons[0].episodes|length}'

# Browse projection
cd frontend && REELFORGE_API_BASE=$REELFORGE_API_BASE npm run seed:vic-g-face-poster -- --verify-only
```

**Viewer checks:**

1. Home → **Original Productions** → Vic G card shows Power of Support face art
2. Episode stack visible behind face when multiple episodes are published
3. `/series/vic-g` series page — episodes retain their own posters; series hero uses face poster when set at series level

## Do not confuse with episode posters

| Layer | Field | Vic G value |
|-------|--------|-------------|
| **Face (browse front)** | `series.poster` | `vic-g-face-poster-power-of-support.png` |
| **Episode stills (stack / shelves)** | `episode.thumbnailUrl` | Per-episode MP4 still or Thumbnail Vault assign |

Setting face art on `series.poster` does not change Theater playback or reel binding.

**Production isolation:** Vic G face poster is **only** for `series-vic-g`. STIRRED (`series-stirred`) must use its own MP4 still — see [PRODUCTION_HANDOFF_STIRRED_CATALOG.md](./PRODUCTION_HANDOFF_STIRRED_CATALOG.md). If STIRRED shows Power of Support art, that is a misconfiguration to fix at deploy.

## Related

- [PRODUCTION_HANDOFF_STIRRED_CATALOG.md](./PRODUCTION_HANDOFF_STIRRED_CATALOG.md) — STIRRED home row seed
- [DEPLOYMENT.md](./DEPLOYMENT.md) — general deploy
- `frontend/src/lib/series/vicGSeriesPackage.js` — canonical episode reel bindings
- `frontend/src/components/series/SeriesBrowsePosterCard.svelte` — face + stack UI
