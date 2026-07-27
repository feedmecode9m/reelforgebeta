# Production media reconciliation report

- Generated: `2026-07-27T16:56:26.034246+00:00`
- Mode: **read-only** (nothing deleted)
- Upload code: **unchanged** in this pass

## Verdict

Split-brain is real on the Railway volume, but it is **not** “16 good videos vs 6 DB videos”.

- DB ready catalog: **6 image reels**, **0 video reels**
- Filesystem `/videos`: **16 unreferenced tiny MP4 stubs** (≈1.6–8.2 KB each)
- No live volume objects currently at exactly **5,242,880** bytes
- Historical 5 MiB truncations were quarantined/removed (example R2 key 404)

## Orphan files (filesystem, not in DB)

| File | Bytes | Class |
|---|---:|---|
| `4aa235f5-912c-44fb-b8e3-d225b70576a8.mp4` | 1715 | tiny_corrupt_or_stub_mp4 |
| `5ffb37e5-2b17-40f5-9bcd-bc6f01229b28.mp4` | 6500 | tiny_corrupt_or_stub_mp4 |
| `73e916cb-457d-43af-a699-189ae79e54ab.mp4` | 1642 | tiny_corrupt_or_stub_mp4 |
| `845d081e-203f-4fda-abf1-9bc5cfdad348.mp4` | 1716 | tiny_corrupt_or_stub_mp4 |
| `857a0a4c-d503-439d-bd7c-27def64e0357.mp4` | 1716 | tiny_corrupt_or_stub_mp4 |
| `96406115-9bb2-4256-b863-ea5030464bd9.mp4` | 4728 | tiny_corrupt_or_stub_mp4 |
| `993d1c03-5c87-4f0a-8bca-7930e2c04ba2.mp4` | 1716 | tiny_corrupt_or_stub_mp4 |
| `a0d11f0e-6b3e-4b32-977c-1a4ee17bd2d2.mp4` | 8252 | tiny_corrupt_or_stub_mp4 |
| `a8a00d1f-181d-4c61-9a17-4a11c7b9f74c.mp4` | 2276 | tiny_corrupt_or_stub_mp4 |
| `ad61c6af-a825-4a8f-a883-3cad694c00a5.mp4` | 2290 | tiny_corrupt_or_stub_mp4 |
| `d8abd83a-dccc-4466-bb3b-518bd074a614.mp4` | 4728 | tiny_corrupt_or_stub_mp4 |
| `daf6998b-33ba-4998-8f36-06594ebb7f95.mp4` | 1710 | tiny_corrupt_or_stub_mp4 |
| `e1429aa5-123d-4212-ab60-46ba4e170a45.mp4` | 2276 | tiny_corrupt_or_stub_mp4 |
| `f1d391c5-4096-4f49-b008-b9ca361357a9.mp4` | 2276 | tiny_corrupt_or_stub_mp4 |
| `f6c4070d-3668-4e69-a9fe-dc7f4fde1345.mp4` | 2303 | tiny_corrupt_or_stub_mp4 |
| `fde4b314-0e77-4813-86a4-d421921c7fde.mp4` | 1710 | tiny_corrupt_or_stub_mp4 |

## DB records missing objects

- Ready **video** rows missing MP4: **none** (no ready videos)
- Inventory `missing_videos` lists **image** basenames checked under `/videos` — **reporting noise**, not missing MP4s
- Thumbnails: referenced and present (`thumb_mismatches: 0`)

## Rejected / truncated

- `invalid_videos` API list: empty right now
- All 16 orphans are tiny MP4 containers (ftyp present) — treat as failed-ingest leftovers, safe delete candidates **after** signed-upload verification

## Safe cleanup plan (do not run yet)

1. Deploy signed-upload patch (Netlify + Railway). Do not cleanup first.
2. Upload one fresh ~362MB MP4; confirm UPLOAD_SIZE_TRACE + R2_VERIFY_TRACE size match + status ready.
3. Re-run GET /api/media/cleanup/orphans (dry-run) and GET /api/media/storage.
4. Delete only confirmed orphans (16 tiny unreferenced MP4s) via POST /api/media/cleanup/orphans?confirm=true — after step 2 passes.
5. Do not delete image reel DB rows or /thumbs files; thumbs are healthy and referenced.
6. Optional follow-up: fix inventory so image reels are not counted as db_video_count / missing_videos (reporting bug, not data loss).
7. After orphan delete, expect filesystem_video_count→0 (until real videos exist) and split_brain false for real MP4 domain.

## Deploy blocker

This environment has no `NETLIFY_AUTH_TOKEN` / Railway login. Deploy from a machine with credentials, then run the fresh 362MB verification before any delete.
