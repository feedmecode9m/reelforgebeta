# Phase 1b.7 — System Consolidation & Contract Lock

**Phase:** 1b.7 — Stabilization (no new features)  
**Status:** Frozen semantic contracts  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio

**Scope:** Contract freeze validation register, cross-layer invariants, regression guards, and Phase 1c boundary pointer. No implementation features, schema, API, or Viewer rendering changes in this phase.

---

## 1. Contract Freeze Validation

### 1.1 Frozen wire semantics (`metadata` media fields)

| Field | Allowed values | Source module |
|-------|----------------|---------------|
| `media_state` | `REAL_MEDIA`, `DERIVED_MEDIA`, `PLACEHOLDER_MEDIA`, `FALLBACK_MEDIA` | `media/placeholder_policy.rs` |
| `media_intent` | `MICRO_DRAMA`, `MUSIC_VIDEO`, `CLIP`, `DOCUMENTARY`, `UNKNOWN` | `media/placeholder_policy.rs` |
| `media_placeholder_policy` | `CONTENT_ONLY`, `CONTENT_THEN_PLACEHOLDER`, `CONTENT_THEN_GENERATED`, `FULLY_SYNTHETIC_ALLOWED` | `media/placeholder_policy.rs` |
| `inventory_state` | `PENDING`, `READY`, `MISSING`, `FAILED` | `media/inventory_state.rs` |
| `thumbnail_resolution` | `SHOULD_EXIST`, `ALLOW_DERIVED`, `MUST_PLACEHOLDER` | `media/thumbnail_policy.rs` |
| `media_failure_mode` | `none`, `missing_reference`, `stale_reference`, `delayed_availability` | `media/failure_model.rs` |
| `media_reference_validity` | `valid`, `absent`, `stale`, `pending` | `media/failure_model.rs` |
| `media_reference` | Opaque string (`episode:{uuid}`) or `null` | `media/media_semantic_resolver.rs` |

**NC-105:** No URL-shaped strings in `campaigns[]`, `slots[]`, or media fields.

### 1.2 `media_intent` rules (frozen)

| Input | `media_intent` |
|-------|----------------|
| `experience_profile.content_format` | Primary source when present |
| `metadata.harness_content_format` | Harness / fixture fallback |
| Other | `UNKNOWN` |

Intent does not branch on episode title, cast, or ingestion paths.

### 1.3 `inventory_state` → `media_state` (frozen)

| `inventory_state` | Typical `media_state` (policy permitting) |
|-------------------|-------------------------------------------|
| `READY` + valid reference | `REAL_MEDIA` |
| `READY` + stale reference | `DERIVED_MEDIA` or placeholder/fallback |
| `READY` + absent reference | Placeholder or fallback |
| `PENDING` / delayed | `PLACEHOLDER_MEDIA` or `FALLBACK_MEDIA` |
| `MISSING` | `PLACEHOLDER_MEDIA`, `DERIVED_MEDIA`, or `FALLBACK_MEDIA` |
| `FAILED` | `FALLBACK_MEDIA` |

Default inventory when unspecified: `MISSING` (no persistence layer in 1b).

### 1.4 CSPP slot rules (frozen)

| Rule ID | Statement |
|---------|-----------|
| CSPP-1 | Mutates only `campaigns[]` and `slots[]` |
| CSPP-2 | Structural sections identical to Base RVE (`structural_snapshot`) |
| CSPP-3 | Active campaigns only in `campaigns[]` (`status: active`) |
| CSPP-4 | Hero collision: one `hero_promo` winner per resolve |
| CSPP-5 | Priority: `priority` → targeting → type band → UUID |
| CSPP-6 | No reads of `metadata.media_*` |

### 1.5 Resolver invariants (frozen)

| Rule ID | Statement |
|---------|-----------|
| RES-1 | Sole composer for §8.1–8.7, §8.10–8.11 |
| RES-2 | `campaigns[]` always `[]` in Base RVE (RDR-130) |
| RES-3 | No `platform_campaigns` reads in `experience_resolve.rs` |
| RES-4 | `validate_rve` before Base RVE return |

### 1.6 Viewer sim invariants (frozen)

| Rule ID | Statement |
|---------|-----------|
| VIEW-1 | Inputs: Base RVE + Delivered RVE only |
| VIEW-2 | No merge, campaign time evaluation, or URL construction |
| VIEW-3 | `CompositionPlan` deterministic (DET-1) |
| VIEW-4 | Tolerates `media_reference: null` |

---

## 2. Cross-Layer Invariance Tests

Implemented in `backend/src/experience/pipeline_integration_tests.rs` (§ `contract_lock_*`):

| Test | Layers |
|------|--------|
| `contract_lock_frozen_enum_consistency` | media types ↔ wire strings |
| `contract_lock_resolver_base_campaigns_empty` | resolver → pipeline |
| `contract_lock_resolver_media_metadata_present` | resolver → media |
| `contract_lock_cspp_structural_immutable` | resolver → CSPP |
| `contract_lock_cspp_viewer_determinism` | CSPP → viewer_sim |
| `contract_lock_failure_model_exhaustive` | media/failure_model |
| `contract_lock_inventory_state_complete` | media/inventory_state |

---

## 3. Regression Guard Tests

| Test | Guards |
|------|--------|
| `regression_missing_media_reference_stable` | `missing_reference` + null ref stability |
| `regression_placeholder_policy_documentary` | `CONTENT_THEN_PLACEHOLDER` stability |
| `regression_campaign_slot_collision_deterministic` | CSPP hero winner stability |
| `regression_viewer_surface_rendering_deterministic` | Identical `CompositionPlan` on repeat |

---

## 4. Pipeline Lock

**Unchanged:**

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

Orchestrator: `compose_pipeline::run_from_base_rve` / `run`.

---

## 5. Phase 1c Boundary

See [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) for systems explicitly **not** implemented.

---

## 6. Verdict

| Criterion | Status |
|-----------|--------|
| Contract freeze documented | ✅ |
| Cross-layer tests added | ✅ |
| Regression guards added | ✅ |
| Phase 1c boundary doc | ✅ |
| Pipeline unchanged | ✅ |
| No new features / schema / API / Viewer render | ✅ |

**Phase 1b semantic stack is locked for Phase 1c planning.**

---

*End of Phase 1b.7 contract lock.*
