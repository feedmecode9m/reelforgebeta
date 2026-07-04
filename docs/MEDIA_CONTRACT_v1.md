# Media Contract v1

Canonical Reel schema shared by Postgres, REST API, WebSocket events, and the frontend `normalizeReel` adapter.

## Storage model (Postgres)

| Column | Purpose |
|--------|---------|
| `id` | UUID primary key |
| `title` | Display name (human-readable) |
| `file_name` | Disk basename under `public/videos/` or `public/thumbs/` |
| `video_url` | Relative path `/videos/{file_name}` |
| `thumbnail_url` | Relative path `/thumbs/...` when ready |
| `status` | `pending` \| `processing` \| `ready` \| `failed` |
| `category` | Feed bucket |
| `created_at` | Catalog ordering |

**Invariant:** For video reels, `file_name` equals the basename of `video_url`.

## API wire format (`ReelV1`, camelCase JSON)

```json
{
  "id": "uuid",
  "name": "MICROS STIRRED V3",
  "fileName": "MICROS_STIRRED_V3.MOV",
  "type": "video",
  "url": "https://host/videos/MICROS_STIRRED_V3.MOV",
  "thumbnailUrl": "https://host/thumbs/{id}.jpg",
  "category": "Trending",
  "status": "ready",
  "createdAt": "2026-05-30T00:20:00Z"
}
```

| Field | Rules |
|-------|-------|
| `name` | From DB `title`. Never the raw filename. |
| `fileName` | From DB `file_name`. Operational/dedup key, not for display. |
| `type` | `"video"` if primary URL under `/videos/`; else `"image"`. |
| `url` | Absolute public URL via `canonical_media_url`. |
| `thumbnailUrl` | Absolute; omitted when empty. |
| `status` | Always present on v1 responses. |

## GET /api/reels — Ready Catalog

- SQL: `SELECT * FROM reels WHERE status = 'ready' ORDER BY created_at DESC`
- Contract: every item includes `"status": "ready"`
- Purpose: feed, vault hydrate, bootstrap — **not** ingestion polling
- Pending/failed reels: use `GET /api/reels/{id}` or `POST /api/reels` + `pollIngestionUntilReady`

## GET /api/reels/{id} — Ingestion poll

Any status. Adds `errorMessage` and `pollUrl` when applicable.

## POST /api/reels

Returns `202 Accepted` with `status: pending` or `ready`. Poll via `{id}`.

## WebSocket `/ws/control-center`

- `CREATED`: full `ReelV1` payload plus `"eventType": "CREATED"` (media kind stays in `type`: `"video"` \| `"image"`)
- Legacy mode (`REELFORGE_WS_FULL_PAYLOAD=false`): minimal `{ type: "CREATED", id, title, category, createdAt }`
- `DELETED`: `{ type, id, title, category, deletedAt }`

Published when a reel becomes `ready` from upload, reconcile, or worker paths.

## URL resolution

- **Backend storage:** relative paths only
- **Backend API output:** `canonical_media_url(path)` in `db/mod.rs`
- **Frontend:** `resolveMediaUrl(path)` in `reelContract.js` (sole public resolver)
