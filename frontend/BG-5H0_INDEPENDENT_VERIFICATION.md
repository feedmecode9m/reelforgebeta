# BG-5H.0 — Independent Infrastructure Verification

**Date:** 2026-07-15  
**Mode:** Read-only forensic inspection from repository source  
**Scope:** Independent verification of BG-5E, BG-5F, BG-5G conclusions  
**Code changes:** None

---

## Executive Summary

Independent source-code inspection **confirms** the core thesis of prior audits:

| Claim | Verified? | Evidence |
|-------|-----------|----------|
| Upload pipeline writes to a single local tree under `./public` | **Yes** | `main.rs:213-221`, `upload.rs:58-60,340-341`, `worker.rs:81,108-109` |
| No Rust env var overrides disk root | **Yes** | Only `PathBuf::from("./public")` at `main.rs:213` |
| DB stores relative paths for ingestion-v2 uploads | **Yes** | `upload.rs:79,87,352,366-367`; `insert_pending_reel` binds raw strings `db/reels.rs:49-50` |
| `url` / `thumbnailUrl` absolutized at serialization | **Yes** | `reel_contract.rs:102-118`, `db/mod.rs:141-156` |
| `thumbnailPath` is DB passthrough (relative) | **Yes** | `reel_contract.rs:118` |
| Static serve uses same injected paths | **Yes** | `video_stream.rs:172,192` |
| Railway Dockerfile expects `/app/public` | **Yes** | `Dockerfile:21,32`; `WORKDIR /app` |
| `railway.toml` defines **no** persistent volume | **Yes** | `railway.toml:1-17` (build/deploy only) |
| Production media 404 with DB catalog intact | **Yes** (live probe) | `thumbnailPath: /thumbs/...` + HTTP 404 on `/videos/{uuid}.mp4` |

**Primary failure mode:** Postgres is durable (managed). Container filesystem at `/app/public` is **ephemeral** unless a Railway volume is attached at that mount. Upload, worker, and static-serve code are already volume-ready; **no application path mismatch** was found.

**Nuances (not disproving core thesis):**
- `import-prod.sh` defaults `MEDIA_ROOT=/var/lib/reelforge/public` — ops script path differs from container `/app/public` (`import-prod.sh:18`)
- `/api/media/storage` lists DB references, not filesystem inventory (`media_api.rs:462-467`)
- `/health` always reports `storage: "ready"` (`handlers.rs:113`)
- `backend/seed.sql` can insert absolute external URLs — legacy demo only, not ingestion-v2 path
- `utils.rs` contains unused Supabase stub — not invoked by upload pipeline

### Confidence Level

**PARTIAL PASS**

Core storage architecture and ephemeral-filesystem diagnosis are **confirmed from source**. Operational Railway volume absence is **inferred** (not declared in repo) but strongly supported by `railway.toml`, docker-compose reference pattern, and live 404 behavior. Tooling/documentation inconsistencies prevent full **PASS**.

---

## Call Graphs

### Phase 1 — Upload Path (`POST /api/reels`)

#### Route registration

```
main.rs:315
  .route("/reels", web::post().to(handlers::create_reel))
```

#### Video upload path

```
handlers::create_reel                    handlers.rs:139-191
  args: Multipart, VideosDir, ThumbsDir, PgPool, db_available, EventBus
  if !db_available → IngestionService::require_db_response()     :182
  svc = IngestionService::new(pool, videos, thumbs, event_bus) :185-190
  return upload::ingest_from_reel_multipart(&svc, &mut payload) :191

ingestion::IngestionService::new         ingestion/mod.rs:29-38
  config.videos_path = videos.0           :33
  config.thumbs_path = thumbs.0           :34
  config.media_base = db::media_public_base()  :35  [URL only, not disk]

upload::ingest_from_reel_multipart       upload.rs:213-305
  form = media_api::parse_reel_multipart(payload)  :225
  if form.video → ingest_video_bytes(...)         :262-280
  else if form.thumbnail → ingest_image_only(...) :284-293

upload::ingest_video_bytes               upload.rs:26-211
  asset_id = Uuid::new_v4()                :48
  stored_name = "{uuid}{ext}"              :49
  video_path = svc.config.videos_path.join(&stored_name)  :58
  std::fs::write(&video_path, bytes)       :60  ← VIDEO BYTES TO DISK
  video_url = format!("/videos/{}", stored_name)  :79
  [optional] thumb_path = thumbs_path.join("{uuid}.jpg")  :85
             std::fs::write(&thumb_path, &thumb_bytes)   :86  ← THUMB BYTES TO DISK
  reels::insert_pending_reel(..., &video_url, thumb_url, &stored_name, ...)  :107-118
  if needs_thumb_job → jobs::enqueue(asset_id)           :154
  else → reels::mark_ready(asset_id, thumb_url)          :170
  response: canonical_media_url(video_url) [absolute URL in JSON only]  :187-208

ingestion::worker::run_worker            worker.rs:16-40
  spawned main.rs:276 with videos_path.clone(), thumbs_path.clone()

worker::process_one                      worker.rs:42-181
  video_path = videos_path.join(&file_name)   :81
  thumb_path = thumbs_path.join("{reel_id}.jpg")  :108
  ffmpeg::extract_thumbnail_at_1s(&video_path, &thumb_path)  :111
  reels::mark_ready(pool, reel.id, &thumb_url)  :113  [thumb_url = "/thumbs/{id}.jpg" :109]

db::reels::insert_pending_reel           db/reels.rs:25-56
  INSERT video_url=$5, thumbnail_url=$6, file_name=$7, status='pending'  :39-42

db::reels::mark_ready                    db/reels.rs:96-108
  UPDATE status='ready', validated=true, thumbnail_url=$2  :99-101
```

#### Image-only upload path

```
upload::ingest_image_only                upload.rs:307-420
  thumb_path = svc.config.thumbs_path.join(&stored_name)  :340
  std::fs::write(&thumb_path, bytes)       :341  ← IMAGE TO DISK
  thumb_url = format!("/thumbs/{}", stored_name)  :352
  insert_pending_reel(..., &thumb_url, Some(&thumb_url), ...)  :360-371
  mark_ready(asset_id, &thumb_url)         :379
```

#### Phase 1 answers

| Question | Answer | Citation |
|----------|--------|----------|
| Where is video written? | `{videos_path}/{uuid}.mp4` → `/app/public/videos/{uuid}.mp4` | `upload.rs:58-60` |
| Where is thumbnail written? | `{thumbs_path}/{uuid}.jpg/png/...` or worker `{id}.jpg` | `upload.rs:85-86,340-341`, `worker.rs:108-111` |
| Env override for disk paths? | **No** | `main.rs:213` hardcoded |
| Symbolic links? | **No** | No `read_link` / symlink API in upload path |
| Temp files moved to final? | **No** — direct `std::fs::write` to final path | `upload.rs:60,86,341` |
| Second storage location? | **No active second store** for uploads | See Phase 7 |

**Validator temp file (not final storage):** `media_validator.rs:335-340` writes to `std::env::temp_dir()` for byte validation, then deletes (`:340`).

---

### Phase 2 — Static Media Serving

#### Route registration

```
main.rs:636-649
  GET/HEAD /videos/{filename:.*} → video_stream::serve_video
  GET/HEAD /thumbs/{filename:.*}  → video_stream::serve_thumb
```

#### Transform chain: `/videos/{uuid}.mp4` → disk

```
serve_video                              video_stream.rs:181-197
  filename = path.into_inner()           :186
  reject _rejected / leading _          :187-190
  file_path = resolve_media_path(&videos_path.0, &filename)  :192
    resolve_media_path                   video_stream.rs:42-62
      base = videos_path.0.canonicalize()  :47
      push Normal path components only     :50-55
      guard against ..                     :53-54
  serve_media_file(req, file_path, "Video")  :197
    if !file_path.is_file() → 404 JSON     :125-129
    NamedFile::open_async(&file_path)      :143

serve_thumb                              video_stream.rs:166-177
  same pattern with thumbs_path.0        :172
```

**Path injection origin:**

```
main.rs:213-215
  public_path = "./public"
  videos_path = public_path.join("videos")
  thumbs_path = public_path.join("thumbs")

main.rs:268-269
  VideosDir(videos_path.clone())
  ThumbsDir(thumbs_path.clone())

main.rs:297-298
  .app_data(videos_path_data)
  .app_data(thumbs_path_data)
```

With `WORKDIR /app` (`Dockerfile:21`), `./public/videos` resolves to `/app/public/videos/{filename}`.

---

### Phase 3 — Production URL Construction (`GET /api/reels`)

```
main.rs:314 → handlers::get_reels           handlers.rs:194-201
  → api::reels::list_ready_reels            api/reels.rs:7-15
    → db::reels::list_ready_reels           db/reels.rs:59-71
    → reel_contract::row_to_reel_v1(row)    reel_contract.rs:102-123
    → HttpResponse::Ok().json(Vec<ReelV1>)
```

#### Field production (`reel_contract.rs:102-123`)

| JSON field | Source | Transformation |
|------------|--------|----------------|
| `url` | `row.video_url` | `db::canonical_media_url(&video_url)` `:116` |
| `thumbnailUrl` | `row.thumbnail_url` | `canonical_media_url(thumb_rel)` `:105,117` |
| `thumbnailPath` | `row.thumbnail_url` | **Passthrough** (relative) `:118` |
| `fileName` | `row.file_name` | Direct `:114` |

#### What Postgres stores (ingestion v2)

From `insert_pending_reel` bindings (`db/reels.rs:49-50`) and upload writers:

- `video_url` = `"/videos/{uuid}.mp4"` or `"/thumbs/{uuid}.png"` (image-only)
- `thumbnail_url` = `"/thumbs/{uuid}.jpg"` etc.

**Not** `https://strong-lolly...` at insert time.

#### Live production proof (2026-07-15)

```
url:            https://strong-lolly-a9fcb4.netlify.app/videos/66598368-...
thumbnailUrl:   https://strong-lolly-a9fcb4.netlify.app/thumbs/66598368-...
thumbnailPath:  /thumbs/66598368-3fba-41bf-847c-68dd8f41be86.jpg
```

`thumbnailPath` relative + absolute `url`/`thumbnailUrl` ⇒ DB holds relative paths; serializer prepends `MEDIA_PUBLIC_BASE`.

**Exact serialization function:** `db::canonical_media_url` (`db/mod.rs:141-156`), called from `reel_contract::row_to_reel_v1` (`reel_contract.rs:105-116`).

**Passthrough rule:** If DB value already starts with `http://` or `https://`, returned unchanged (`db/mod.rs:147-148`). Legacy `seed.sql` demo rows use external URLs (`seed.sql:2-5`) but are not the ingestion-v2 production UUID pattern.

---

## URL Construction Pipeline

```
Postgres reels.video_url       e.g. "/videos/{uuid}.mp4"
Postgres reels.thumbnail_url   e.g. "/thumbs/{uuid}.jpg"
        ↓
row_to_reel_v1()               reel_contract.rs:102-123
        ↓
media_public_base()            db/mod.rs:128-138
  env MEDIA_PUBLIC_BASE or fallback http://localhost:{PORT}
        ↓
canonical_media_url(path)      db/mod.rs:141-156
  relative → {base}{path}
  absolute → passthrough
        ↓
JSON ReelV1
  url, thumbnailUrl (absolute)
  thumbnailPath (relative DB value)
```

`MEDIA_PUBLIC_BASE` affects **JSON URL strings only**. It does **not** change disk write paths.

---

## Filesystem Map

### Canonical runtime layout (container)

```
/app/                          WORKDIR (Dockerfile:21)
  backend                      binary (Dockerfile:30)
  public/                      PathBuf::from("./public") (main.rs:213)
    videos/
      {uuid}.mp4               upload.rs:58-60
      _rejected/               quarantine (media_validator.rs:266)
    thumbs/
      {uuid}.jpg|png|...       upload.rs:340-341, worker.rs:108-111
```

### Subsystem agreement on root

| Subsystem | Path source | Agrees on `./public`? |
|-----------|-------------|----------------------|
| Upload (`upload.rs`) | `svc.config.videos_path/thumbs_path` from `VideosDir`/`ThumbsDir` | **Yes** |
| Worker (`worker.rs`) | `videos_path`/`thumbs_path` clones from `main.rs:272-273` | **Yes** |
| Static serve (`video_stream.rs`) | `VideosDir.0` / `ThumbsDir.0` | **Yes** |
| FFmpeg (`ingestion/ffmpeg.rs`) | writes to `thumb_path` arg from worker | **Yes** |
| Validator quarantine (`media_validator.rs:266`) | `videos_dir.join("_rejected")` | **Yes** (subdir) |
| Reconcile (`ingestion/reconcile.rs:58-59`) | args from `main.rs:232-233` | **Yes** |
| Orphan scan (`media_seed.rs:184-217`) | args from `media_api.rs:522` | **Yes** |
| Legacy multipart upload (`media_api.rs:195-224`) | `videos_path.0` / `thumbs_path.0` | **Yes** |
| `verify-media-integrity.sh` | `MEDIA_ROOT` default `./public` | **Yes** (when run from `/app`) |
| `import-prod.sh` | `MEDIA_ROOT` default `/var/lib/reelforge/public` | **Disagrees** — script-only |

**No Rust subsystem disagrees on disk root.** Only `import-prod.sh` uses a different default path for bare-metal import workflows.

---

## Storage Architecture

### Phase 4 — `MEDIA_PUBLIC_BASE` investigation

| Location | Read / Write | Role |
|----------|--------------|------|
| `backend/src/db/mod.rs:128-138` | **Read** | `media_public_base()` |
| `backend/src/db/mod.rs:141-156` | **Read** | `canonical_media_url()` |
| `backend/src/reel_contract.rs:105-116` | **Read** (via canonical) | List/poll serialization |
| `backend/src/ingestion/upload.rs:187-188,416-417` | **Read** | POST response JSON only |
| `backend/src/ingestion/mod.rs:35` | **Read** | `media_base` in config (unused for disk) |
| `backend/.env.example:29` | Documented | `http://localhost:8080` |
| `docker-compose.yml:23` | Set | `http://localhost:8080` |
| `docker-compose.dev.yml:29` | Set | `http://localhost:8080` |
| `railway.toml` | **Not set** | Platform env only |
| `docs/DEPLOYMENT.md:10` | Documented | Operator note |

**No writes** to `MEDIA_PUBLIC_BASE` in application code.

### If `MEDIA_PUBLIC_BASE` disappears

```
media_public_base() → format!("http://localhost:{}", PORT)   db/mod.rs:130-134
canonical_media_url("/videos/x.mp4") → "http://localhost:{PORT}/videos/x.mp4"
```

Disk paths **unchanged**. Only API JSON absolute URLs change origin. Upload/write/serve unaffected.

---

## Railway Readiness

### Inspected artifacts

| File | Finding |
|------|---------|
| `backend/Dockerfile:21,32,36` | `WORKDIR /app`; `mkdir -p /app/public/videos /app/public/thumbs`; `CMD ["./backend"]` |
| `docker-compose.yml:25-26` | `reelforge_media:/app/public` — **reference pattern** |
| `docker-compose.dev.yml:33` | Same mount |
| `docker-compose.prod.yml` | **Does not exist** |
| `railway.toml:1-17` | Dockerfile builder; healthcheck `/health`; **no volume stanza** |
| `railway.json`, `nixpacks.toml`, `Procfile` | **Do not exist** |

### Is app designed for `/app/public` persistent storage?

**Yes.** Single hardcoded root `./public` at `main.rs:213` with `WORKDIR /app`. Docker Compose already mounts a named volume at `/app/public`.

### Would Railway volume introduce path mismatches?

**No application mismatch** if mounted at `/app/public`.

**Operator mismatch risk:** `import-prod.sh` syncs to `/var/lib/reelforge/public` by default (`import-prod.sh:18-32`). On Railway container, operator must set `MEDIA_ROOT=/app/public` or rsync to `/app/public` manually.

---

## Phase 7 — Hidden Storage Search

| Pattern | Found? | Active in upload? |
|---------|--------|-------------------|
| `temp_dir()` | `media_validator.rs:335` | Validation probe only; deleted `:340` |
| `MEDIA_ROOT` | Shell scripts only | Not read by Rust |
| `uploads/` | Not in backend src | — |
| `storage/` | API route names only (`/api/media/storage`) | Not a disk root |
| `var/lib` | `import-prod.sh:18` default | Script only |
| `sqlite` | Not found in backend media path | — |
| `reels.json` | `export-dev.sh:32-34` archive mention | Not runtime catalog (Postgres is source) |
| `blob` | Not found | — |
| `utils::upload_to_supabase` | `utils.rs:1-6` | **Dead code** — no callers in `backend/src` |

**Conclusion:** Upload bytes land **only** in `public/videos` and `public/thumbs` (plus `public/videos/_rejected` for quarantine). No hidden second upload destination in active code.

---

## Phase 8 — Startup Validation

### Current checks

| Check | Present? | Location |
|-------|----------|----------|
| Directory exists | **Yes** | `main.rs:220-221`, `video_stream.rs:91-99` |
| Directory is dir type | **Yes** | `video_stream.rs:91-102` |
| Writable | **No** | — |
| Mounted / persistent | **No** | — |
| DB ↔ FS consistency | **No** at startup | External: `verify-media-integrity.sh` |
| Inventory log | **Yes** | `media_seed::log_asset_inventory` via `main.rs:226` |
| Invalid video quarantine | **Yes** | `video_stream.rs:105-116` |
| Startup reconcile (disk→DB import) | **Yes** (optional) | `main.rs:228-256` |
| Health `storage` field | Always `"ready"` | `handlers.rs:113` |

### Smallest validation insertion point (recommendation only)

**File:** `backend/src/main.rs`  
**Location:** Immediately after `create_dir_all` block (`main.rs:220-221`), before `log_media_directory` (`:223`).

Rationale: paths exist; all downstream subsystems inherit `videos_path`/`thumbs_path` from here. No implementation in this mission.

---

## Existing Recovery Tools

| Tool / Endpoint | Read-only? | Mutates? | Direction |
|-----------------|------------|----------|-----------|
| `verify-media-integrity.sh` | **Yes** (reports, exit 1) | No | **DB → filesystem** (missing files) |
| `GET /api/media/cleanup/orphans` | **Yes** | No | **Filesystem → DB** (orphan files) |
| `POST /api/media/cleanup/orphans?confirm=true` | Preview unless confirm | **Deletes orphan files** | Filesystem → DB |
| `GET /api/media/storage` | **Yes** | No | **DB catalog only** when DB up (`media_api.rs:462-467`); `invalid_videos` scans FS |
| `POST /api/admin/migrate-media` | No | **Imports disk→DB**, enqueues jobs | `api/migrate.rs:34-40` |
| `ingestion/reconcile::reconcile_videos` (startup) | No | **Inserts DB rows** from disk videos | `main.rs:230-236` |
| `export-dev.sh` | N/A | **Writes** dump + rsync media out | Export |
| `import-prod.sh` | N/A | **Restores** DB + rsync media in | Import |
| `migrate-media.sh` | No | Calls migrate-media API | Mutates |
| `post-deploy-verify.sh` | **Yes** | No | HTTP smoke (health, reels, HEAD URLs) |
| `DELETE /api/reels/{id}` | No | Deletes DB row + disk files if present | Both |
| `DELETE /api/media/storage/{file}` | No | Deletes files + maybe DB | Both |

**Gap:** No single built-in **bidirectional dry-run** reporting DB ghosts + file orphans. `verify-media-integrity.sh` + `GET cleanup/orphans` together cover both directions externally.

---

## Contradictions Found

Attempting to disprove prior audits:

### 1. "Files disappeared solely because Railway storage is ephemeral"

| Evidence | Assessment |
|----------|------------|
| No volume in `railway.toml` | Supports ephemeral thesis |
| `docker-compose.yml` volume not applied to Railway automatically | Supports |
| Live: DB catalog + media 404 | Supports split-brain |
| Agent transcripts: files served 200 then 404 post-redeploy | Supports (not in repo; operational) |
| **Counter-hypothesis:** Operator ran `import-prod.sh` to wrong `MEDIA_ROOT` | Could cause ghosts **without** upload ever succeeding — does not explain prior 200 responses |
| **Counter-hypothesis:** `backfill_validated_ready_reels` | Marks DB `failed`, does not delete files (`db/reels.rs:268-317`) |
| **Counter-hypothesis:** Orphan cleanup deleted ready files | Only deletes **unreferenced** files (`media_seed.rs:202-216`) |

**Verdict:** No source-code contradiction. Ephemeral filesystem is the **primary** explanation. Secondary: ghost rows can persist after file loss.

### 2. "Database contains correct relative paths"

| Evidence | Assessment |
|----------|------------|
| `upload.rs:79,352` writes `/videos/...`, `/thumbs/...` to DB | **Confirmed** for ingestion v2 |
| Live `thumbnailPath: /thumbs/...` | **Confirmed** |
| `canonical_media_url` passthrough (`db/mod.rs:147-148`) | DB **could** store absolute URLs; ingestion v2 does not |
| `seed.sql:2-5` external URLs | Legacy demo only |

**Verdict:** **Confirmed** for current production UUID records. **Partial** if legacy absolute-URL rows exist (passthrough would preserve them).

### 3. "Serializer functioning correctly"

| Evidence | Assessment |
|----------|------------|
| `row_to_reel_v1` + `canonical_media_url` | Mechanically correct per design |
| Live Netlify URLs with relative `thumbnailPath` | Consistent with `MEDIA_PUBLIC_BASE=https://strong-lolly...` on Railway |

**Verdict:** **Confirmed** — serializer does not corrupt paths; it absolutizes relative DB values.

### 4. "Frontend functioning correctly"

| Evidence | Assessment |
|----------|------------|
| `config.js:51-56,79` same-origin on Netlify | Uses relative `/videos`, `/thumbs` via proxy |
| `toRelativeMediaPath` strips absolute media to path | Correct for Netlify architecture |

**Verdict:** **No source contradiction** with storage thesis. Frontend is out of scope for disk persistence; behavior consistent with same-origin proxy model.

### 5. "Volume at `/app/public` requires no code changes"

| Evidence | Assessment |
|----------|------------|
| Only `./public` in Rust (`main.rs:213`) | **Confirmed** |
| Docker Compose mount matches | **Confirmed** |
| `import-prod.sh` default `/var/lib/reelforge/public` | **Ops doc mismatch** — not runtime code |

**Verdict:** **Confirmed** for application code. Operator must mount `/app/public`, not rely on `import-prod.sh` default without override.

---

## Storage Audit Summary (Phase 1 checklist)

1. **Runtime path:** `/app/public/videos`, `/app/public/thumbs`
2. **Filesystem root:** `./public` → `/app/public` when CWD=`/app`
3. **Env affecting disk:** **None** in Rust
4. **Configurable:** **No** (hardcoded `main.rs:213`)
5. **Auto-created:** **Yes** (`main.rs:220-221`, `video_stream.rs:98-99`, `Dockerfile:32`)
6. **Startup validates:** Existence + quarantine; **not** persistence/writability/DB-FS match

---

## Final Conclusion

### PASS / PARTIAL PASS / FAIL

# PARTIAL PASS

| Area | Result |
|------|--------|
| Upload → disk path trace | **PASS** |
| Static serve path trace | **PASS** |
| DB relative paths + serializer | **PASS** |
| Single storage root (active code) | **PASS** |
| `/app/public` volume readiness (code) | **PASS** |
| Ephemeral filesystem as root cause | **PASS** (inference + live 404) |
| Tooling accuracy (`/api/media/storage`, `/health`) | **PARTIAL** |
| Ops script path alignment (`import-prod.sh`) | **PARTIAL** |
| Independent proof Railway lacks volume | **PARTIAL** (not in git; inferred) |

**BG-5E, BG-5F, BG-5G are substantially correct.** The production media-loss issue is **not** caused by a hidden second storage layer, symlink indirection, temp-file staging, or upload path mismatch. It is caused by **durable Postgres catalog + non-durable container filesystem at `/app/public`**, with Railway volume not configured in tracked deployment config.

**Before BG-5H implementation:** Infrastructure stabilization (Railway volume at `/app/public`) is validated as the correct fix. Optional guardrails (startup persistence warning, reconcile script, docs) address **observability gaps**, not architectural defects.

---

*Generated by BG-5H.0 independent verification. No code modified. No commits.*
