# Migration Review Report — 288 / 289

**Phase:** 1a.3  
**Status:** Review before apply  
**Contract:** [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md)  
**Files:** [`202512288_viewer_experience_layer.sql`](../backend/migrations/202512288_viewer_experience_layer.sql), [`202512289_experience_extensions.sql`](../backend/migrations/202512289_experience_extensions.sql)

---

## 1. Table List

| Table | Migration | RVE section(s) |
|-------|-----------|----------------|
| `experience_profile_families` | 288 | `experience_profile` (identity) |
| `experience_profile_versions` | 288 | `experience_profile`, `labels`, `visibility`, `watch_features`, `monetization_presentation`, `theme`, `layout` (refs) |
| `platform_experience_defaults` | 288 | Platform baseline for all merged sections |
| `experience_slot_assignments` | 288 | `slots`, `campaigns` (via FK) |
| `theme_token_sets` | 289 | `theme` |
| `theme_tokens` | 289 | `theme.tokens` |
| `viewer_layout_presets` | 289 | `layout` (Blueprint System) |
| `metadata_definitions` | 289 | `metadata` schema |
| `metadata_values` | 289 | `metadata` values |

### Altered tables

| Table | Migration | Purpose |
|-------|-----------|---------|
| `studio_projects` | 288 | Hierarchy attachment columns |
| `studio_series` | 288 | Hierarchy attachment columns |
| `studio_seasons` | 288 | Hierarchy attachment columns |
| `studio_episodes` | 288 | Hierarchy attachment columns |
| `platform_feature_flags` | 288 | `experience_profiles` admin preference |
| `experience_profile_versions` | 289 | FK to theme/layout |
| `platform_experience_defaults` | 289 | FK to theme/layout |

---

## 2. Indexes

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_profile_families_slug` | `experience_profile_families` | Unique slug (partial) |
| `idx_profile_versions_one_active` | `experience_profile_versions` | **One ACTIVE per family** (partial unique) |
| `idx_profile_versions_family_status` | `experience_profile_versions` | List versions by family |
| `idx_slot_assignments_scope` | `experience_slot_assignments` | Resolve slots by scope |
| `idx_slot_assignments_campaign` | `experience_slot_assignments` | Campaign linkage |
| `idx_slot_assignments_active` | `experience_slot_assignments` | Active slot queries |
| `idx_studio_*_experience_family` | `studio_*` | Attachment lookups (×4) |
| `idx_metadata_values_scope` | `metadata_values` | Load metadata for scope |
| `idx_metadata_values_gin` | `metadata_values` | Admin search (optional) |

---

## 3. Foreign Keys

| Child | Parent | ON DELETE |
|-------|--------|-----------|
| `experience_profile_versions.profile_family_id` | `experience_profile_families` | RESTRICT |
| `experience_profile_versions.created_from_profile_id` | `experience_profile_versions` | SET NULL |
| `experience_profile_versions.theme_token_set_id` | `theme_token_sets` | SET NULL (289) |
| `experience_profile_versions.layout_preset_id` | `viewer_layout_presets` | SET NULL (289) |
| `experience_slot_assignments.campaign_id` | `platform_campaigns` | SET NULL |
| `studio_*.experience_profile_family_id` | `experience_profile_families` | SET NULL |
| `studio_*.experience_profile_version_id` | `experience_profile_versions` | SET NULL |
| `theme_tokens.token_set_id` | `theme_token_sets` | CASCADE |
| `metadata_values.definition_id` | `metadata_definitions` | RESTRICT |
| `platform_experience_defaults.default_*` | theme/layout | SET NULL (289) |

---

## 4. Rollback Plan

**Level L3 (schema rollback) — apply in reverse order after backup:**

```sql
-- 289 rollback
ALTER TABLE platform_experience_defaults DROP CONSTRAINT IF EXISTS fk_platform_defaults_layout_preset;
ALTER TABLE platform_experience_defaults DROP CONSTRAINT IF EXISTS fk_platform_defaults_theme_set;
ALTER TABLE experience_profile_versions DROP CONSTRAINT IF EXISTS fk_profile_versions_layout_preset;
ALTER TABLE experience_profile_versions DROP CONSTRAINT IF EXISTS fk_profile_versions_theme_set;
DROP TABLE IF EXISTS metadata_values CASCADE;
DROP TABLE IF EXISTS metadata_definitions CASCADE;
DROP TABLE IF EXISTS viewer_layout_presets CASCADE;
DROP TABLE IF EXISTS theme_tokens CASCADE;
DROP TABLE IF EXISTS theme_token_sets CASCADE;

-- 288 rollback
ALTER TABLE platform_feature_flags DROP COLUMN IF EXISTS experience_profiles;
ALTER TABLE studio_episodes DROP COLUMN IF EXISTS experience_profile_version_id;
ALTER TABLE studio_episodes DROP COLUMN IF EXISTS experience_profile_pin_version;
ALTER TABLE studio_episodes DROP COLUMN IF EXISTS experience_profile_family_id;
-- (repeat for seasons, series, projects)
DROP TABLE IF EXISTS experience_slot_assignments CASCADE;
DROP TABLE IF EXISTS platform_experience_defaults CASCADE;
DROP TABLE IF EXISTS experience_profile_versions CASCADE;
DROP TABLE IF EXISTS experience_profile_families CASCADE;
```

**Level L1 (instant):** `REELFORGE_EXPERIENCE_PROFILES=false` — no migration rollback required.

---

## 5. Contract Field Mapping

| RVE path | Storage |
|----------|---------|
| `schema_version` | Resolver constant (not stored) |
| `resolve_context.*` | Derived from `studio_episodes` walk |
| `experience_profile.*` | `experience_profile_families` + `experience_profile_versions` + hierarchy attachment |
| `layout.preset_key` | `viewer_layout_presets.preset_key` |
| `layout.definition` | `viewer_layout_presets.definition` |
| `theme.token_set_id` | `theme_token_sets.id` |
| `theme.tokens` | `theme_tokens` rows |
| `labels.*` | `experience_profile_versions.*_label` + `platform_experience_defaults` |
| `metadata.<key>` | `metadata_values` + `metadata_definitions` |
| `visibility.hero.*` | Merged from profile + `platform_experience_defaults` |
| `visibility.panels.*` | Computed at resolve (preset ∩ profile flags) |
| `campaigns[]` | `platform_campaigns` (injector) |
| `slots[]` | `experience_slot_assignments` |
| `monetization_presentation.*` | Profile nullable + platform defaults |
| `watch_features.*` | Profile nullable + platform defaults |
| `provenance` | Resolver output only (not persisted) |

---

## 6. Review Checklist

| Check | Result |
|-------|--------|
| Every column maps to contract §8 | Pass |
| No undocumented columns | Pass |
| Hero enum v2 (`STATIC_IMAGE`, not `STATIC`) | Pass in defaults + profile |
| Reserved metadata enforced at DB | Pass (`metadata_definitions_field_key_reserved`) |
| One ACTIVE per family | Pass (partial unique index) |
| Hero sync from `platform_hero_config` | Pass (289 UPDATE) |
| No resolver/API/Viewer changes in migration | Pass |

---

## 7. Apply Order

1. Confirm migrations 284–287 applied  
2. Apply `202512288_viewer_experience_layer.sql`  
3. Apply `202512289_experience_extensions.sql`  
4. Verify seeds: 7 layout presets, 5 theme sets, 7 metadata definitions  
5. Verify `platform_experience_defaults.default_layout_preset_id` set to NETFLIX  

**Approved for apply:** pending operator sign-off on this report.
