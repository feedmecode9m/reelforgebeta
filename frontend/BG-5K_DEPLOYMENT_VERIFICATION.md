# BG-5K — Deploy Production Guardrails

**Mission:** Deploy BG-5J to Railway and verify production diagnostics.  
**Date:** 2026-07-16  
**Result:** **PASS**

---

## Phase 1 — Repository State

### Git status (post-commit, pre-push)

```text
On branch main
Your branch is ahead of 'origin/main' by 3 commits.

Untracked files:
  frontend/BG-5H0_INDEPENDENT_VERIFICATION.md
  public/thumbs/*.jpg (local test artifacts)

nothing added to commit (BG-5J committed)
```

### Commit SHA (BG-5J)

```text
1635252aa41db557afb0d1bf610673187412d493
```

### Recent log

```text
1635252 feat: add production media durability guardrails (BG-5J)
22d2b7b revert: restore Debian 13 runtime image
0ad7120 fix: build backend as musl binary to remove glibc dependency
7fe7895 fix: use debian 13 runtime for railway glibc compatibility
5fd6f3d fix: align railway runtime glibc with backend binary
```

### BG-5J files present

| File | Status |
|------|--------|
| `backend/src/media_durability.rs` | ✅ committed |
| `backend/src/handlers.rs` | ✅ committed |
| `backend/src/main.rs` | ✅ committed |
| `backend/src/media_api.rs` | ✅ committed |
| `backend/src/lib.rs` | ✅ committed |
| `frontend/BG-5J_PRODUCTION_GUARDRAILS.md` | ✅ committed |

### Build verification

```text
cargo build --release -p backend
    Finished `release` profile [optimized] target(s)
```

✅ Backend builds successfully.

---

## Phase 2 — Deployment

### Method

Railway CLI (`railway up --detach`) as `budda9-techconda` from minimal deploy context `/tmp/reelforge-deploy` (1.4 MB — full repo upload timed out at ~92s).

**Note:** Git push to `railway-repo` (`feedmecode9m/reelforgebeta`) failed (no GitHub credentials in shell). Deployment used CLI upload, not Git-triggered deploy.

### Deploy attempts

| Deployment ID | Status | Notes |
|---------------|--------|-------|
| `ecb08c59-83d6-4508-bdaa-96bea39560b1` | FAILED | Full repo upload — CLI timeout |
| `66dff911-95da-4904-aed8-b73154603938` | REMOVED | Full repo upload — CLI timeout |
| `07094ae8-54f4-4bc2-987b-69d61a3b3f0a` | FAILED | Minimal context missing `tools/depgraph-check` workspace member |
| **`e48fbdb1-5cfc-4b1e-9f34-4b561115ad96`** | **SUCCESS** | BG-5J deployed |

### Successful deployment evidence

| Field | Value |
|-------|-------|
| **Deployed commit (source)** | `1635252` — BG-5J guardrails |
| **Deployment ID** | `e48fbdb1-5cfc-4b1e-9f34-4b561115ad96` |
| **Timestamp** | 2026-07-16 13:09:45 -04:00 |
| **Service** | `reelforge-deploy` |
| **URL** | https://reelforge-deploy-production.up.railway.app |
| **Volume** | `reelforge-deploy-volume` mounted at `/app/public` (0.1 GB / 4.9 GB) |
| **Build logs** | https://railway.com/project/919ff8a1-45dd-4ff3-bcbf-262d2bf34f25/service/bd43191f-eb62-4adf-a8fb-9dc7ce51d2bd?id=e48fbdb1-5cfc-4b1e-9f34-4b561115ad96 |

### Pre-deploy production baseline (old build)

```json
{
  "services": {
    "db": "connected",
    "storage": "ready",
    "ingestion": "enabled"
  }
}
```

No `storage_detail` — confirmed pre-BG-5J build.

---

## Phase 3 — Production Version Verification

### `GET /health` (post-deploy)

```json
{
  "status": "ok",
  "timestamp": 1784221936759,
  "service": "reelforge-backend",
  "database": "connected",
  "reels_source": "postgres-ingestion-v2",
  "services": {
    "db": "connected",
    "storage": "ready",
    "ingestion": "enabled",
    "storage_detail": {
      "media_root": "/app/public",
      "videos_path": "/app/public/videos",
      "thumbs_path": "/app/public/thumbs",
      "writable": true,
      "volume_mounted": true,
      "ephemeral_storage_risk": false
    }
  }
}
```

### BG-5J contract verification

| Field | Present | Value |
|-------|---------|-------|
| `services.storage` | ✅ | `"ready"` (computed, not static) |
| `services.storage_detail` | ✅ | object |
| `storage_detail.media_root` | ✅ | `/app/public` |
| `storage_detail.volume_mounted` | ✅ | `true` |
| `storage_detail.ephemeral_storage_risk` | ✅ | `false` |

**Observed production version:** BG-5J guardrails active. Old static health contract replaced.

---

## Phase 4 — Diagnostics Verification

### `GET /api/media/storage`

```json
{
  "source": "postgres",
  "videos_count": 2,
  "thumbnails_count": 2,
  "invalid_videos_count": 0,
  "filesystem": {
    "videos": 0,
    "thumbnails": 0
  },
  "inventory": {
    "db_video_count": 2,
    "db_thumb_count": 2,
    "filesystem_video_count": 0,
    "filesystem_thumb_count": 0,
    "missing_videos": [
      "66598368-3fba-41bf-847c-68dd8f41be86.mp4",
      "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
    ],
    "missing_thumbs": [
      "66598368-3fba-41bf-847c-68dd8f41be86.jpg",
      "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
    ],
    "orphan_videos": [],
    "orphan_thumbs": [],
    "split_brain": true
  }
}
```

✅ Responds successfully. Additive fields present. Existing `videos`/`thumbnails` arrays preserved.

### `GET /api/media/storage/diagnostics`

```json
{
  "checked_at": 1784221938260,
  "db_video_count": 2,
  "db_thumb_count": 2,
  "filesystem_video_count": 0,
  "filesystem_thumb_count": 0,
  "split_brain_detected": true,
  "video_mismatches": 2,
  "thumb_mismatches": 2,
  "db_videos_missing_files": [
    "66598368-3fba-41bf-847c-68dd8f41be86.mp4",
    "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
  ],
  "db_thumbs_missing_files": [
    "66598368-3fba-41bf-847c-68dd8f41be86.jpg",
    "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
  ],
  "orphan_videos": [],
  "orphan_thumbs": [],
  "storage": {
    "status": "ready",
    "media_root": "/app/public",
    "volume_mounted": true,
    "ephemeral_storage_risk": false,
    "writable": true,
    "filesystem_video_count": 0,
    "filesystem_thumb_count": 0
  }
}
```

✅ Diagnostics endpoint exists and responds. Pre-deploy this route would 404.

---

## Phase 5 — Expected State Assessment

### Infrastructure discovered at deploy time

Railway volume **is already attached**:

```text
reelforge-deploy-volume · /app/public · 0.1 GB / 4.9 GB
```

Therefore production reports:

| Field | Observed | Expected (volume attached) |
|-------|----------|----------------------------|
| `storage` | `ready` | ✅ |
| `volume_mounted` | `true` | ✅ |
| `ephemeral_storage_risk` | `false` | ✅ |

### Split-brain (catalog vs disk)

| Field | Observed |
|-------|----------|
| `split_brain_detected` | `true` |
| DB counts | 2 videos, 2 thumbs |
| Filesystem counts | 0 videos, 0 thumbs |
| Missing files | 2 DB videos + 2 DB thumbs have no on-disk files |
| Orphans | none |

**Classification:** Infrastructure/data gap — **not a software failure**. Postgres catalog retained reel rows; volume is mounted but media files were never restored to `/app/public`. BG-5J correctly surfaces this divergence instead of masking it.

If volume had **not** been attached, expected state would be `storage: "mounted"`, `volume_mounted: false`, `ephemeral_storage_risk: true` — also PASS.

---

## PASS Criteria

| Criterion | Result |
|-----------|--------|
| Production running BG-5J | ✅ `storage_detail` + diagnostics endpoint |
| New health fields visible | ✅ |
| Diagnostics endpoint exists | ✅ `/api/media/storage/diagnostics` |
| Storage state matches reality | ✅ volume mounted, writable, empty filesystem reported |
| No application code changes in this mission | ✅ deploy/verify only |

---

## Verdict: **PASS**

BG-5J guardrails are live on Railway production (`e48fbdb1`). Diagnostics accurately report:

- Persistent volume mounted at `/app/public`
- Writable storage
- Split-brain: 2 DB reels with zero matching files on disk

---

## Recommended Next Steps (BG-5K follow-on)

1. **Restore media** to `/app/public/videos` and `/app/public/thumbs` (or re-upload via production UI).
2. **Re-check diagnostics** — expect `split_brain_detected: false` once files match catalog.
3. **Push commit `1635252`** to `origin` and `railway-repo` when GitHub credentials are available (keeps Git and CLI deploy in sync).
4. **Fresh upload + persistence test** (Phase 4–5 from prior plan) before UI validation.

---

## Remaining Operational Notes

- Full-repo `railway up` from project root times out (~92s upload). Use minimal deploy context or add root `.railwayignore` to exclude `target/`, `frontend/`, artifacts.
- Commit `1635252` is local-only; Railway production was updated via CLI, not Git webhook.
