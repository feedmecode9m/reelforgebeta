# BG-5J — Production Media Durability Guardrails

**Mission:** Prevent a healthy database from masking missing production media.  
**Status:** **PASS** (implementation complete; deploy to Railway pending)  
**Date:** 2026-07-16

---

## Implementation Summary

Operational guardrails were added without changing upload architecture, Reel contract, UUID identity, database schema, ingestion pipeline, frontend behavior, or storage providers.

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 — Startup storage verification | Probes `/app/public`, `/app/public/videos`, `/app/public/thumbs` for exists/readable/writable; structured startup log | ✅ |
| 2 — Storage health | `/health` returns accurate `services.storage` state + `storage_detail` diagnostics | ✅ |
| 3 — Media inventory accuracy | `/api/media/storage` adds `inventory` + `filesystem` alongside existing DB-backed lists | ✅ |
| 4 — Split-brain detection | Startup log + `GET /api/media/storage/diagnostics` structured report; no auto-repair | ✅ |
| 5 — Deployment diagnostics | One-shot startup banner with paths, `MEDIA_PUBLIC_BASE`, mount status, counts | ✅ |
| 6 — Validation | Local release binary + Postgres; unit tests; Railway pre-deploy baseline captured | ✅ |

New module: `backend/src/media_durability.rs` — all guardrail logic centralized here.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/media_durability.rs` | **New** — directory probes, storage status, split-brain compare, startup logging |
| `backend/src/main.rs` | Startup verification + split-brain check; route `/api/media/storage/diagnostics` |
| `backend/src/handlers.rs` | `/health` uses live storage diagnostics instead of hardcoded `"ready"` |
| `backend/src/media_api.rs` | Extended `MediaStorageResponse`; new `media_storage_diagnostics` handler |
| `backend/src/lib.rs` | Export `media_durability` module |

**Unchanged:** `ingestion/*`, `reel_contract.rs`, `db/*` schema/migrations, frontend, Dockerfile layout, `docker-compose.yml`.

---

## Storage Status Semantics

| State | Meaning |
|-------|---------|
| `ready` | All directories exist, readable, writable; persistent volume detected (or non-production) |
| `mounted` | Directories operational but **no persistent volume** on production — ephemeral risk |
| `read_only` | Directory exists and is readable but write probe failed |
| `missing` | Required directory does not exist |
| `unwritable` | Directory exists but is not writable |
| `degraded` | Mixed directory failures (e.g. readable root but broken subdirectory) |

Production without a Railway volume at `/app/public` surfaces as **`mounted`** + `ephemeral_storage_risk: true`.

---

## Startup Diagnostics Example

Captured from local release run against Docker Compose Postgres (2026-07-16):

```text
═══════════════════════════════════════════════════════════
📦 MEDIA STORAGE STARTUP DIAGNOSTICS (BG-5J)
═══════════════════════════════════════════════════════════
  media_root:          /home/youloose2dafish/projects/reelforge/public
  MEDIA_PUBLIC_BASE:   http://localhost:8080
  videos_path:         /home/youloose2dafish/projects/reelforge/public/videos
  thumbs_path:         /home/youloose2dafish/projects/reelforge/public/thumbs
  storage_status:      ready
  volume_mounted:      true
  ephemeral_risk:      false
  writable:            true
  filesystem_counts:   3 videos, 10 thumbs
  [OK] media_root — exists=true readable=true writable=true
  [OK] videos — exists=true readable=true writable=true
  [OK] thumbs — exists=true readable=true writable=true
───────────────────────────────────────────────────────────
  SPLIT-BRAIN CHECK:
    DB:         34 videos, 34 thumbs
    Filesystem: 3 videos, 10 thumbs
    ❌ SPLIT-BRAIN DETECTED
    DB videos missing files (34): [...]
⚠️  STORAGE WARNING: Split-brain detected: 34 DB videos missing files, ...
✅ Storage startup verification complete
═══════════════════════════════════════════════════════════
```

On Railway **without** a volume, expect:

```text
  storage_status:      mounted
  volume_mounted:      false
  ephemeral_risk:      true
⚠️  STORAGE EPHEMERAL — attach Railway volume at /app/public for durable media
```

Backend **does not panic** on storage warnings — it logs loudly and continues (upload worker and API remain available for diagnosis).

---

## Health Endpoint Example

`GET /health` (local, post-implementation):

```json
{
  "status": "ok",
  "timestamp": 1784220384195,
  "service": "reelforge-backend",
  "database": "connected",
  "reels_source": "postgres-ingestion-v2",
  "services": {
    "db": "connected",
    "storage": "ready",
    "ingestion": "enabled",
    "storage_detail": {
      "media_root": "/home/youloose2dafish/projects/reelforge/public",
      "videos_path": "/home/youloose2dafish/projects/reelforge/public/videos",
      "thumbs_path": "/home/youloose2dafish/projects/reelforge/public/thumbs",
      "writable": true,
      "volume_mounted": true,
      "ephemeral_storage_risk": false
    }
  }
}
```

When storage is broken, top-level `"status"` becomes `"degraded"` while still returning HTTP 200 (Railway healthcheck remains reachable for diagnosis).

**Pre-deploy Railway baseline** (old code, 2026-07-16): `"storage": "ready"` always — confirms the bug this mission fixes.

---

## Storage Report Example

`GET /api/media/storage` — **existing fields preserved** (`videos`, `thumbnails`, `invalid_videos` still DB-backed when Postgres is up):

```json
{
  "videos": ["6719d3e7-ebeb-40a3-bc40-50e7ee804303.mov", "..."],
  "thumbnails": ["6e420f7b-3ee4-42a4-8989-eecfcc2de1a2.jpg", "..."],
  "invalid_videos": [],
  "source": "postgres",
  "filesystem": {
    "videos": ["6719d3e7-ebeb-40a3-bc40-50e7ee804303.mov", "cb92a4d9-0b8e-49ba-a70e-4976bd05ce66.mp4", "d27e9a23-a579-4171-93eb-7b8297bdb3f1.mp4"],
    "thumbnails": ["6080d8f2-e51b-4aea-9912-27166ca74dee.jpg", "..."]
  },
  "inventory": {
    "db_video_count": 37,
    "db_thumb_count": 37,
    "filesystem_video_count": 3,
    "filesystem_thumb_count": 13,
    "missing_videos": ["2e688948-fdc7-4780-b32b-e03a9fd3d1dd.mp4", "..."],
    "missing_thumbs": ["2e688948-fdc7-4780-b32b-e03a9fd3d1dd.jpg", "..."],
    "orphan_videos": [],
    "orphan_thumbs": ["6080d8f2-e51b-4aea-9912-27166ca74dee.jpg", "..."],
    "split_brain": true
  }
}
```

Frontend `fetchMediaStorage()` ignores new fields — **no frontend changes required**.

---

## Split-Brain Report Example

`GET /api/media/storage/diagnostics`:

```json
{
  "checked_at": 1784220387192,
  "db_video_count": 37,
  "db_thumb_count": 37,
  "filesystem_video_count": 3,
  "filesystem_thumb_count": 13,
  "db_videos_missing_files": ["2e688948-fdc7-4780-b32b-e03a9fd3d1dd.mp4"],
  "db_thumbs_missing_files": ["2e688948-fdc7-4780-b32b-e03a9fd3d1dd.jpg"],
  "orphan_videos": [],
  "orphan_thumbs": ["6080d8f2-e51b-4aea-9912-27166ca74dee.jpg"],
  "video_mismatches": 34,
  "thumb_mismatches": 44,
  "split_brain_detected": true,
  "storage": {
    "status": "ready",
    "media_root": "/home/youloose2dafish/projects/reelforge/public",
    "videos_path": ".../public/videos",
    "thumbs_path": ".../public/thumbs",
    "media_public_base": "http://localhost:8080",
    "volume_mounted": true,
    "ephemeral_storage_risk": false,
    "writable": true,
    "filesystem_video_count": 3,
    "filesystem_thumb_count": 13,
    "directories": [
      { "label": "media_root", "path": "...", "exists": true, "readable": true, "writable": true }
    ]
  }
}
```

No automatic deletion or repair is performed.

---

## Validation Results

| Environment | Test | Result |
|-------------|------|--------|
| **Unit tests** | `cargo test -p backend media_durability` | ✅ 2/2 passed |
| **Local release** | `cargo build --release -p backend` | ✅ compiles |
| **Local runtime** | Postgres via `docker compose up -d db`; backend on `:8080` | ✅ startup diagnostics, health, storage, diagnostics endpoints |
| **Docker Compose** | `docker compose build backend` | ⏳ Same Dockerfile as Railway; local `cargo` build validates source (full image build is slow) |
| **Railway (live)** | Pre-deploy `/health` still shows hardcoded `"ready"` | ⚠️ Expected until this commit is deployed |

### API contract regression check

| Endpoint | Contract | Result |
|----------|----------|--------|
| `GET /api/reels` | Unchanged | ✅ |
| `POST /api/reels` | Unchanged | ✅ |
| `GET /api/media/storage` | `videos`, `thumbnails`, `invalid_videos` preserved | ✅ additive fields only |
| `GET /health` | Same shape; `storage` now accurate; `storage_detail` added | ✅ additive |
| Upload pipeline | No code touched | ✅ |

---

## PASS Criteria

| Criterion | Met |
|-----------|-----|
| Existing upload pipeline unchanged | ✅ |
| Existing API contract unchanged (additive only) | ✅ |
| Frontend requires no changes | ✅ |
| Storage failures immediately observable | ✅ startup log + health + inventory |
| DB/filesystem divergence detectable without manual investigation | ✅ split-brain at startup + `/api/media/storage/diagnostics` |
| Future Railway deployments cannot silently lose media without diagnostics | ✅ `mounted` + `ephemeral_storage_risk` + split-brain warnings |

---

## Remaining Risks

1. **Deploy gap** — Guardrails take effect only after Railway redeploy. Until then, production still reports `"storage": "ready"`.
2. **Volume not in `railway.toml`** — Persistent volume must still be attached manually in Railway UI at `/app/public` (BG-5I scope).
3. **`import-prod.sh` default path** — Script defaults to `/var/lib/reelforge/public`; operators on Railway must use `MEDIA_ROOT=/app/public`.
4. **Health still HTTP 200 when degraded** — Intentional so Railway healthcheck passes and operators can inspect JSON; consider alerting on `services.storage != "ready"` or `inventory.split_brain == true`.
5. **Mount detection heuristic** — Uses `/proc/mounts`; accurate on Linux/Railway containers but may report `volume_mounted: false` on some local dev bind mounts (cosmetic only in dev).

---

## Next Steps

1. **Deploy** this backend to Railway (`reelforge-deploy`).
2. **Attach** persistent volume at `/app/public` and restore media files.
3. **Verify** post-deploy: `/health` shows `storage: "ready"` + `volume_mounted: true`; `/api/media/storage/diagnostics` shows `split_brain_detected: false`.
4. **Resume** end-to-end UI testing (MP4 Vault, Hero Background, batch delete) with confidence that infrastructure issues surface in logs and API rather than masking application behavior.
