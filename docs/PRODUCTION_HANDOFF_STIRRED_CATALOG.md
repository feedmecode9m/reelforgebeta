# Production handoff — STIRRED Original Productions catalog

**Audience:** production deploy only. Do not assume local dev state matches production.

**Status:** Run at production cutover when STIRRED MP4 is uploaded and Series API is enabled.

---

## Known production issues to fix at deploy

These were observed on production and must be corrected by this handoff — **not** by copying Vic G assets onto STIRRED.

| Symptom | Wrong state | Correct state |
|---------|-------------|---------------|
| Browse / series poster | Vic G face poster (`vic-g-face-poster-power-of-support.png`) | STIRRED MP4 ingest still `/thumbs/{STIRRED_REEL_ID}.jpg` |
| Genre | Romance / missing | **Drama** |
| Description | `GATE_DESC_A` or empty | Creator synopsis from `Stirred.pdf` (below) |
| NLP / theme lines | `Themes detected: vic`, `This story highlights vic`, duplicate “Suggested theme…” | **Remove** — stale gate/fixture pollution; use creator metadata only |
| Legacy series row | `series-stirred-gate` in browser cache | Canonical **`series-stirred`** only |

### Poster rule (critical)

| Series | Poster source | Never use |
|--------|---------------|-----------|
| **Vic G** (`series-vic-g`) | `vic-g-face-poster-power-of-support.png` | STIRRED still |
| **STIRRED** (`series-stirred`) | **`/thumbs/{STIRRED_REEL_ID}.jpg`** from `MICROS STIRRED V1` | Vic G face poster |

If STIRRED shows the Power of Support artwork, re-run the seed script or PUT below with the STIRRED reel still path.

---

## Goal

STIRRED on viewer home **Original Productions** with:

- Canonical series `series-stirred` (not `series-stirred-gate`)
- Published `ep-stirred-s01e01` (S1 E1)
- Reel bound to production `MICROS STIRRED V1`
- Poster = **that reel’s own ingest still**
- Genre **Drama** + synopsis from creator PDFs

---

## Authoritative metadata (from creator files)

Source: `Stirred.pdf`, `STIRRED_Ep1_9x16_DP_Shot_List.pdf`, written by **Minaya Wright**.

| Field | Production value |
|-------|------------------|
| **Series title** | `STIRRED` |
| **Genre** | `Drama` |
| **Episode title** | `Episode 1` |
| **Series description** | STIRRED — an intimate vertical drama written by Minaya Wright. Billie (late 20s, talented, exhausted, magnetic) owns Billie's Café & Catering in Atlanta. Sid (30s, creatively talented sous-chef) is her best friend; Kevin (30s, handsome, emotionally unavailable) is her usual hook-up; Case (late 20s) is the first love she can't forget. Torn between Case's ghost and Sid's steady pull, Billie chases the event that could change everything — while old habits and sleepless nights keep pulling her back. Visual style: intimate, character-driven. Shot 9:16 vertical. |
| **Season description** | Billie's catering world in Atlanta — from the flashback that ended her first love with Case to the career-making event that could change everything. Episode 1 spans four scenes: apartment flashback montage, late-night van prep at Billie's Café & Catering with Sid, restless night with Kevin, and a dawn scramble when Billie wakes alone. Visual style: intimate, character-driven. 9:16 vertical. |
| **Episode description** | Written by Minaya Wright. Years after a painful breakup with her first love Case, chef Billie pours everything into Billie's Café & Catering in Atlanta. A flashback montage replays their final fight — Case insisting he gave her everything, Billie needing him to be present — before the title card: Several Years Later. On the eve of a career-making event, Billie loads the van late at night while sous-chef Sid brings coffee; their hands brush on the lock and something flickers. Back home she can't sleep — memories of Case swirl, then unexpectedly Sid's face. She lets Kevin in from a dating app; when dawn hits at 2:47 A.M. she jolts awake alone and races against the clock. Intimate, character-driven vertical drama. Aspect ratio 9:16. Camera: handheld for memory/chaos, stable for control, handheld for anxiety. |
| **Tags** | `STIRRED`, `Episode 1`, `drama`, `Atlanta`, `chef`, `catering`, `Billie's Café`, `vertical`, `9:16`, `character-driven`, `flashback`, `handheld`, `Billie`, `Sid`, `Case`, `Kevin`, `Minaya Wright`, `creator-confirmed`, `creator-package` |
| **Poster** | `/thumbs/{STIRRED_REEL_ID}.jpg` — from STIRRED MP4 ingest only |

Cast reference (for studio package / tags): Billie (chef), Sid (sous-chef), Kevin, Case.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| `REELFORGE_SERIES_API=true` | Required |
| Admin session | `POST /admin/auth` |
| STIRRED MP4 uploaded | Name typically `MICROS STIRRED V1`; UUID is **per environment** |
| Vic G deploy separate | See [PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md) |

---

## One-command seed (recommended)

```bash
cd frontend

# Replace with your live backend — NOT the literal placeholder "your-prod-host"
export REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app
export ADMIN_PASSWORD='your-real-admin-password'

# Production Postgres currently uses series-stirred-gate (legacy gate row):
export STIRRED_SERIES_ID=series-stirred-gate
export STIRRED_EPISODE_ID=ep-series-stirred-gate-s1e4

# Optional — omit to auto-discover MICROS STIRRED V1 from /api/reels
# export STIRRED_REEL_ID=3a3f2ab7-e8c9-4b36-b772-579c7f83a512

npm run seed:stirred-production-catalog
```

**Common failure:** `fetch failed` means `REELFORGE_API_BASE` is wrong (placeholder hostname, typo, or backend down). Test first:

```bash
curl -s "$REELFORGE_API_BASE/api/series/status"
```

The seed script:

- Sets genre **Drama**
- Forces poster to STIRRED reel still (never Vic G face poster)
- **Fails verify** if `series-stirred.poster` contains `vic-g-face-poster`

---

## Manual API sequence

### 1. Admin token + reel id

```bash
TOKEN=$(curl -s -X POST "$REELFORGE_API_BASE/admin/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .token)

curl -s "$REELFORGE_API_BASE/api/reels" | jq '.[] | select(.name|test("STIRRED";"i")) | {id,name,thumbnailPath}'
```

Set `REEL_ID` and `POSTER="/thumbs/${REEL_ID}.jpg"`.

**Assert poster is not Vic G:**

```bash
test "$POSTER" != "/thumbs/vic-g-face-poster-power-of-support.png" || exit 1
```

### 2. Upsert episode

```bash
curl -s -X POST "$REELFORGE_API_BASE/api/episodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
  \"seriesId\": \"series-stirred\",
  \"seasonNumber\": 1,
  \"episodeNumber\": 1,
  \"id\": \"ep-stirred-s01e01\",
  \"title\": \"Episode 1\",
  \"description\": \"Years after a painful breakup with her first love Case, chef Billie pours everything into Billie's Café & Catering in Atlanta. On the eve of a career-making event, late-night prep with sous-chef Sid sparks something new—until an old pattern returns and Billie wakes up alone, racing the clock. Intimate, character-driven vertical drama. Written by Minaya Wright.\",
  \"status\": \"published\",
  \"reelId\": \"$REEL_ID\",
  \"thumbnailUrl\": \"$POSTER\",
  \"genre\": \"Drama\",
  \"tags\": [\"creator-confirmed\",\"creator-package\",\"STIRRED\",\"Episode 1\",\"drama\",\"Atlanta\",\"chef\",\"catering\",\"vertical\",\"9:16\",\"Billie\",\"Sid\",\"Case\",\"Kevin\",\"Minaya Wright\"]
}"
```

### 3. Update series (restore STIRRED poster)

```bash
curl -s -X PUT "$REELFORGE_API_BASE/api/series/series-stirred" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
  \"title\": \"STIRRED\",
  \"description\": \"An intimate vertical drama following Billie, a talented late-20s chef and owner of Billie's Café & Catering in Atlanta. Torn between the ghost of her first love Case and the steady pull of her best friend Sid, Billie chases the event that could change everything—while old habits and sleepless nights keep pulling her back. Created by Minaya Wright. Shot 9:16. Visual style: intimate, character-driven.\",
  \"genre\": \"Drama\",
  \"poster\": \"$POSTER\",
  \"tags\": [\"creator-confirmed\",\"creator-package\",\"STIRRED\",\"drama\",\"Atlanta\",\"vertical\",\"Minaya Wright\"]
}"
```

### 4. Reel package category (Studio shelf)

Use **Suspense** as closest studio shelf for Drama (canonical shelves: Trending, Romance, Suspense, Cyber-Action):

```bash
curl -s -X PATCH "$REELFORGE_API_BASE/api/reels/${REEL_ID}/category" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"category":"Suspense"}'
```

In Video Vault → Edit package, set **Shelf category** to Suspense (or lock creator **Drama** genre on series row).

---

## Clear stale production pollution (browser / studio)

If production Studio or viewer still shows:

- `GATE_DESC_A`
- `Themes detected: vic`
- `This story highlights vic`
- `series-stirred-gate`

These come from **old validator fixtures** and **cross-franchise NLP bleed** (filename token “MICROS” / cached gate catalog), not canonical API.

**After API seed:**

1. Hard refresh production viewer + Smart Production Studio
2. Creator Catalog → select **STIRRED** (`series-stirred`) — not any “gate” row
3. Save episode + series metadata from this doc (overwrites `GATE_DESC_A`)
4. Video Vault → **MICROS STIRRED V1** → Edit package:
   - Title: `Episode 1`
   - Description: episode synopsis above
   - Tags: drama / STIRRED cast (no “vic”)
   - Shelf: Suspense (or creator-locked Drama on catalog)
   - **Save package**
5. If pollution persists in one browser: clear site localStorage keys `reelforge_series_metadata`, `reelforge_series_api_offline_cache` for production origin, then re-hydrate from API

**Do not** copy Vic G `series.poster` onto STIRRED during cleanup.

---

## Post-deploy verification

```bash
# Poster must be STIRRED still, not Vic G
curl -s "$REELFORGE_API_BASE/api/series/series-stirred" | jq '{title, genre, poster, ep: .seasons[0].episodes[0] | {title, genre, thumbnailUrl, reelId, status}}'

# Must NOT contain vic-g-face-poster
curl -s "$REELFORGE_API_BASE/api/series/series-stirred" | jq -e '.poster | test("vic-g-face-poster") | not'

cd frontend
REELFORGE_API_BASE=$REELFORGE_API_BASE npm run seed:stirred-production-catalog -- --verify-only
```

**Viewer checks (production):**

1. Original Productions → STIRRED card uses **STIRRED still**, not Power of Support face art
2. Vic G card still uses **Power of Support** face poster (separate deploy)
3. `/series/stirred` → title **STIRRED**, genre **Drama**, no `GATE_DESC_A`, no “vic” theme lines
4. Episode 1 synopsis matches `Stirred.pdf`

---

## Canonical IDs

| Entity | ID |
|--------|-----|
| Series | `series-stirred` |
| Season | `season-stirred-1` |
| Episode | `ep-stirred-s01e01` |
| Reel | Per environment — discover `MICROS STIRRED V1` |

**Retire:** `series-stirred-gate`, `GATE_DESC_A`, any STIRRED row pointing at Vic G poster.

---

## Do not mix with Vic G

- Vic G face poster is **only** for `series-vic-g` ([handoff doc](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md))
- STIRRED poster is **only** the STIRRED MP4 still (or future dedicated STIRRED key art uploaded to Thumbnail Vault)
- `01 ARRIVAL OPEN v1` and LA Production reels belong to **Vic G**, not STIRRED

---

## Related

- [PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md](./PRODUCTION_HANDOFF_VIC_G_FACE_POSTER.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- `frontend/scripts/seed-stirred-production-catalog.mjs`
