# ResolvedViewerExperience — JSON Schema Specification

**Phase:** 1a.2 — JSON Schema Generation  
**Status:** Normative (architecture artifact)  
**Contract source:** [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md)  
**Machine schema:** [`../schemas/resolved_viewer_experience.schema.json`](../schemas/resolved_viewer_experience.schema.json)  
**Schema version:** `1.0.0`  
**JSON Schema draft:** [2020-12](https://json-schema.org/draft/2020-12/schema)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Artifact Locations](#2-artifact-locations)
3. [Schema Structure Map](#3-schema-structure-map)
4. [Required vs Optional Fields](#4-required-vs-optional-fields)
5. [Enum Registry](#5-enum-registry)
6. [Provenance Validation](#6-provenance-validation)
7. [Campaign & Slot Structures](#7-campaign--slot-structures)
8. [Extension Containers](#8-extension-containers)
9. [Metadata Typing & Reserved Namespaces](#9-metadata-typing--reserved-namespaces)
10. [Null-Critical Validation Failures](#10-null-critical-validation-failures)
11. [Backward Compatibility Handling](#11-backward-compatibility-handling)
12. [Validation Example Cases](#12-validation-example-cases)
13. [Implementation Guidance](#13-implementation-guidance)
14. [CI & Tooling Recommendations](#14-ci--tooling-recommendations)

---

## 1. Overview

This document describes the machine-validatable JSON Schema derived from the approved RVE contract. The schema enforces:

- Top-level section presence and shape
- Closed enums for hero modes, layout presets, campaign types, provenance sources
- Provenance entry structure on every null-critical dot-path
- Reserved metadata namespace rejection
- Extension container shapes (optional)

**Out of scope for JSON Schema alone** (resolver-internal checks documented in §10.3):

- Visibility intersection math (`effective_visible = baseline AND profile_enabled`)
- Full provenance coverage for every optional leaf field
- Per-metadata-key `data_type` validation against `metadata_definitions`

---

## 2. Artifact Locations

| Artifact | Path |
|----------|------|
| JSON Schema | `schemas/resolved_viewer_experience.schema.json` |
| Human specification | `docs/RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md` (this file) |
| Contract (normative semantics) | `docs/RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md` |
| Example payloads (contract §11) | Embedded in contract document |

---

## 3. Schema Structure Map

```
ResolvedViewerExperience
├── schema_version          [required, semver]
├── resolve_context         [required]
├── experience_profile      [optional]
├── layout                  [required]
├── theme                   [required]
├── labels                  [required]
├── metadata                [required, may be {}]
├── visibility              [required]
├── campaigns               [required, may be []]
├── slots                   [required, may be []]
├── monetization_presentation [required]
├── watch_features          [required]
├── extensions              [optional]
└── provenance              [required, min 8 keys]
```

`$id`: `https://reelforge.dev/schemas/resolved_viewer_experience/1.0.0`

Root `additionalProperties: false` — strict resolver output validation. Unknown top-level keys fail schema validation.

---

## 4. Required vs Optional Fields

### 4.1 Top-level

| Field | JSON Schema | Contract |
|-------|-------------|----------|
| `schema_version` | required | required |
| `resolve_context` | required | required |
| `experience_profile` | optional | optional (omit if no attachment) |
| `layout` | required | required |
| `theme` | required | required |
| `labels` | required | required |
| `metadata` | required | required (empty object allowed) |
| `visibility` | required | required |
| `campaigns` | required | required (empty array allowed) |
| `slots` | required | required (empty array allowed) |
| `monetization_presentation` | required | required |
| `watch_features` | required | required |
| `extensions` | optional | optional |
| `provenance` | required | required |

### 4.2 `resolve_context`

| Field | Required | Notes |
|-------|----------|-------|
| `project_id` | Yes | UUID |
| `resolved_at` | Yes | `date-time` |
| `enforce_paywall` | Yes | Must be `false` (const) |
| `episode_id` | Conditional | At least one of `episode_id` \| `reel_id` (`anyOf`) |
| `reel_id` | Conditional | At least one of `episode_id` \| `reel_id` |
| `series_id` | No | nullable UUID |
| `season_id` | No | nullable UUID |

### 4.3 `experience_profile` (when present)

All fields required when section exists: `profile_family_id`, `profile_version_id`, `profile_version`, `content_format`, `pin_version`, `status`.

### 4.4 `labels`

| Field | Required |
|-------|----------|
| `episode_label` | **Yes** (null-critical) |
| All others | No |

### 4.5 `layout`

| Field | Required |
|-------|----------|
| `preset_key` | **Yes** |
| `definition` | **Yes** |
| `definition.panels` | **Yes** (object, may be empty) |
| `definition.shelf_order` | **Yes** (array, may be empty) |
| `preset_name` | No |

---

## 5. Enum Registry

| Path | Allowed values |
|------|----------------|
| `schema_version` (1.0.0 impl) | `1.0.0` (const via `allOf`) |
| `experience_profile.content_format` | `GENERIC`, `MICRO_DRAMA`, `DOCUMENTARY`, `MUSIC_VIDEO`, `REALITY`, `EDUCATIONAL`, `CREATOR_COURSE`, `CREATOR_CHANNEL`, `LIVESTREAM_REPLAY` |
| `experience_profile.status` | `ACTIVE`, `ARCHIVED` |
| `layout.preset_key` | `MINIMAL`, `NETFLIX`, `REELSHORT`, `DOCUMENTARY`, `ARTIST_ACCESS`, `EDUCATIONAL`, `CUSTOM` |
| `visibility.hero.mode` | `OFF`, `STATIC_IMAGE`, `STATIC_VIDEO`, `CAROUSEL_IMAGES`, `CAROUSEL_VIDEOS`, `MIXED` |
| `theme.tokens` keys | `hero_surface`, `panel_surface`, `accent_surface`, `typography_style`, `button_style`, `card_style`, `overlay_style` |
| `campaigns[].campaign_type` | `CONTEST`, `PREMIERE`, `PROMOTION`, `SPONSOR` |
| `campaigns[].status` | `draft`, `scheduled`, `active`, `ended`, `archived` |
| `slots[].scope_type` | `project`, `series`, `season`, `episode`, `platform` |
| `slots[].status` | `scheduled`, `active`, `ended` |
| `slots[].slot_key` (standard) | `hero_promo`, `shelf_featured`, `theater_overlay`, `shelf_badge` |
| `slots[].slot_key` (custom) | Pattern `^custom\.[a-z][a-z0-9_]*$` |
| `monetization_presentation.premium_cta_style` | `NONE`, `SUBTLE`, `BANNER`, `MODAL`, `PILL` |
| `provenance.*.source` | `default`, `platform`, `project`, `series`, `season`, `episode`, `profile`, `campaign` |
| `visibility.panels.*.disabled_by` | `preset`, `profile`, `null` |

---

## 6. Provenance Validation

### 6.1 Entry shape (`$defs/provenanceEntry`)

```json
{
  "value": "<any>",
  "source": "<provenanceSource enum>",
  "scope": "<string|null>",
  "profile_version": "<uuid|null>"
}
```

| Subfield | Schema required |
|----------|-----------------|
| `value` | Yes |
| `source` | Yes |
| `scope` | No |
| `profile_version` | No |

### 6.2 Required provenance keys (schema-enforced minimum)

The schema requires these dot-path keys in `provenance` (`minProperties: 6`):

| Key | Null-critical field |
|-----|---------------------|
| `schema_version` | Yes |
| `resolve_context.project_id` | Yes |
| `layout.preset_key` | Yes |
| `labels.episode_label` | Yes |
| `visibility.hero.mode` | Yes |
| `visibility.hero.enabled` | Yes |

**Conditional (when `experience_profile` present):**

| Key |
|-----|
| `experience_profile.profile_version_id` |
| `experience_profile.content_format` |

### 6.3 Full provenance coverage (resolver obligation)

JSON Schema does **not** enumerate all leaf paths. The resolver **must** populate provenance for every leaf field in contract §8.1–8.11 before returning HTTP 200. A post-schema linter (Phase 1a.4) should diff resolved payload leaves against `provenance` keys.

---

## 7. Campaign & Slot Structures

### 7.1 Campaign object

Required: `id`, `campaign_name`, `campaign_type`, `status`.

Optional: `start_date`, `end_date`, `priority`, `target_series_id`, `target_episode_id`.

**Forbidden properties (contract §8.8):** `playback_url`, `layout_override` — not in schema (`additionalProperties: false`).

### 7.2 Slot object

Required: `slot_key`, `scope_type`, `status`.

Optional: `campaign_id`, `scope_id`, `content_ref`, `zone_hint`.

`slot_key` accepts standard enum values **or** `custom.<name>` pattern for extension slots in the main `slots` array.

---

## 8. Extension Containers

Optional top-level `extensions` with `additionalProperties: false` at namespace level.

| Namespace | Shape |
|-----------|-------|
| `custom_metadata` | `{ definitions?: array, values?: object }` |
| `custom_slots` | `{ slots: customSlot[] }` — keys must match `custom.*` |
| `future_ai_modules` | `{ modules: [{ module_id, payload? }] }` |
| `future_recommendation_modules` | `{ engine_id?, shelf_hints? }` |
| `future_ad_modules` | `{ placements: object[] }` |

Unrecognized extension namespaces at the `extensions` level **fail** strict schema validation. Additive minor versions may extend `extensions.properties` in schema `1.1.0`.

---

## 9. Metadata Typing & Reserved Namespaces

### 9.1 Key pattern (`$defs/metadataKey`)

```
^(?!rf\.)(?!system\.)(?!internal\.)(?!ai\.)(?!ads\.)(?!recommendation\.)[a-z][a-z0-9_]*$
```

| Rule | Behavior |
|------|----------|
| Reserved prefixes | `rf.`, `system.`, `internal.`, `ai.`, `ads.`, `recommendation.` — **rejected** |
| Allowed keys | Lowercase snake_case starting with `a-z`, e.g. `artist_name`, `merch_url` |
| Applies to | `metadata`, `extensions.custom_metadata.values` |

### 9.2 Value types (`$defs/metadataValue`)

Schema allows: `string`, `number`, `boolean`, `object`, `array`, `null`.

**Compose-time validation (resolver, not JSON Schema):**

| `data_type` | Value constraint |
|-------------|------------------|
| `TEXT` | string |
| `URL` | string + HTTPS pattern from definition `validation` |
| `DATE` | string, ISO date |
| `NUMBER` | number |
| `BOOLEAN` | boolean |
| `JSON` | object or array |

---

## 10. Null-Critical Validation Failures

When any null-critical constraint fails, the resolver **must not** return a partial RVE.

### 10.1 Schema-detectable (fail JSON Schema validation)

| Code | Path | Failure |
|------|------|---------|
| `NC-001` | `schema_version` | Missing or invalid SemVer |
| `NC-002` | `resolve_context` | Missing `project_id`, `resolved_at`, or `enforce_paywall !== false` |
| `NC-003` | `resolve_context` | Neither `episode_id` nor `reel_id` present |
| `NC-004` | `layout.preset_key` | Missing or invalid enum |
| `NC-005` | `layout.definition.panels` | Missing or not object |
| `NC-006` | `labels.episode_label` | Missing or empty string |
| `NC-007` | `visibility.hero.mode` | Missing or invalid enum |
| `NC-008` | `visibility.hero.enabled` | Missing or not boolean |
| `NC-009` | `provenance` | Missing required minimum keys |
| `NC-010` | `metadata.<key>` | Key matches reserved prefix |
| `NC-011` | `experience_profile.*` | Section present but missing required subfields |

### 10.2 Resolver-only (post-schema checks)

| Code | Check | HTTP |
|------|-------|------|
| `NC-101` | Provenance missing for any emitted leaf field | 500 |
| `NC-102` | `effective_visible` ≠ `baseline_visible && (profile_enabled ?? true)` | 500 |
| `NC-103` | Pinned profile version is `DRAFT` | 422 |
| `NC-104` | Metadata value fails `data_type` / `validation` fragment | 422 |
| `NC-105` | Campaign object contains forbidden playback/layout keys | 500 |

### 10.3 HTTP error body (recommended)

```json
{
  "error": "resolve_validation_failed",
  "codes": ["NC-006", "NC-009"],
  "fields": ["labels.episode_label", "provenance.labels.episode_label"]
}
```

---

## 11. Backward Compatibility Handling

### 11.1 Strict output validation (resolver / API)

- Validate resolver output against `resolved_viewer_experience.schema.json` for declared `schema_version`.
- Reject output that does not match — no partial payloads.

### 11.2 Lenient input validation (future consumers)

When a **future** schema `1.1.0` adds optional fields:

| Consumer age | Behavior |
|--------------|----------|
| 1.0.0 consumer | Ignore unknown keys (contract §3.4) |
| 1.0.0 strict validator | Fail on unknown keys — use only for resolver output QA |

### 11.3 Version negotiation (future)

| Header | Behavior |
|--------|----------|
| `Accept-Experience-Schema: 1.0` | Return RVE `1.0.0` |
| Unsupported version | `406 Not Acceptable` |

### 11.4 Schema evolution checklist

1. Bump contract SemVer (major / minor / patch).
2. Copy `resolved_viewer_experience.schema.json` → `1.x.x` filename or update `$id`.
3. Register version in contract §2.3 table.
4. Add migration notes for resolver changes.

---

## 12. Validation Example Cases

Use contract §11 payloads as fixtures. Validate with any JSON Schema 2020-12 validator (see §14).

### 12.1 Valid — documentary profile

**Source:** Contract §11.1  
**Expected:** Pass schema validation.

**Spot checks:**

- `layout.preset_key` = `DOCUMENTARY`
- `visibility.hero.mode` = `STATIC_IMAGE`
- `campaigns` = `[]`, `slots` = `[]`
- `enforce_paywall` = `false`
- Provenance includes minimum required keys (extend abbreviated contract example before CI use)

### 12.2 Valid — music video profile

**Source:** Contract §11.2  
**Expected:** Pass schema validation.

**Spot checks:**

- `experience_profile.content_format` = `MUSIC_VIDEO`
- `layout.preset_key` = `ARTIST_ACCESS`
- `campaigns[0].campaign_type` = `PREMIERE`
- `slots[0].slot_key` = `hero_promo`
- `metadata.artist_name` present (key passes reserved-namespace pattern)

### 12.3 Valid — micro-drama profile

**Source:** Contract §11.3  
**Expected:** Pass schema validation.

**Spot checks:**

- `experience_profile.pin_version` = `true`
- `layout.preset_key` = `REELSHORT`
- `visibility.hero.mode` = `CAROUSEL_VIDEOS`
- `visibility.hero.carousel_interval_seconds` = 5 (within 3–120)

### 12.4 Invalid examples

#### INV-001 — Missing null-critical `episode_label`

```json
{
  "schema_version": "1.0.0",
  "resolve_context": {
    "episode_id": "a1000000-0000-4000-8000-000000000001",
    "project_id": "c3000000-0000-4000-8000-000000000003",
    "resolved_at": "2026-06-03T12:00:00Z",
    "enforce_paywall": false
  },
  "labels": {},
  "layout": { "preset_key": "MINIMAL", "definition": { "panels": {}, "shelf_order": [] } },
  "theme": { "tokens": {} },
  "metadata": {},
  "visibility": { "hero": { "enabled": true, "mode": "OFF" }, "panels": { "hero": { "effective_visible": true, "baseline_visible": true } } },
  "campaigns": [],
  "slots": [],
  "monetization_presentation": {},
  "watch_features": { "continue_watching_enabled": false, "recommendations_enabled": false, "downloads_enabled": false, "comments_enabled": false },
  "provenance": {
    "schema_version": { "value": "1.0.0", "source": "default" },
    "resolve_context.project_id": { "value": "c3000000-0000-4000-8000-000000000003", "source": "episode", "scope": "studio_episodes:a1000000-0000-4000-8000-000000000001" },
    "layout.preset_key": { "value": "MINIMAL", "source": "default" },
    "visibility.hero.mode": { "value": "OFF", "source": "default" },
    "visibility.hero.enabled": { "value": true, "source": "default" }
  }
}
```

**Expected failure:** `NC-006` — `labels.episode_label` required.

---

#### INV-002 — Reserved metadata key `ai.shelf_rank`

```json
{
  "metadata": { "ai.shelf_rank": 1 }
}
```

**Expected failure:** `NC-010` — property name fails `metadataKey` pattern.

---

#### INV-003 — Invalid `enforce_paywall`

```json
{
  "resolve_context": { "enforce_paywall": true }
}
```

**Expected failure:** `NC-002` — const violation (`enforce_paywall` must be `false`).

---

#### INV-004 — Missing resolve context identifiers

```json
{
  "resolve_context": {
    "project_id": "c3000000-0000-4000-8000-000000000003",
    "resolved_at": "2026-06-03T12:00:00Z",
    "enforce_paywall": false
  }
}
```

**Expected failure:** `NC-003` — neither `episode_id` nor `reel_id`.

---

#### INV-005 — Invalid provenance source

```json
{
  "provenance": {
    "labels.episode_label": {
      "value": "Ep",
      "source": "hierarchy"
    }
  }
}
```

**Expected failure:** `source` not in closed enum (`hierarchy` is not valid; use `series`, `season`, etc.).

---

#### INV-006 — Legacy hero mode enum

```json
{
  "visibility": {
    "hero": { "enabled": true, "mode": "STATIC" },
    "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
  }
}
```

**Expected failure:** `NC-007` — `STATIC` not in v2 `heroMode` enum.

---

#### INV-007 — Campaign forbidden shape (extra property)

```json
{
  "campaigns": [
    {
      "id": "e7000000-0000-4000-8000-000000000016",
      "campaign_name": "Bad",
      "campaign_type": "PREMIERE",
      "status": "active",
      "playback_url": "https://example.com/video.mp4"
    }
  ]
}
```

**Expected failure:** `additionalProperties: false` on campaign object.

---

#### INV-008 — Incomplete provenance entry

```json
{
  "provenance": {
    "labels.episode_label": { "value": "Ep" }
  }
}
```

**Expected failure:** missing required `source` on provenance entry.

---

## 13. Implementation Guidance

### 13.1 Rust validation layer (Phase 1a.4 — not implemented here)

| Concern | Recommendation |
|---------|----------------|
| Crate | [`jsonschema`](https://crates.io/crates/jsonschema) (draft 2020-12) or compile-time via `typify` + manual checks |
| Embed schema | `include_str!("../../schemas/resolved_viewer_experience.schema.json")` at compile time |
| Type generation | Optional: `schemars` on Rust structs derived from contract, with `validate` against embedded JSON Schema |
| Module layout | `backend/src/experience/contract.rs` — version constants, `ResolvedViewerExperience` struct |
| Validation fn | `validate_rve(value: &serde_json::Value) -> Result<(), ValidationError>` |

```rust
// Pseudocode — guidance only
pub fn validate_resolved_viewer_experience(value: &serde_json::Value) -> Result<(), RveValidationError> {
    SCHEMA.validate(value)?;
    check_reserved_metadata_keys(value)?;
    check_provenance_coverage(value)?;
    check_visibility_intersection(value)?;
    Ok(())
}
```

### 13.2 Resolver output validation

| Step | When | Action |
|------|------|--------|
| 1 | After merge complete | Build `serde_json::Value` or struct |
| 2 | Pre-serialize | `validate_resolved_viewer_experience(&value)` |
| 3 | On failure | Log compose context; return `NC-*` error — **no HTTP body** |
| 4 | On success | Serialize to JSON response |

Resolver remains sole composer; validation is the exit gate.

### 13.3 API response validation

| Layer | Strictness | Purpose |
|-------|------------|---------|
| Production | Full schema + NC-101–105 | Guarantee contract integrity |
| Debug middleware | Optional second pass logging warnings | Studio preview QA |
| Tests | Golden fixtures from §12.1–12.3 | CI regression |

`GET /api/experience/resolve` should set:

```
Content-Type: application/json
X-Experience-Schema-Version: 1.0.0
```

### 13.4 Write-path validation (Studio)

Metadata **writes** (not RVE) should validate keys against `$defs/metadataKey` **before** insert into `metadata_values`. Reserved namespaces rejected at write time with `400`:

```json
{ "error": "reserved_metadata_key", "key": "ai.shelf_rank" }
```

---

## 14. CI & Tooling Recommendations

### 14.1 Validate schema file is well-formed

```bash
python3 -c "import json; json.load(open('schemas/resolved_viewer_experience.schema.json'))"
```

### 14.2 Validate example fixtures (when added)

```bash
# Using npx (no repo install required)
npx --yes ajv-cli validate \
  -s schemas/resolved_viewer_experience.schema.json \
  -d tests/fixtures/rve/documentary.valid.json \
  --spec=draft2020
```

### 14.3 Recommended fixture paths (Phase 1a.4)

```
tests/fixtures/rve/
  documentary.valid.json
  music_video.valid.json
  micro_drama.valid.json
  inv_missing_episode_label.json
  inv_reserved_metadata_key.json
```

Copy full payloads from contract §11 into `*.valid.json` and expand abbreviated `provenance` blocks to satisfy §6.2 minimum + contract full coverage before CI gating.

---

## 15. Relationship to Next Phases

| Phase | Uses this schema |
|-------|------------------|
| 1a.3 | Migrations align column enums to §5 |
| 1a.4 | Rust resolver validates output before return |
| 1b | Campaign injector populates §7 structures |
| 2+ | Viewer deserializes RVE (lenient unknown fields) |

---

**Document path:** `docs/RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`  
**Schema path:** `schemas/resolved_viewer_experience.schema.json`
