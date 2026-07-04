# Resolver Decision Record — Phase 1a.4

**Status:** Normative — governs `experience_resolve.rs` implementation and tests  
**Authority:** [`RESOLVER_BOUNDARY_AUDIT.md`](./RESOLVER_BOUNDARY_AUDIT.md), [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md)

Each rule has ID **RDR-NNN**. Integration tests must reference these IDs.

---

## Global invariants

| ID | Rule |
|----|------|
| **RDR-000** | `experience_resolve.rs` is the sole composition authority. |
| **RDR-001** | All DB reads go through `experience::loader` only; zero `sqlx::query` in resolver file. |
| **RDR-002** | No writes, no `platform_hero_config`, no `get_full_config`. |
| **RDR-003** | `enforce_paywall` is always `false`. |
| **RDR-004** | `campaigns[]` is always `[]` until Phase 1b. |
| **RDR-005** | Every successful resolve calls `contract::validate_rve`; failure → HTTP 422. |
| **RDR-006** | `extensions` omitted in 1a.4 (not empty object required). |

---

## Merge order (strict)

| ID | Step | Source | Action |
|----|------|--------|--------|
| **RDR-010** | 1 | `default` | In-memory fallbacks when DB/platform missing. |
| **RDR-011** | 2 | `platform` | Load `platform_experience_defaults` (never `platform_hero_config`). |
| **RDR-012** | 3–6 | `project` → `series` → `season` → `episode` | For each level with `experience_profile_family_id`, load that level's profile version (pin or ACTIVE); overlay **non-null** fields onto merge state. |
| **RDR-013** | 7 | `profile` | `experience_profile` section uses `hierarchy::winning_attachment` (episode→…→project) version row. |
| **RDR-014** | 8 | layout | `layout_preset_id`: winning profile → platform default → `MINIMAL` seed. |
| **RDR-015** | 9 | theme | `theme_token_set_id`: winning profile → platform default → empty tokens. |
| **RDR-016** | 10 | visibility | `effective_visible = baseline_visible AND (profile_enabled.unwrap_or(true))` per panel in blueprint. |
| **RDR-017** | 11 | metadata | project → series → season → episode values; later scope wins same key. |
| **RDR-018** | 12 | slots | Union slot rows for platform/project/series/season/episode scopes; no campaign enrichment. |

---

## Section decisions

### resolve_context (RDR-020–024)

| ID | Rule |
|----|------|
| **RDR-020** | Require `episode_id`; reject missing episode with 404. |
| **RDR-021** | Populate `reel_id` from hierarchy when present. |
| **RDR-022** | `project_id`, `series_id`, `season_id` from hierarchy walk. |
| **RDR-023** | `resolved_at` = `Utc::now()` at compose time. |
| **RDR-024** | `enforce_paywall` = `false` (const). |

### experience_profile (RDR-030–034)

| ID | Rule |
|----|------|
| **RDR-030** | Omit entire section when no level has `profile_family_id`. |
| **RDR-031** | Pin: use `experience_profile_version_id`; reject if target status is `DRAFT` → 422 NC-103. |
| **RDR-032** | Unpinned: ACTIVE version for winning family's `profile_family_id`. |
| **RDR-033** | Include `profile_family_name` when family row load succeeds. |
| **RDR-034** | `status` reflects resolved version row (`ACTIVE` or `ARCHIVED` if pinned). |

### labels (RDR-040–043)

| ID | Rule |
|----|------|
| **RDR-040** | Merge order: project profile → series → season → episode profile overlays, then platform defaults, then hardcoded defaults. |
| **RDR-041** | `episode_label` null-critical; default `"Episode"`. |
| **RDR-042** | Unset optional labels fall back per RDR-040 chain. |
| **RDR-043** | Provenance records winning source layer per label field. |

### visibility.hero (RDR-050–055)

| ID | Rule |
|----|------|
| **RDR-050** | `hero.enabled`: merge bools RDR-012 then platform then default `true`. |
| **RDR-051** | `hero.mode`: merge strings RDR-012 then platform then default `OFF`. |
| **RDR-052** | `hero.autoplay`: merge optional bools; default `false`. |
| **RDR-053** | `hero.carousel_interval_seconds`: merge optional; platform default `8`; clamp 3–120 when set. |
| **RDR-054** | `hero.overlay_enabled`: merge optional; default `false`. |
| **RDR-055** | Hero enums must be v2 contract set only. |

### visibility.panels (RDR-060–065)

| ID | Rule |
|----|------|
| **RDR-060** | `baseline_visible` from layout blueprint `panels[id].visible` only. |
| **RDR-061** | `profile_enabled` from profile flag via panel→field map; `null` = inherit enabled (`true`). |
| **RDR-062** | `effective_visible` = `baseline_visible && profile_enabled.unwrap_or(true)`. |
| **RDR-063** | When `effective_visible` is false, set `disabled_by` to `"preset"` or `"profile"` accordingly. |
| **RDR-064** | `zone` copied from blueprint when present. |
| **RDR-065** | Panels in blueprint without flags in profile use RDR-061 null inherit. |

**Panel → profile flag map:**

| Panel id | Profile field |
|----------|---------------|
| `continue_watching` | `continue_watching_enabled` |
| `recommendations` | `recommendations_enabled` |
| `artist_panel` | `artist_panel_enabled` |
| `credits` | `credits_enabled` |
| `downloads` | `downloads_enabled` |
| `comments` | `comments_enabled` |
| `cast_panel` | `cast_panel_enabled` |
| `trivia` | `trivia_enabled` |
| `timeline` | `timeline_enabled` |

### watch_features (RDR-070–073)

| ID | Rule |
|----|------|
| **RDR-070** | `continue_watching_enabled`: merge RDR-012 chain then platform then `false`. |
| **RDR-071** | `recommendations_enabled`: same pattern. |
| **RDR-072** | `downloads_enabled`: same pattern. |
| **RDR-073** | `comments_enabled`: same pattern. |

### monetization_presentation (RDR-080–082)

| ID | Rule |
|----|------|
| **RDR-080** | `premium_cta_style`: profile override → platform → `NONE`. |
| **RDR-081** | `paywall_style`, `access_style`, `cta_style`: nullable merge RDR-012 then platform. |
| **RDR-082** | No access enforcement; presentation only. |

### layout (RDR-090–093)

| ID | Rule |
|----|------|
| **RDR-090** | Unknown `layout_preset_id` → fall back to `MINIMAL` preset row; provenance `default`. |
| **RDR-091** | `definition` copied verbatim from preset row JSON. |
| **RDR-092** | `preset_name` included when present on row. |
| **RDR-093** | `shelf_order` and `panels` required objects (may be empty). |

### theme (RDR-100–102)

| ID | Rule |
|----|------|
| **RDR-100** | Missing token set → `tokens: {}`, `token_set_id: null`. |
| **RDR-101** | Whole-set replacement from winning profile or platform set id. |
| **RDR-102** | `token_set_slug` from row when available else `"default-reelforge"`. |

### metadata (RDR-110–112)

| ID | Rule |
|----|------|
| **RDR-110** | Single batched read for all hierarchy scopes. |
| **RDR-111** | Later scope overwrites earlier for same `field_key`. |
| **RDR-112** | Reject reserved keys at compose time via `validate_metadata_key`. |

### slots (RDR-120–122)

| ID | Rule |
|----|------|
| **RDR-120** | Batched load for platform + project + series + season + episode scopes. |
| **RDR-121** | Map rows to contract slot shape; `campaign_id` may appear in row but **campaigns[]** stays `[]`. |
| **RDR-122** | Deduplicate by `(slot_key, scope_type, scope_id)` keeping last wins. |

### campaigns (RDR-130)

| ID | Rule |
|----|------|
| **RDR-130** | Always emit `"campaigns": []`. |

### provenance (RDR-140–143)

| ID | Rule |
|----|------|
| **RDR-140** | Every leaf field in output has provenance dot-path entry. |
| **RDR-141** | `source` uses contract enum; `profile_version` set when `source` is `profile`. |
| **RDR-142** | `scope` uses `studio_{level}:{uuid}` or `platform`. |
| **RDR-143** | Minimum schema-required provenance keys always present. |

### validation (RDR-150–152)

| ID | Rule |
|----|------|
| **RDR-150** | Run `validate_rve` before returning Ok. |
| **RDR-151** | Schema failure → `ResolveError::Validation` → API 422 with `fields` / `codes`. |
| **RDR-152** | Intersection mismatch (NC-102) → internal error 500 (should not occur if RDR-062 applied correctly). |

---

## Query budget (1a.4)

| ID | Rule |
|----|------|
| **RDR-200** | Log `query_count` in debug builds after resolve. |
| **RDR-201** | Target ≤ 10 queries; batched metadata + slots required. |

---

**Document path:** `docs/RESOLVER_DECISION_RECORD.md`
