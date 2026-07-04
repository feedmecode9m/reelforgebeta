# Platform Configuration Layer

**Status:** Implemented (additive)  
**Feature flag:** `REELFORGE_PLATFORM_CONFIG=true` (default **off**)  
**Playback / ingestion / catalog:** Unchanged

---

## 1. Migration Summary

**File:** `backend/migrations/202512285_platform_configuration.sql`

### New tables

| Table | Rows | Purpose |
|-------|------|---------|
| `platform_site_config` | Singleton (`id=1`) | Site identity & branding |
| `platform_hero_config` | Singleton (`id=1`) | Hero behavior (not wired to Viewer yet) |
| `platform_feature_flags` | Singleton (`id=1`) | Admin-stored feature preferences |
| `platform_campaigns` | Many | Campaign metadata |

### Site fields

- `site_name`, `site_tagline`, `site_description`, `logo_url`, `favicon_url`

### Hero fields

- `hero_enabled`, `hero_mode`, `rotation_seconds`
- **Modes:** `OFF`, `STATIC`, `CAROUSEL`, `FEATURED_SERIES`, `LATEST_RELEASE`, `PROMOTED`

### Feature flags (DB)

- `studio_hierarchy`, `hero_management`, `monetization`, `watch_tracking`, `analytics`, `intel`

### Campaign fields

- `campaign_name`, `campaign_type`, `start_date`, `end_date`, `status`
- **Types:** `CONTEST`, `PREMIERE`, `PROMOTION`, `SPONSOR`
- **Status:** `draft`, `scheduled`, `active`, `ended`, `archived`

### Defaults seeded

- Site: `ReelForge` / `Premium Access`
- Hero: enabled, mode `STATIC`, rotation `8s`
- Feature flags: all `false`

**Existing tables:** Untouched (`reels`, `studio_*`, ingestion).

---

## 2. API Documentation

All routes return `404` when `REELFORGE_PLATFORM_CONFIG` is not enabled:

```json
{ "error": "Platform configuration disabled", "hint": "Set REELFORGE_PLATFORM_CONFIG=true to enable" }
```

### Status & bundle

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/platform/status` | Enabled flag + summary counts |
| GET | `/api/platform/config` | Full bundle: site, hero, features, campaigns |

### Site

| Method | Path | Body |
|--------|------|------|
| GET | `/api/platform/site` | — |
| PUT | `/api/platform/site` | `{ site_name?, site_tagline?, site_description?, logo_url?, favicon_url? }` |

### Hero

| Method | Path | Body |
|--------|------|------|
| GET | `/api/platform/hero` | — |
| PUT | `/api/platform/hero` | `{ hero_enabled?, hero_mode?, rotation_seconds? }` |

`rotation_seconds`: 3–120. Invalid `hero_mode` → `400`.

### Features

| Method | Path | Body |
|--------|------|------|
| GET | `/api/platform/features` | — |
| PUT | `/api/platform/features` | `{ studio_hierarchy?, hero_management?, monetization?, watch_tracking?, analytics?, intel? }` |

**Note:** DB flags are admin preferences. Runtime APIs (e.g. studio hierarchy) remain gated by their own env vars until explicitly wired.

### Campaigns

| Method | Path | Body |
|--------|------|------|
| GET | `/api/platform/campaigns` | — |
| POST | `/api/platform/campaigns` | `{ campaign_name, campaign_type, start_date?, end_date?, status? }` |
| GET | `/api/platform/campaigns/{id}` | — |
| PUT | `/api/platform/campaigns/{id}` | Partial update |
| DELETE | `/api/platform/campaigns/{id}` | — |

### Example: full config response

```json
{
  "site": {
    "site_name": "ReelForge",
    "site_tagline": "Premium Access",
    "site_description": "AI-powered short-form production platform",
    "logo_url": null,
    "favicon_url": null,
    "updated_at": "2026-06-01T12:00:00Z"
  },
  "hero": {
    "hero_enabled": true,
    "hero_mode": "STATIC",
    "rotation_seconds": 8,
    "updated_at": "2026-06-01T12:00:00Z"
  },
  "features": {
    "studio_hierarchy": false,
    "hero_management": false,
    "monetization": false,
    "watch_tracking": false,
    "analytics": false,
    "intel": false,
    "updated_at": "2026-06-01T12:00:00Z"
  },
  "campaigns": []
}
```

---

## 3. Rollback Plan

### Level 1 — Disable API (instant)

```bash
REELFORGE_PLATFORM_CONFIG=false
# restart backend
```

- All `/api/platform/*` routes return 404
- Viewer playback, ingestion, catalog unchanged
- Config data preserved in DB

### Level 2 — Remove admin UI only

- Remove `<PlatformConfigPanel />` from Control Center (optional)
- No backend or playback impact

### Level 3 — Drop schema

After backup:

```sql
DROP TABLE IF EXISTS platform_campaigns CASCADE;
DROP TABLE IF EXISTS platform_feature_flags CASCADE;
DROP TABLE IF EXISTS platform_hero_config CASCADE;
DROP TABLE IF EXISTS platform_site_config CASCADE;
```

- `reels`, ingestion, studio hierarchy tables untouched

---

## 4. File Modification Map

### New files

| Path | Purpose |
|------|---------|
| `backend/migrations/202512285_platform_configuration.sql` | Schema + seeds |
| `backend/src/db/platform_config.rs` | Repository |
| `backend/src/api/platform_config.rs` | HTTP handlers |
| `frontend/src/lib/api/platformConfig.js` | API client |
| `frontend/src/stores/platformConfigStore.js` | Svelte stores |
| `frontend/src/components/studio/PlatformConfigPanel.svelte` | Admin panel (Settings / Hero / Campaigns / Features) |
| `docs/PLATFORM_CONFIGURATION.md` | This document |

### Modified files

| Path | Change |
|------|--------|
| `backend/src/db/mod.rs` | `platform_config` module + `platform_config_enabled()` |
| `backend/src/api/mod.rs` | `platform_config` module |
| `backend/src/main.rs` | Routes + startup log line |
| `backend/.env.example` | `REELFORGE_PLATFORM_CONFIG` comment |
| `frontend/src/Viewer.svelte` | One additive `<PlatformConfigPanel />` in Control Center admin block only |

### Unchanged

- Ingestion pipeline, `GET /api/reels`, theater, hero rendering, shelf layout
- No payment or analytics implementation

---

## 5. Enable

```bash
# backend/.env
REELFORGE_PLATFORM_CONFIG=true
```

Restart backend → open Smart Production Studio (admin) → **Platform Config** section with tabs: Settings, Hero, Campaigns, Features.
