# Asset Semantic Contract Lock — Unified Boundary Authority

**Phase:** 1c.4.1 — Contract consolidation (documentation only)  
**Status:** Immutable architectural authority  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio  
**Supersedes:** None (consolidates; does not amend implementation)

**Prerequisites:** [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md), [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md), [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md), [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md), [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md), [`CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md`](./CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md)

**Scope:** Single normative register for all Phase 1b semantic-layer and Phase 1c asset-bridge invariants. This document introduces **no** code, schema, pipeline, enum, or field changes.

**Explicit non-goals (1c.4.1):** Any implementation, test, API, storage, ingestion, CDN, thumbnail, or Viewer rendering work.

---

## Table of Contents

1. [Authority and Purpose](#1-authority-and-purpose)
2. [Frozen Production Pipeline](#2-frozen-production-pipeline)
3. [Canonical Failure and Outcome Model](#3-canonical-failure-and-outcome-model)
4. [Cross-Layer Invariant Matrix](#4-cross-layer-invariant-matrix)
5. [Layer Rules (Consolidated)](#5-layer-rules-consolidated)
6. [Adapter Boundary (1c.3)](#6-adapter-boundary-1c3)
7. [Scenario System Freeze (1c.4)](#7-scenario-system-freeze-1c4)
8. [No Semantic Expansion Rule](#8-no-semantic-expansion-rule)
9. [Validation Register (Existing Tests)](#9-validation-register-existing-tests)
10. [Amendment Protocol](#10-amendment-protocol)
11. [References](#11-references)

---

## 1. Authority and Purpose

This document is the **final semantic/asset boundary authority** for ReelForge. All prior phase docs remain valid as detail references; where a conflict arises between an informal note and this lock, **this document wins** until a formal amendment (§10).

**Consolidated systems:**

| System | Phase | Module / doc |
|--------|-------|----------------|
| Resolver | 1b | `experience/experience_resolve.rs`, RES-* in 1b.7 |
| CSPP | 1b | `experience/cspp/`, CSPP-* in 1b.7 |
| Media semantic layer | 1b | `media/`, frozen `metadata.media_*` |
| Viewer simulation | 1b | `viewer_sim/`, VIEW-* in 1b.7 |
| Asset resolution adapter | 1c.3 | `asset_resolution/adapter.rs`, 1c.2 |
| Scenario simulation | 1c.4 | `asset_resolution/scenario_feed.rs` (test-only) |

**Global rules (ASCL-0):**

| ID | Rule |
|----|------|
| ASCL-0.1 | Semantic pipeline order and modules are frozen (§2). |
| ASCL-0.2 | Asset Layer is **outside** the semantic pipeline. |
| ASCL-0.3 | `AssetResolutionAdapter` is the **only** bridge between asset catalog snapshots and semantic bind outcomes (§6). |
| ASCL-0.4 | No URL-shaped strings in RVE JSON (NC-105, inherited from 1b.7). |
| ASCL-0.5 | Documentation-only phase: zero runtime diffs required to satisfy this lock. |

---

## 2. Frozen Production Pipeline

The production experience path **must not** call the adapter, scenario feed, or mock registry.

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

| Property | Requirement |
|----------|-------------|
| Orchestrator | `compose_pipeline::run_from_base_rve` / `run` |
| Adapter insertion | **Forbidden** in this path until explicit architecture amendment |
| Scenario feed | **Forbidden** in this path forever (§7) |
| Determinism | Identical inputs → identical `CompositionPlan` (DET-1 / VIEW-3) |

---

## 3. Canonical Failure and Outcome Model

### 3.1 Trinary bind outcome authority

All **asset**, **media semantic**, **scenario**, and **adapter** failure or availability outcomes **must collapse** into exactly one of these `media_state` values at bind/reconciliation time:

| Outcome class | `media_state` | Meaning |
|---------------|---------------|---------|
| Content available | `REAL_MEDIA` | Primary (or policy-approved) media is ready for display bind |
| Deferred / synthetic stand-in | `PLACEHOLDER_MEDIA` | Asset or policy indicates not yet display-ready; placeholder path permitted |
| Safe degradation | `FALLBACK_MEDIA` | Missing, failed, stale, or absent reference; viewer-safe fallback |

**ASCL-CFM-1:** No additional `media_state` values may be introduced for failure, error, or retry semantics (e.g. `FAILURE_MEDIA`, `ERROR_MEDIA`, `RETRY_MEDIA` are **forbidden**).

### 3.2 Relationship to frozen 1b.7 wire enum

Phase 1b.7 freezes four `media_state` wire strings in RVE `metadata`, including `DERIVED_MEDIA`. This lock **does not** change that wire set.

| Wire value | Role under this lock |
|------------|----------------------|
| `REAL_MEDIA` | Canonical success / content-available class (§3.1) |
| `PLACEHOLDER_MEDIA` | Canonical deferred / stand-in class (§3.1) |
| `FALLBACK_MEDIA` | Canonical failure / degradation class (§3.1) |
| `DERIVED_MEDIA` | **Representation tier only** — permitted when semantic policy or adapter step 4–5 (1c.2 §5.1) classifies READY derived/synthetic output; **must not** represent `FAILED`, `MISSING`, `PENDING`, or `PROCESSING` asset conditions |

### 3.3 Asset and scenario → outcome collapse

When the adapter runs (test bind or future Viewer bind), asset catalog conditions **must** map per this collapse table (aligned with 1c.2 §5.1):

| Asset / catalog condition | Collapsed `media_state` | `inventory_state` (binding) |
|---------------------------|-------------------------|-----------------------------|
| No matching record | `FALLBACK_MEDIA` | `MISSING` |
| `asset_state`: `FAILED` | `FALLBACK_MEDIA` | `FAILED` |
| `asset_state`: `PENDING` or `PROCESSING` | `PLACEHOLDER_MEDIA` | `PENDING` |
| `asset_state`: `READY` (primary, valid bind) | `REAL_MEDIA` | `READY` |
| `media_reference`: `null` / absent | `FALLBACK_MEDIA` | `MISSING` |
| Stale / wrong `asset:{uuid}` token | `FALLBACK_MEDIA` | `MISSING` |

Scenario replay steps (1c.4) **must** produce adapter outcomes consistent with this table. Scenario steps **must not** assert or introduce outcomes outside §3.1 and the frozen wire set in §3.2.

### 3.4 Frozen auxiliary semantics (unchanged)

These fields remain governed by 1b.7; this lock **does not** add values:

| Field | Allowed values (frozen) |
|-------|-------------------------|
| `inventory_state` | `PENDING`, `READY`, `MISSING`, `FAILED` |
| `media_failure_mode` | `none`, `missing_reference`, `stale_reference`, `delayed_availability` |
| `media_reference_validity` | `valid`, `absent`, `stale`, `pending` |
| `media_intent` | `MICRO_DRAMA`, `MUSIC_VIDEO`, `CLIP`, `DOCUMENTARY`, `UNKNOWN` |
| `media_placeholder_policy` | `CONTENT_ONLY`, `CONTENT_THEN_PLACEHOLDER`, `CONTENT_THEN_GENERATED`, `FULLY_SYNTHETIC_ALLOWED` |
| `thumbnail_resolution` | `SHOULD_EXIST`, `ALLOW_DERIVED`, `MUST_PLACEHOLDER` |

---

## 4. Cross-Layer Invariant Matrix

**Legend:** Mutation = may write into RVE or `CompositionPlan` for its stage. Deterministic = same inputs → same outputs, no wall-clock or hidden caches.

| Layer | Allowed inputs | Forbidden inputs | Mutation rights | Deterministic |
|-------|----------------|------------------|-----------------|---------------|
| **Resolver (1b)** | Episode/project/profile DB rows; layout presets; governance pins; `resolve_context` | Asset catalog, `AssetInventoryRecord`, storage paths, CDN config, URLs, `media_state` from assets, `platform_campaigns` for Base RVE | **Yes** — Base RVE §8.1–8.7, §8.10–8.11 only | **Yes** |
| **CSPP (1b)** | Base RVE; active campaign rows; slot bindings; collision policy | `metadata.media_*`; asset inventory; URLs; filesystem | **Yes** — `campaigns[]`, `slots[]` only | **Yes** |
| **Media semantic (1b)** | Delivered RVE; harness metadata hints; opaque `media_reference` tokens | Asset DB/storage; adapter output; bundle handles; URL emission | **Yes** — `metadata` media fields only | **Yes** |
| **Viewer sim (1b)** | Base RVE + Delivered RVE (`metadata` semantics) | Asset resolution; catalog snapshots; scenario feed; URL construction | **Yes** — `CompositionPlan` only (not RVE) | **Yes** |
| **Asset adapter (1c.3)** | `media_reference`; `MetadataSnapshot`; `AssetInventoryRecord[]` | RVE mutation; DB; filesystem; CDN; pipeline stages | **No** RVE mutation — `SemanticMediaBinding` + `MaterializedAssetBundle` only | **Yes** |
| **Scenario feed (1c.4)** | Static step definitions; in-memory inventory vectors | Production pipeline; persistent stores; network; clock | **No** — test catalog snapshots only | **Yes** |

### 4.1 Dependency direction (frozen)

```text
Resolver ──► CSPP ──► Media semantic ──► Viewer sim
                                              ▲
                                              │ (future bind only)
Asset catalog snapshot ──► Adapter ──────────┘
         ▲
         │
Scenario feed (test-only replay)
```

**ASCL-DEP-1:** No upward edge (Viewer → resolver, Media → CSPP campaign mutation, Adapter → pipeline stage) is permitted.

---

## 5. Layer Rules (Consolidated)

### 5.1 Resolver (1b) — no asset knowledge

| ID | Statement |
|----|-----------|
| RES-1 | Sole composer for Base RVE structural sections per resolver contract. |
| RES-2 | `campaigns[]` always `[]` in Base RVE (RDR-130). |
| RES-3 | No `platform_campaigns` reads in `experience_resolve.rs`. |
| RES-4 | `validate_rve` before Base RVE return. |
| RES-5 | **No asset knowledge** — resolver must not read `AssetInventoryRecord`, storage state, ingest jobs, or CDN handles. |

### 5.2 CSPP (1b) — no semantic media mutation

| ID | Statement |
|----|-----------|
| CSPP-1 | Mutates only `campaigns[]` and `slots[]`. |
| CSPP-2 | `structural_snapshot(base) == structural_snapshot(delivered)`. |
| CSPP-3 | Active campaigns only (`status: active`). |
| CSPP-4 | One `hero_promo` winner per resolve. |
| CSPP-5 | Deterministic priority: `priority` → targeting → type band → UUID. |
| CSPP-6 | **No reads or writes** of `metadata.media_*`. |

### 5.3 Media semantic layer (1b) — deterministic mapping only

| ID | Statement |
|----|-----------|
| MED-1 | Emits frozen `metadata.media_*` fields only; no top-level schema extension. |
| MED-2 | Default `inventory_state` when unspecified: `MISSING`. |
| MED-3 | Mapping is **policy-driven simulation** without asset I/O. |
| MED-4 | `media_reference` opaque tokens only (`episode:{uuid}`, etc.); NC-105 applies. |
| MED-5 | Does not consume adapter output to complete pipeline execution. |

### 5.4 Viewer (1b) — pure rendering, no resolution

| ID | Statement |
|----|-----------|
| VIEW-1 | Inputs: Base RVE + Delivered RVE only. |
| VIEW-2 | No merge, campaign time evaluation, URL construction, or asset catalog reads. |
| VIEW-3 | `CompositionPlan` deterministic across runs. |
| VIEW-4 | Tolerates `media_reference: null` and all frozen `media_state` wire values. |
| VIEW-5 | **No resolution** — does not map `asset_state` → `media_state`. |

---

## 6. Adapter Boundary (1c.3)

### 6.1 Sole transformation layer

**ASCL-ADP-1:** `AssetResolutionAdapter` is the **only** component permitted to translate `asset_id` / `asset_state` / `asset_type` into semantic bind fields (`media_state`, `inventory_state`, validity, failure mode) for consumption outside the asset domain.

| Allowed | Forbidden |
|---------|-----------|
| Pure function `resolve(media_reference, MetadataSnapshot, inventory[])` | Mutable adapter state, caches with hidden keys, wall-clock |
| Emit `SemanticMediaBinding` + `MaterializedAssetBundle` | Write back to RVE JSON |
| Mapping rows 1–8 per 1c.2 §5.1 | New mapping rows that introduce wire values outside §3 |
| Opaque bundle handles (`handle:{uuid}`) | URLs, paths, bucket names in bundle or RVE |

### 6.2 Stateless and deterministic

| ID | Requirement |
|----|-------------|
| ADP-DET-1 | Identical inputs → identical `AdapterResult`. |
| ADP-DET-2 | No I/O, DB, HTTP, or filesystem. |
| ADP-DET-3 | Does not mutate inventory input slices. |

### 6.3 No new semantic meaning

**ASCL-ADP-2:** The adapter **may not** introduce semantic meaning beyond the mapping rules in [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md). It classifies and bundles; it does not invent intents, policies, campaigns, or layout.

| Adapter may | Adapter must not |
|-------------|------------------|
| Echo / validate `media_intent` from snapshot | Compute `media_intent` from ingest metadata |
| Map `asset_state` → §3.3 collapse | Emit new `media_failure_mode` or `media_state` values |
| Warn on intent/type mismatch (`intent_validation_warn`) | Throw or block pipeline |

### 6.4 Forbidden locations (reaffirmed)

| Location | Verdict |
|----------|---------|
| `experience_resolve.rs` | **Forbidden** |
| `cspp/` | **Forbidden** |
| `media/media_semantic_resolver.rs` | **Forbidden** |
| `compose_pipeline.rs` stages 1–4 | **Forbidden** |
| Viewer bind path (after RVE exists) | **Allowed** (only production hook) |
| Tests / harness | **Allowed** |

---

## 7. Scenario System Freeze (1c.4)

The scenario system exists **only** to replay deterministic asset catalog timelines in tests.

### 7.1 Permanent test-only status

| ID | Rule |
|----|------|
| SCN-1 | `scenario_feed.rs` is **test-only forever**. |
| SCN-2 | Module is exposed under `#[cfg(test)]` in `asset_resolution/mod.rs`; **must not** be imported from non-test production code. |
| SCN-3 | `AssetScenarioFeed` **cannot** influence `compose_pipeline`, resolver, CSPP, media semantic, or viewer_sim in production builds. |
| SCN-4 | Scenario steps **cannot** introduce new semantics — only replay `AssetInventoryRecord` vectors already defined in 1c.1. |
| SCN-5 | Scenario replay **cannot** add pipeline stages, background tasks, or persistence. |

### 7.2 Registered scenarios (frozen names)

| Scenario ID | Purpose |
|-------------|---------|
| `upload_lifecycle_scenario` | `MISSING → PROCESSING → READY → FAILED` on primary video |
| `delayed_encoding_scenario` | Extended `PROCESSING` stability then `READY` |
| `partial_failure_batch_scenario` | Multi-asset batch with mixed then full failure |
| `harness_snapshot` | Static multi-record compatibility with 1c.3 harness |

### 7.3 Mock registry relationship

`mock_registry.rs` may delegate to scenario steps for backward compatibility. Production code **must not** depend on `MockAssetRegistry`.

---

## 8. No Semantic Expansion Rule

**ASCL-EXP-1:** No future Phase 1c+ work may introduce new `media_state`, `media_failure_mode`, `media_reference_validity`, `inventory_state`, or `media_intent` wire values without **explicitly breaking** this contract via the amendment protocol (§10).

**ASCL-EXP-2:** New asset-side enums (e.g. encode profiles, bucket classes) must remain **outside** RVE and outside semantic `metadata` unless a separate schema version bump is approved independently of this lock.

**ASCL-EXP-3:** Convenience aliases (e.g. collapsing `DERIVED_MEDIA` into `PLACEHOLDER_MEDIA` in UI) are permitted only **downstream of bind** in presentation code that does not write RVE — not in pipeline or adapter emission without amendment.

**ASCL-EXP-4:** Infrastructure phases (storage, CDN, ingestion, thumbnails) must publish `AssetInventoryRecord` snapshots only; semantic expansion remains blocked.

---

## 9. Validation Register (Existing Tests)

This lock is enforced by **existing** tests; 1c.4.1 adds no new tests.

| Register | Location | Covers |
|----------|----------|--------|
| Contract lock 1b.7 | `pipeline_integration_tests.rs` (`contract_lock_*`) | Frozen enums, resolver, CSPP, media, viewer |
| Regression 1b.7 | `pipeline_integration_tests.rs` (`regression_*`) | Reference stability, CSPP collision, viewer determinism |
| Adapter 1c.3 | `pipeline_integration_tests.rs` (`phase_1c3_*`), `adapter::tests` | Mapping paths, determinism |
| Scenario 1c.4 | `pipeline_integration_tests.rs` (`phase_1c4_*`), `scenario_feed::tests`, `adapter::tests` | Replay, lifecycle, backward compat |

**ASCL-TST-1:** Any amendment to §3–§8 requires updating this register in the same change set as implementation (not applicable to 1c.4.1).

---

## 10. Amendment Protocol

| Step | Requirement |
|------|-------------|
| 1 | Publish doc revision with incremented `Version` and changelog section |
| 2 | Explicitly list broken rule IDs (e.g. ASCL-CFM-1, ASCL-EXP-1) |
| 3 | Migrate or freeze tests in §9 |
| 4 | Separate approval for RVE schema version if wire enums change |

Until step 4 completes, §2 pipeline and §3.1 trinary collapse remain mandatory for all validation and planning.

---

## 11. References

| Document | Role |
|----------|------|
| [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md) | 1b wire freeze and pipeline lock |
| [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) | Semantic vs asset layer split |
| [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) | `AssetInventoryRecord` abstract model |
| [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md) | Adapter mapping authority |
| [`END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md`](./END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md) | Harness vectors and drift rules |
| [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md) | Viewer bind and fallback |

---

## Verdict

| Criterion | Status |
|-----------|--------|
| Unified invariant system documented | ✅ |
| Canonical failure collapse defined | ✅ |
| Cross-layer matrix defined | ✅ |
| Scenario system frozen as test-only | ✅ |
| Adapter boundary reaffirmed | ✅ |
| No semantic expansion rule stated | ✅ |
| Zero implementation / schema / pipeline change | ✅ |

**This document is the authoritative semantic/asset contract lock for Phase 1c.4.1 onward.**

---

*End of Asset Semantic Contract Lock.*
