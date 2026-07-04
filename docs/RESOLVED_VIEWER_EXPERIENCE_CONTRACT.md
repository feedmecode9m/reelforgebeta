# ResolvedViewerExperience — Canonical Contract Specification

**Phase:** 1a.1 — Experience Contract Schema  
**Status:** Normative specification (architecture only)  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio  
**Prerequisite docs:** [`VIEWER_EXPERIENCE_LAYER_ARCHITECTURE.md`](./VIEWER_EXPERIENCE_LAYER_ARCHITECTURE.md) (storage & merge design), [`EXPERIENCE_PROFILE_ARCHITECTURE.md`](./EXPERIENCE_PROFILE_ARCHITECTURE.md) (v1 reference, superseded for resolve output shape)

**Scope:** This document defines the **only** payload that downstream consumers (Viewer, Studio preview, future modules) may use for composed viewer experience data. No migrations, Rust types, JSON Schema files, or API handlers are defined here — those are derived from this contract in later phases.

---

## Table of Contents

1. [Purpose & Authority](#1-purpose--authority)
2. [Schema Versioning Strategy](#2-schema-versioning-strategy)
3. [Backward Compatibility Policy](#3-backward-compatibility-policy)
4. [Contract Stability Rules](#4-contract-stability-rules)
5. [Composition Authority](#5-composition-authority)
6. [Provenance Model](#6-provenance-model)
7. [Top-Level Contract Shape](#7-top-level-contract-shape)
8. [Section Specifications](#8-section-specifications)
9. [Extension Points](#9-extension-points)
10. [Validation Requirements](#10-validation-requirements)
11. [Example Payloads](#11-example-payloads)
12. [Consumer Obligations](#12-consumer-obligations)
13. [Relationship to Implementation Phases](#13-relationship-to-implementation-phases)

---

## 1. Purpose & Authority

`ResolvedViewerExperience` (RVE) is the **formal, versioned output** of the Unified Resolver (`experience_resolve.rs`). It is a **read-only, fully composed** snapshot for a single resolve context (typically one `episode_id`).

| Role | May do | Must not do |
|------|--------|-------------|
| **Resolver** | Produce RVE; attach provenance; validate before return | Expose raw DB rows to consumers |
| **Studio** | Write configuration (profiles, presets, metadata, slots, campaigns, attachments) | Merge layers client-side; depend on raw experience tables for preview |
| **Viewer** | Render fields from RVE | Compose experience; read experience DB tables; apply visibility math |
| **Campaign engine** | Supply slot/campaign **metadata** to resolver | Control playback, layout structure, or panel geometry |

**Principle:** `Viewer Experience = ResolvedViewerExperience` — not scattered `if` blocks, not `platform_hero_config` reads, not `UIAgent.configs`.

---

## 2. Schema Versioning Strategy

### 2.1 Version identifier

Every RVE payload includes:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | string (SemVer) | **Yes** | Contract version of this document family, e.g. `"1.0.0"` |

- **Major** (`X`): Breaking change — consumers must upgrade or use compatibility shim.
- **Minor** (`Y`): Additive — new optional sections/fields; old consumers ignore unknown keys.
- **Patch** (`Z`): Clarifications, stricter validation, or documentation-only alignment (no wire change).

### 2.2 Resolver behavior

- Resolver **must** emit the highest `schema_version` it fully implements.
- Resolver **must** reject composition if it cannot populate all **null-critical** fields (see §10).
- API may accept optional request header `Accept-Experience-Schema: 1.x` in a future phase; initial implementation returns `1.0.0` only.

### 2.3 Version registry

| Contract version | Status | Notes |
|------------------|--------|-------|
| `1.0.0` | **Current (this document)** | Initial normative contract for Phase 1a+ |

Future versions are registered in this table before implementation ships.

---

## 3. Backward Compatibility Policy

### 3.1 Additive changes (minor bump)

Allowed without breaking consumers:

- New **optional** top-level sections (e.g. `extensions.future_ai_modules`)
- New **optional** fields within existing sections
- New enum values only when consumers are required to treat unknown enum strings as opaque passthrough (Viewer Phase 2+)

### 3.2 Breaking changes (major bump)

Require major version increment and migration notes:

- Removing or renaming fields
- Changing field types (e.g. `string` → `object`)
- Making optional fields required
- Changing provenance `source` enum values
- Changing merge semantics documented in §8

### 3.3 Deprecation process

1. Mark field `@deprecated` in this document with `replaced_by` and `sunset_version`.
2. Resolver populates **both** old and new fields for one minor cycle when feasible.
3. Remove deprecated fields only in next major version.

### 3.4 Consumer rule

Consumers **must** ignore unknown top-level keys and unknown keys inside sections they do not implement. Consumers **must not** fail hard on extra fields unless operating in strict debug mode.

---

## 4. Contract Stability Rules

These rules are **non-negotiable** for all phases unless this document is revised via formal amendment.

| ID | Rule |
|----|------|
| S1 | **Viewer consumes RVE only** for experience labels, layout, visibility, theme presentation, campaign slots, and watch-feature gates. |
| S2 | **Studio writes configuration only** via write APIs and platform/hierarchy attachment endpoints — never emits merged experience for production use except by caching `GET /api/experience/resolve`. |
| S3 | **Resolver is the sole composition authority** — no other module may read experience tables to build merged viewer experience. |
| S4 | **Campaign engine injects metadata only** — `campaigns` and `slots` sections are informational; they do not alter `layout` geometry or theater playback contracts. |
| S5 | **No consumer may depend on raw database tables** for experience composition (`experience_profile_*`, `viewer_layout_presets`, `metadata_*`, `experience_slot_assignments`, etc.). |
| S6 | **Monetization enforcement is out of scope** — `monetization_presentation` and `enforce_paywall` are presentation metadata only; access control remains in the monetization module. |
| S7 | **Provenance is mandatory** for every leaf field listed in §8 — consumers may use it for Studio debugging; Viewer may ignore it in production render path. |

---

## 5. Composition Authority

### 5.1 Deterministic merge order

The resolver applies sources in this **strict order** (later steps override earlier steps only where field merge rules say so):

| Step | Source layer | Affects |
|------|----------------|---------|
| 1 | `default` | Built-in fallbacks when platform row missing |
| 2 | `platform` | `platform_experience_defaults` (+ synced hero baseline) |
| 3 | `project` | Hierarchy attachment + profile fields at project scope |
| 4 | `series` | Hierarchy attachment + profile fields at series scope |
| 5 | `season` | Hierarchy attachment + profile fields at season scope |
| 6 | `episode` | Hierarchy attachment + profile fields at episode scope |
| 7 | `profile` | Resolved ACTIVE or pinned `experience_profile_versions` row |
| 8 | Layout blueprint | `viewer_layout_presets.definition` via profile's preset |
| 9 | Visibility intersection | `preset.panel.visible AND profile.component_enabled` |
| 10 | Metadata merge | `metadata_values` scope-upward |
| 11 | `campaign` | Active campaigns + slot assignments (metadata injector) |

### 5.2 Profile version selection

| Condition | Resolved version |
|-----------|------------------|
| `pin_version = false` | Latest `ACTIVE` for attached `profile_family_id` |
| `pin_version = true` | Exact `experience_profile_version_id` (may be `ARCHIVED`; Studio warning) |
| No attachment | Profile section omitted; platform + hierarchy labels/flags still apply |

**Forbidden for resolve output:** `DRAFT` profile versions.

---

## 6. Provenance Model

### 6.1 Structure

Every documented leaf field in RVE has a parallel entry under `provenance` using dot-path keys (e.g. `labels.episode_label`, `visibility.panels.hero.effective_visible`).

```json
{
  "value": "<resolved value>",
  "source": "default | platform | project | series | season | episode | profile | campaign",
  "scope": "<optional scope identifier>",
  "profile_version": "<optional UUID string>"
}
```

| Subfield | Type | Required | Description |
|----------|------|----------|-------------|
| `value` | any (matches field type) | **Yes** | Final resolved value |
| `source` | enum string | **Yes** | Winning layer from §5.1 |
| `scope` | string \| null | No | Stable scope id, e.g. `studio_series:550e8400-e29b-41d4-a716-446655440000`, `platform`, `campaign:uuid` |
| `profile_version` | UUID string \| null | No | Set when `source` is `profile` |

### 6.2 Source enum semantics

| Source | Meaning |
|--------|---------|
| `default` | Hardcoded resolver fallback (no row) |
| `platform` | `platform_experience_defaults` or platform-wide campaign |
| `project` | `studio_projects` attachment or scope value |
| `series` | `studio_series` |
| `season` | `studio_seasons` |
| `episode` | `studio_episodes` |
| `profile` | `experience_profile_versions` (ACTIVE or pinned) |
| `campaign` | `platform_campaigns` + slot assignment |

### 6.3 Visibility provenance

For `visibility.panels.<id>.effective_visible`, provenance **should** include optional `disabled_by` in `value` metadata or a sibling key `visibility.panels.<id>.disabled_by` with value `"preset" | "profile" | null` when `effective_visible` is `false`.

---

## 7. Top-Level Contract Shape

```json
{
  "schema_version": "1.0.0",
  "resolve_context": { },
  "experience_profile": { },
  "layout": { },
  "theme": { },
  "labels": { },
  "metadata": { },
  "visibility": { },
  "campaigns": [ ],
  "slots": [ ],
  "monetization_presentation": { },
  "watch_features": { },
  "extensions": { },
  "provenance": { }
}
```

### 7.1 Top-level field summary

| Field | Required | Description |
|-------|----------|-------------|
| `schema_version` | **Yes** | SemVer string |
| `resolve_context` | **Yes** | Identifies what was resolved |
| `experience_profile` | No | Winning profile identity (null if none attached) |
| `layout` | **Yes** | Blueprint + preset key |
| `theme` | **Yes** | Token set (may be empty object) |
| `labels` | **Yes** | Navigation / content-type strings |
| `metadata` | **Yes** | Flat custom fields (may be empty object) |
| `visibility` | **Yes** | Effective panel/shelf visibility |
| `campaigns` | **Yes** | Array (may be empty) |
| `slots` | **Yes** | Array (may be empty) |
| `monetization_presentation` | **Yes** | Presentation-only monetization UI |
| `watch_features` | **Yes** | Watch-related feature gates |
| `extensions` | No | Extension points (§9) |
| `provenance` | **Yes** | Map of dot-path → provenance object |

---

## 8. Section Specifications

### 8.1 `resolve_context`

Identifies the resolve target. **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `episode_id` | UUID | Conditional* | — | Request parameter |
| `reel_id` | UUID | Conditional* | — | Derived from episode or request |
| `project_id` | UUID | **Yes** | — | Walked from episode |
| `series_id` | UUID \| null | No | `null` | Walked from episode |
| `season_id` | UUID \| null | No | `null` | Walked from episode |
| `resolved_at` | ISO-8601 datetime | **Yes** | server `now()` | Resolver |
| `enforce_paywall` | boolean | **Yes** | `false` | Always `false` on this contract (monetization API owns enforcement) |

\*Exactly one of `episode_id` or `reel_id` must be present in the request; resolver populates both when possible.

---

### 8.2 `experience_profile`

Profile identity used for merge. **Optional** section (omit when no family attached).

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `profile_family_id` | UUID | **Yes** if section present | — | Hierarchy attachment |
| `profile_version_id` | UUID | **Yes** if section present | — | ACTIVE or pinned version |
| `profile_version` | integer | **Yes** if section present | — | Version row |
| `profile_family_name` | string | No | — | `experience_profile_families.name` |
| `content_format` | enum | **Yes** if section present | `"GENERIC"` | Profile version |
| `pin_version` | boolean | **Yes** if section present | `false` | Hierarchy attachment |
| `status` | enum | **Yes** if section present | — | `ACTIVE` or `ARCHIVED` (pinned only for ARCHIVED) |

**`content_format` enum:** `GENERIC`, `MICRO_DRAMA`, `DOCUMENTARY`, `MUSIC_VIDEO`, `REALITY`, `EDUCATIONAL`, `CREATOR_COURSE`, `CREATOR_CHANNEL`, `LIVESTREAM_REPLAY`

---

### 8.3 `layout`

Blueprint System output. **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `preset_key` | enum | **Yes** | `"MINIMAL"` | Profile → platform default |
| `preset_name` | string | No | — | `viewer_layout_presets.name` |
| `definition` | object | **Yes** | see below | `viewer_layout_presets.definition` |
| `definition.panels` | map | **Yes** | `{}` | Blueprint JSON |
| `definition.panels.<id>.visible` | boolean | **Yes** per panel | `true` | Blueprint baseline |
| `definition.panels.<id>.zone` | string | **Yes** per panel | — | Blueprint |
| `definition.shelf_order` | string[] | **Yes** | `[]` | Blueprint |
| `definition.cta` | object | No | — | Blueprint optional zone hints |

**`preset_key` enum:** `MINIMAL`, `NETFLIX`, `REELSHORT`, `DOCUMENTARY`, `ARTIST_ACCESS`, `EDUCATIONAL`, `CUSTOM`

**Standard panel ids:** `hero`, `continue_watching`, `recommendations`, `categories`, `artist_panel`, `credits`, `cast_panel`, `timeline`, `comments`, `downloads`

---

### 8.4 `theme`

Theme token output (semantic variants, not raw CSS). **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `token_set_id` | UUID \| null | No | `null` | Profile → platform default |
| `token_set_slug` | string | No | `"default-reelforge"` | Token set row |
| `tokens` | object | **Yes** | `{}` | Whole-set replacement from profile |

**`tokens` keys (optional per set):** `hero_surface`, `panel_surface`, `accent_surface`, `typography_style`, `button_style`, `card_style`, `overlay_style`

Each token value: object (JSON), e.g. `{ "variant": "dark-cinema", "density": "compact" }`

---

### 8.5 `labels`

Label Registry (built-in navigation strings). **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `project_label` | string | No | `"Project"` | Profile → platform → default |
| `series_label` | string | No | `"Series"` | Profile → platform → default |
| `season_label` | string | No | `"Season"` | Profile → platform → default |
| `episode_label` | string | **Yes** | `"Episode"` | Profile → platform → default |
| `vip_label` | string | No | `"VIP"` | Profile → platform → default |
| `trailer_label` | string | No | `"Trailer"` | Profile → default |
| `bonus_content_label` | string | No | `"Bonus"` | Profile → default |

All fields use nullable-inherit merge: only non-null profile/hierarchy overrides apply.

---

### 8.6 `metadata`

Admin-defined custom fields (Metadata Registry), flat key-value. **Required** section (may be `{}`).

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `<field_key>` | any | Per definition | — | Episode → season → series → project value merge |

Values conform to `metadata_definitions.data_type`: `TEXT`, `URL`, `DATE`, `NUMBER`, `BOOLEAN`, `JSON`.

Optional per-key wrapper in a future minor version; in `1.0.0` values are bare with provenance at `provenance.metadata.<field_key>`.

---

### 8.7 `visibility`

Component Visibility Rules — **effective** visibility after blueprint ∩ profile. **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `hero` | object | **Yes** | — | Merged hero flags |
| `hero.enabled` | boolean | **Yes** | `true` | Profile → platform |
| `hero.mode` | enum | **Yes** | `"OFF"` | Profile → platform |
| `hero.autoplay` | boolean | No | `false` | Profile |
| `hero.carousel_interval_seconds` | integer | No | `8` | Profile (3–120) |
| `hero.overlay_enabled` | boolean | No | `false` | Profile |
| `panels` | map | **Yes** | — | Intersection layer |
| `panels.<id>.effective_visible` | boolean | **Yes** | `false` | `layout.definition.panels.<id>.visible AND profile.<id>_enabled` |
| `panels.<id>.baseline_visible` | boolean | **Yes** | — | Blueprint only |
| `panels.<id>.profile_enabled` | boolean \| null | No | `null` | Profile flag (null = inherit enabled) |
| `panels.<id>.zone` | string | No | — | From blueprint |

**`hero.mode` enum (v2):** `OFF`, `STATIC_IMAGE`, `STATIC_VIDEO`, `CAROUSEL_IMAGES`, `CAROUSEL_VIDEOS`, `MIXED`

**Profile component flags mapped to panels:**

| Profile field | Panel id |
|---------------|----------|
| `continue_watching_enabled` | `continue_watching` |
| `recommendations_enabled` | `recommendations` |
| `artist_panel_enabled` | `artist_panel` |
| `credits_enabled` | `credits` |
| `downloads_enabled` | `downloads` |
| `comments_enabled` | `comments` |
| `cast_panel_enabled` | `cast_panel` |
| `trivia_enabled` | `trivia` |
| `timeline_enabled` | `timeline` |

---

### 8.8 `campaigns`

Campaign Engine metadata (injector output). **Required** array (may be empty).

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `[].id` | UUID | **Yes** | — | `platform_campaigns` |
| `[].campaign_name` | string | **Yes** | — | Campaign row |
| `[].campaign_type` | enum | **Yes** | — | `CONTEST`, `PREMIERE`, `PROMOTION`, `SPONSOR` |
| `[].status` | enum | **Yes** | — | Resolved active state |
| `[].start_date` | ISO-8601 \| null | No | — | Campaign row |
| `[].end_date` | ISO-8601 \| null | No | — | Campaign row |
| `[].priority` | integer | No | `0` | Campaign row (Phase 1b schema) |
| `[].target_series_id` | UUID \| null | No | — | Campaign targeting |
| `[].target_episode_id` | UUID \| null | No | — | Campaign targeting |

Campaigns **must not** include playback URLs or layout overrides in `1.0.0` — slot content references live under `slots`.

---

### 8.9 `slots`

Promotional slot assignments. **Required** array (may be empty).

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `[].slot_key` | string | **Yes** | — | `experience_slot_assignments` |
| `[].campaign_id` | UUID \| null | No | — | Slot assignment |
| `[].scope_type` | enum | **Yes** | — | `project`, `series`, `season`, `episode`, `platform` |
| `[].scope_id` | UUID \| null | No | — | Scope row |
| `[].status` | enum | **Yes** | — | `scheduled`, `active`, `ended` |
| `[].content_ref` | object | No | — | Opaque refs (series id, episode id, image url key) |
| `[].zone_hint` | string | No | — | From blueprint `definition.panels` or slot config |

**Standard `slot_key` values:** `hero_promo`, `shelf_featured`, `theater_overlay`, `shelf_badge`

---

### 8.10 `monetization_presentation`

Presentation-only; **not** enforcement. **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `paywall_style` | string \| null | No | `null` | Profile |
| `access_style` | string \| null | No | `null` | Profile |
| `cta_style` | string \| null | No | `null` | Profile |
| `premium_cta_style` | enum | No | `"NONE"` | Profile → platform |

**`premium_cta_style` enum:** `NONE`, `SUBTLE`, `BANNER`, `MODAL`, `PILL`

---

### 8.11 `watch_features`

Gates pairing with Watch Intelligence APIs. **Required** section.

| Field | Type | Required | Default | Source hierarchy |
|-------|------|----------|---------|------------------|
| `continue_watching_enabled` | boolean | **Yes** | `false` | Profile → platform |
| `recommendations_enabled` | boolean | **Yes** | `false` | Profile → platform |
| `downloads_enabled` | boolean | **Yes** | `false` | Profile → platform |
| `comments_enabled` | boolean | **Yes** | `false` | Profile → platform |

Watch features mirror profile flags; `visibility.panels` determines **where** they may render.

---

### 8.12 `provenance`

Map of dot-path → provenance object (§6). **Required** section.

- **Required keys:** Every leaf field in §8.1–8.11 must have a provenance entry.
- **Key format:** Dot-separated path matching RVE shape, e.g. `labels.episode_label`, `visibility.panels.hero.effective_visible`.

---

## 9. Extension Points

All extensions live under optional top-level `extensions` object. Consumers **must** ignore unrecognized extension namespaces.

### 9.1 `extensions.custom_metadata`

| Field | Type | Description |
|-------|------|-------------|
| `definitions` | array | Optional echo of active custom field schemas for Viewer form render |
| `values` | object | Same keys as `metadata` or superseding experimental keys |

**Policy:** Prefer flat `metadata` for `1.0.0`; `custom_metadata` reserved for client-specific experimental keys not in registry.

### 9.2 `extensions.custom_slots`

| Field | Type | Description |
|-------|------|-------------|
| `slots` | array | Slots using `slot_key` prefix `custom.` |

**Policy:** Must not override standard slot keys; resolver merges after standard `slots` array.

### 9.3 `extensions.future_ai_modules`

| Field | Type | Description |
|-------|------|-------------|
| `modules` | array | e.g. `{ "module_id": "shelf_ranker", "payload": {} }` |

**Policy:** Metadata only; no layout mutation in `1.0.0`.

### 9.4 `extensions.future_recommendation_modules`

| Field | Type | Description |
|-------|------|-------------|
| `engine_id` | string \| null | Identifier for recommendation backend |
| `shelf_hints` | object | Ordering hints — non-binding until Viewer Phase 2+ |

### 9.5 `extensions.future_ad_modules`

| Field | Type | Description |
|-------|------|-------------|
| `placements` | array | Ad placement metadata separate from `campaigns` |

**Policy:** Ad modules must not share slot keys with `hero_promo` without explicit precedence rules (future spec).

---

## 10. Validation Requirements

Requirements below are suitable for generating JSON Schema (draft 2020-12) in Phase 1a implementation.

### 10.1 Null-critical fields

Resolver **must not** return success if any of these are null/ missing:

| Path | Rule |
|------|------|
| `schema_version` | SemVer pattern `^\d+\.\d+\.\d+$` |
| `resolve_context.episode_id` or `resolve_context.reel_id` | At least one present |
| `resolve_context.project_id` | UUID |
| `resolve_context.resolved_at` | datetime |
| `layout.preset_key` | Valid enum |
| `layout.definition.panels` | Object |
| `labels.episode_label` | Non-empty string |
| `visibility.hero.mode` | Valid enum |
| `visibility.hero.enabled` | Boolean |
| `provenance` | Contains all null-critical paths |

If `experience_profile` section is present: `profile_version_id`, `profile_version`, `content_format` required.

### 10.2 Type constraints

| Constraint | Rule |
|------------|------|
| UUIDs | RFC 4122 string format |
| `visibility.hero.carousel_interval_seconds` | integer 3–120 when present |
| `metadata` URL fields | Must validate against definition `validation` JSON Schema fragment |
| `campaigns[].campaign_type` | Enum closed set |
| `provenance[*].source` | Closed enum §6.2 |

### 10.3 Consistency checks (resolver-internal)

| Check | Action |
|-------|--------|
| `visibility.panels.<id>.effective_visible` ≠ `baseline_visible AND profile_enabled` | Reject resolve (500 / compose error) |
| Multiple ACTIVE profile versions | Reject publish at write time; resolve must never occur |
| Pinned version is DRAFT | Reject resolve with 422 |
| Unknown `preset_key` | Fall back to `MINIMAL` + provenance `source: default` |

### 10.4 HTTP mapping (future API)

| Validation failure | HTTP |
|--------------------|------|
| Null-critical missing | `422 Unprocessable Entity` + `{ "fields": ["labels.episode_label", ...] }` |
| Invalid request context | `400 Bad Request` |
| Compose internal error | `500 Internal Server Error` (no partial RVE) |

---

## 11. Example Payloads

Examples are illustrative; provenance shown in abbreviated form for readability.

### 11.1 Documentary profile

```json
{
  "schema_version": "1.0.0",
  "resolve_context": {
    "episode_id": "a1000000-0000-4000-8000-000000000001",
    "reel_id": "b2000000-0000-4000-8000-000000000002",
    "project_id": "c3000000-0000-4000-8000-000000000003",
    "series_id": "d4000000-0000-4000-8000-000000000004",
    "season_id": "e5000000-0000-4000-8000-000000000005",
    "resolved_at": "2026-06-03T12:00:00Z",
    "enforce_paywall": false
  },
  "experience_profile": {
    "profile_family_id": "f6000000-0000-4000-8000-000000000006",
    "profile_version_id": "f7000000-0000-4000-8000-000000000007",
    "profile_version": 2,
    "profile_family_name": "Documentary Standard",
    "content_format": "DOCUMENTARY",
    "pin_version": false,
    "status": "ACTIVE"
  },
  "layout": {
    "preset_key": "DOCUMENTARY",
    "preset_name": "Documentary",
    "definition": {
      "panels": {
        "hero": { "visible": true, "zone": "top" },
        "continue_watching": { "visible": true, "zone": "below_hero" },
        "recommendations": { "visible": false, "zone": "main_shelf" },
        "categories": { "visible": true, "zone": "main_shelf" },
        "credits": { "visible": true, "zone": "theater_end" },
        "cast_panel": { "visible": true, "zone": "theater_sidebar" }
      },
      "shelf_order": ["continue_watching", "categories"],
      "cta": { "zone": "hero_overlay" }
    }
  },
  "theme": {
    "token_set_id": "a8000000-0000-4000-8000-000000000008",
    "token_set_slug": "documentary",
    "tokens": {
      "hero_surface": { "variant": "wide-cinematic", "density": "comfortable" },
      "panel_surface": { "variant": "matte-dark" },
      "typography_style": { "variant": "serif-documentary" }
    }
  },
  "labels": {
    "project_label": "Collection",
    "series_label": "Series",
    "season_label": "Part",
    "episode_label": "Episode",
    "vip_label": "Member",
    "trailer_label": "Preview",
    "bonus_content_label": "Extra"
  },
  "metadata": {
    "sponsor_name": "Public Media Fund",
    "merch_url": "https://example.org/support"
  },
  "visibility": {
    "hero": {
      "enabled": true,
      "mode": "STATIC_IMAGE",
      "autoplay": false,
      "overlay_enabled": true
    },
    "panels": {
      "hero": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "top" },
      "continue_watching": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "below_hero" },
      "recommendations": { "effective_visible": false, "baseline_visible": false, "profile_enabled": true, "zone": "main_shelf" },
      "categories": { "effective_visible": true, "baseline_visible": true, "profile_enabled": null, "zone": "main_shelf" },
      "credits": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "theater_end" },
      "cast_panel": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "theater_sidebar" }
    }
  },
  "campaigns": [],
  "slots": [],
  "monetization_presentation": {
    "paywall_style": "soft-educational",
    "access_style": "episode-hint",
    "cta_style": "banner-bottom",
    "premium_cta_style": "SUBTLE"
  },
  "watch_features": {
    "continue_watching_enabled": true,
    "recommendations_enabled": false,
    "downloads_enabled": false,
    "comments_enabled": true
  },
  "extensions": {},
  "provenance": {
    "labels.episode_label": { "value": "Episode", "source": "platform", "scope": "platform", "profile_version": null },
    "layout.preset_key": { "value": "DOCUMENTARY", "source": "profile", "scope": "studio_series:d4000000-0000-4000-8000-000000000004", "profile_version": "f7000000-0000-4000-8000-000000000007" },
    "visibility.hero.mode": { "value": "STATIC_IMAGE", "source": "profile", "scope": "studio_series:d4000000-0000-4000-8000-000000000004", "profile_version": "f7000000-0000-4000-8000-000000000007" }
  }
}
```

### 11.2 Music video profile

```json
{
  "schema_version": "1.0.0",
  "resolve_context": {
    "episode_id": "e1000000-0000-4000-8000-000000000010",
    "reel_id": "e2000000-0000-4000-8000-000000000011",
    "project_id": "e3000000-0000-4000-8000-000000000012",
    "series_id": null,
    "season_id": null,
    "resolved_at": "2026-06-03T12:00:00Z",
    "enforce_paywall": false
  },
  "experience_profile": {
    "profile_family_id": "e4000000-0000-4000-8000-000000000013",
    "profile_version_id": "e5000000-0000-4000-8000-000000000014",
    "profile_version": 1,
    "profile_family_name": "Artist Access",
    "content_format": "MUSIC_VIDEO",
    "pin_version": false,
    "status": "ACTIVE"
  },
  "layout": {
    "preset_key": "ARTIST_ACCESS",
    "preset_name": "Artist Access",
    "definition": {
      "panels": {
        "hero": { "visible": true, "zone": "top" },
        "artist_panel": { "visible": true, "zone": "theater_sidebar" },
        "continue_watching": { "visible": false, "zone": "below_hero" },
        "recommendations": { "visible": true, "zone": "main_shelf" },
        "downloads": { "visible": true, "zone": "theater_sidebar" }
      },
      "shelf_order": ["recommendations"],
      "cta": { "zone": "hero_overlay" }
    }
  },
  "theme": {
    "token_set_id": "e6000000-0000-4000-8000-000000000015",
    "token_set_slug": "artist-access",
    "tokens": {
      "hero_surface": { "variant": "vertical-bold" },
      "accent_surface": { "variant": "neon-accent" },
      "button_style": { "variant": "pill-glow" }
    }
  },
  "labels": {
    "episode_label": "Track",
    "series_label": "Album",
    "vip_label": "Fan Club",
    "bonus_content_label": "B-Side"
  },
  "metadata": {
    "artist_name": "Example Artist",
    "merch_url": "https://example.com/merch",
    "tour_date": "2026-09-15"
  },
  "visibility": {
    "hero": {
      "enabled": true,
      "mode": "STATIC_VIDEO",
      "autoplay": true,
      "carousel_interval_seconds": 8,
      "overlay_enabled": true
    },
    "panels": {
      "hero": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "top" },
      "artist_panel": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "theater_sidebar" },
      "continue_watching": { "effective_visible": false, "baseline_visible": false, "profile_enabled": false, "zone": "below_hero" },
      "recommendations": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "main_shelf" },
      "downloads": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "theater_sidebar" }
    }
  },
  "campaigns": [
    {
      "id": "e7000000-0000-4000-8000-000000000016",
      "campaign_name": "Tour Premiere",
      "campaign_type": "PREMIERE",
      "status": "active",
      "start_date": "2026-06-01T00:00:00Z",
      "end_date": "2026-06-30T23:59:59Z",
      "priority": 10,
      "target_episode_id": "e1000000-0000-4000-8000-000000000010"
    }
  ],
  "slots": [
    {
      "slot_key": "hero_promo",
      "campaign_id": "e7000000-0000-4000-8000-000000000016",
      "scope_type": "episode",
      "scope_id": "e1000000-0000-4000-8000-000000000010",
      "status": "active",
      "zone_hint": "top",
      "content_ref": { "episode_id": "e1000000-0000-4000-8000-000000000010" }
    }
  ],
  "monetization_presentation": {
    "premium_cta_style": "PILL",
    "cta_style": "merch-cta"
  },
  "watch_features": {
    "continue_watching_enabled": false,
    "recommendations_enabled": true,
    "downloads_enabled": true,
    "comments_enabled": true
  },
  "extensions": {
    "custom_metadata": {
      "values": { "tour_date": "2026-09-15" }
    }
  },
  "provenance": {
    "metadata.artist_name": { "value": "Example Artist", "source": "episode", "scope": "studio_episodes:e1000000-0000-4000-8000-000000000010", "profile_version": null },
    "visibility.panels.artist_panel.effective_visible": { "value": true, "source": "profile", "scope": "studio_projects:e3000000-0000-4000-8000-000000000012", "profile_version": "e5000000-0000-4000-8000-000000000014" },
    "slots[0].slot_key": { "value": "hero_promo", "source": "campaign", "scope": "campaign:e7000000-0000-4000-8000-000000000016", "profile_version": null }
  }
}
```

### 11.3 Micro-drama profile

```json
{
  "schema_version": "1.0.0",
  "resolve_context": {
    "episode_id": "m1000000-0000-4000-8000-000000000020",
    "reel_id": "m2000000-0000-4000-8000-000000000021",
    "project_id": "m3000000-0000-4000-8000-000000000022",
    "series_id": "m4000000-0000-4000-8000-000000000023",
    "season_id": "m5000000-0000-4000-8000-000000000024",
    "resolved_at": "2026-06-03T12:00:00Z",
    "enforce_paywall": false
  },
  "experience_profile": {
    "profile_family_id": "m6000000-0000-4000-8000-000000000025",
    "profile_version_id": "m7000000-0000-4000-8000-000000000026",
    "profile_version": 3,
    "profile_family_name": "Micro Drama Premium",
    "content_format": "MICRO_DRAMA",
    "pin_version": true,
    "status": "ACTIVE"
  },
  "layout": {
    "preset_key": "REELSHORT",
    "preset_name": "ReelShort Vertical",
    "definition": {
      "panels": {
        "hero": { "visible": true, "zone": "top" },
        "continue_watching": { "visible": true, "zone": "below_hero" },
        "recommendations": { "visible": true, "zone": "main_shelf" },
        "categories": { "visible": false, "zone": "main_shelf" },
        "timeline": { "visible": true, "zone": "theater_bottom" }
      },
      "shelf_order": ["continue_watching", "recommendations"],
      "cta": { "zone": "hero_overlay" }
    }
  },
  "theme": {
    "token_set_id": "m8000000-0000-4000-8000-000000000027",
    "token_set_slug": "micro-drama",
    "tokens": {
      "hero_surface": { "variant": "vertical-bold" },
      "panel_surface": { "variant": "dark" },
      "card_style": { "variant": "vertical-thumbnail" }
    }
  },
  "labels": {
    "episode_label": "Ep",
    "season_label": "Ch",
    "series_label": "Show",
    "vip_label": "VIP Early"
  },
  "metadata": {},
  "visibility": {
    "hero": {
      "enabled": true,
      "mode": "CAROUSEL_VIDEOS",
      "autoplay": true,
      "carousel_interval_seconds": 5,
      "overlay_enabled": true
    },
    "panels": {
      "hero": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "top" },
      "continue_watching": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "below_hero" },
      "recommendations": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "main_shelf" },
      "categories": { "effective_visible": false, "baseline_visible": false, "profile_enabled": null, "zone": "main_shelf" },
      "timeline": { "effective_visible": true, "baseline_visible": true, "profile_enabled": true, "zone": "theater_bottom" }
    }
  },
  "campaigns": [
    {
      "id": "m9000000-0000-4000-8000-000000000028",
      "campaign_name": "Season Finale Week",
      "campaign_type": "PROMOTION",
      "status": "active",
      "priority": 5
    }
  ],
  "slots": [
    {
      "slot_key": "shelf_featured",
      "campaign_id": "m9000000-0000-4000-8000-000000000028",
      "scope_type": "series",
      "scope_id": "m4000000-0000-4000-8000-000000000023",
      "status": "active",
      "zone_hint": "main_shelf"
    }
  ],
  "monetization_presentation": {
    "paywall_style": "vertical-modal",
    "access_style": "episode-lock-hint",
    "premium_cta_style": "MODAL"
  },
  "watch_features": {
    "continue_watching_enabled": true,
    "recommendations_enabled": true,
    "downloads_enabled": false,
    "comments_enabled": true
  },
  "extensions": {},
  "provenance": {
    "labels.episode_label": { "value": "Ep", "source": "profile", "scope": "studio_series:m4000000-0000-4000-8000-000000000023", "profile_version": "m7000000-0000-4000-8000-000000000026" },
    "experience_profile.pin_version": { "value": true, "source": "episode", "scope": "studio_episodes:m1000000-0000-4000-8000-000000000020", "profile_version": null },
    "layout.preset_key": { "value": "REELSHORT", "source": "profile", "scope": "studio_series:m4000000-0000-4000-8000-000000000023", "profile_version": "m7000000-0000-4000-8000-000000000026" }
  }
}
```

---

## 12. Consumer Obligations

### 12.1 Viewer (Phase 2+)

- Bind UI only to RVE sections relevant to render path.
- Treat `visibility.panels.*.effective_visible` as authoritative — do not recompute intersection.
- Ignore `provenance` in production render unless debug mode.
- Never read `platform_hero_config`, `platform_campaigns`, or experience tables directly.

### 12.2 Studio

- Use write APIs for mutations.
- Preview experience only via cached `GET /api/experience/resolve`.
- Display provenance in inspector UI for debugging.

### 12.3 Resolver (implementation phase)

- Single entry: `resolve(context) -> Result<ResolvedViewerExperience, ResolveError>`.
- Validate against JSON Schema derived from this document before serialization.
- Populate full provenance map.

### 12.4 Campaign engine (Phase 1b+)

- Expose `inject_campaign_metadata(&ResolveContext) -> (campaigns, slots)` — no public merge.

---

## 13. Relationship to Implementation Phases

| Phase | Deliverable tied to this contract |
|-------|-----------------------------------|
| **1a.1** (this document) | Normative RVE schema |
| **1a.2** | [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md) + [`schemas/resolved_viewer_experience.schema.json`](../schemas/resolved_viewer_experience.schema.json) |
| **1a.3** | Migrations 288/289 aligned to contract fields |
| **1a.4** | `experience_resolve.rs` implements §5 merge + §10 validation |
| **1b** | Campaign injector populates §8.8–8.9 only |
| **2+** | Viewer render-only consumption per §12.1 |

**Amendment process:** Changes to this contract require version bump per §2–§3 and explicit approval before resolver or Viewer consumption ships.

---

**Document path:** `docs/RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`  
**Supersedes:** Informal resolve examples in `VIEWER_EXPERIENCE_LAYER_ARCHITECTURE.md` §3.6 for wire format (storage design in that doc remains authoritative).
