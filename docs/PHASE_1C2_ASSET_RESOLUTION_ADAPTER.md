# Phase 1c.2 — Asset Resolution Adapter (Semantic Bridge Contract)

**Phase:** 1c.2 — Asset Resolution Adapter (architecture only)  
**Status:** Normative bridge contract (no implementation)  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio  
**Prerequisites:** [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md), [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md), [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md), [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md)

**Scope:** Deterministic Asset Layer → Semantic Layer mapping, logical `AssetResolutionAdapter`, `MaterializedAssetBundle` boundary, unified failure reconciliation, and strict separation rules. This document does **not** define databases, ingestion, thumbnail generation, CDN URLs, or changes to resolver, CSPP, `media_semantic_resolver`, or Viewer rendering code.

**Explicit non-goals (1c.2):** Storage, ingest jobs, orchestrator implementation, API routes, pipeline stage insertion, RVE schema changes, new `media_failure_mode` / `media_state` enum values.

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Bridge Placement](#2-bridge-placement)
3. [Input and Output Types (Abstract)](#3-input-and-output-types-abstract)
4. [AssetResolutionAdapter (Logical)](#4-assetresolutionadapter-logical)
5. [Asset → Semantic Mapping Rules](#5-asset--semantic-mapping-rules)
6. [MaterializedAssetBundle Boundary](#6-materializedassetbundle-boundary)
7. [Unified Failure Reconciliation](#7-unified-failure-reconciliation)
8. [Strict Separation](#8-strict-separation)
9. [Determinism and Statelessness](#9-determinism-and-statelessness)
10. [Future Implementation Gate](#10-future-implementation-gate)
11. [References](#11-references)

---

## 1. Purpose

Phase 1c.1 defined **what assets are**. Phase 1b defined **what RVE claims** about media. Phase 1c.2 defines the **only permitted bridge** between them: the **Asset Resolution Adapter** — a pure, deterministic translation layer that:

- Consumes abstract `AssetInventoryRecord` inputs (from a future catalog, not from resolve path)
- Produces `SemanticMediaBinding` for **Viewer bind time only**
- Produces `MaterializedAssetBundle` entries (display handles, never URLs in RVE)

The adapter **does not** implement asset infrastructure. It specifies **how** infrastructure outputs are translated without letting Asset Layer leak into resolver, CSPP, or media semantic modules.

---

## 2. Bridge Placement

### 2.1 Frozen Semantic pipeline (unchanged)

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

Stages 1–4 **must not** call `AssetResolutionAdapter`.

### 2.2 Bridge placement (future)

```text
┌──────────────── Semantic pipeline (1b frozen) ────────────────┐
│  Base RVE + Delivered RVE (metadata.media_* from 1b only)      │
└───────────────────────────────┬───────────────────────────────┘
                                │ media_reference (opaque)
                                ▼
┌──────────────── AssetResolutionAdapter (1c.2 — ONLY bridge) ─┐
│  Input:  AssetInventoryRecord[] + media_reference + RVE snap  │
│  Output: SemanticMediaBinding + MaterializedAssetBundle       │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌──────────────── Viewer (viewer_sim / production Viewer) ─────┐
│  CompositionPlan + bundle bind (no asset catalog reads)        │
└───────────────────────────────────────────────────────────────┘
```

**Rule BRIDGE-1:** `AssetResolutionAdapter` is the **sole** component allowed to translate `asset_id` / `asset_state` into semantic enums for consumption.

**Rule BRIDGE-2:** Adapter runs **after** Delivered RVE exists; it **must not** write back into RVE JSON in the 1c.2 contract (Viewer-side consumption only).

**Rule BRIDGE-3:** Upstream Semantic Layer modules **must not** depend on adapter output to complete resolve.

---

## 3. Input and Output Types (Abstract)

### 3.1 `AssetInventoryRecord` (input)

Abstract snapshot row from Asset Layer per [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) §2. Not stored in RVE.

| Field | Required | Description |
|-------|----------|-------------|
| `asset_id` | Yes | Opaque asset identifier |
| `asset_type` | Yes | `video` \| `image` \| `audio` \| `derived` |
| `asset_state` | Yes | `PENDING` \| `PROCESSING` \| `READY` \| `FAILED` |
| `asset_source` | Yes | `upload` \| `ingest` \| `generated` \| `external` |
| `thumbnail_asset_id` | No | Optional linked thumb asset |
| `scope_episode_id` | No | Binding scope hint |
| `scope_reel_id` | No | Binding scope hint |

**Absent record:** Represented by **omission** from input set (no `MISSING` `asset_state`).

### 3.2 `SemanticMediaBinding` (output — Viewer only)

Reconciled semantic view for one `media_reference` resolve operation. **Not** written to RVE in 1c.2.

| Field | Maps from 1b frozen enums |
|-------|---------------------------|
| `media_reference` | Echo input token |
| `inventory_state` | `PENDING` \| `READY` \| `MISSING` \| `FAILED` |
| `media_state` | `REAL_MEDIA` \| `DERIVED_MEDIA` \| `PLACEHOLDER_MEDIA` \| `FALLBACK_MEDIA` |
| `media_intent` | From RVE snapshot; **validated** against `asset_type` (§5.2) |
| `media_failure_mode` | `none` \| `missing_reference` \| `stale_reference` \| `delayed_availability` |
| `media_reference_validity` | `valid` \| `absent` \| `stale` \| `pending` |
| `thumbnail_resolution` | From RVE snapshot or re-derived from §5.1 |
| `bundle_entry_key` | Same string as `media_reference` for bundle lookup |

### 3.3 `MaterializedAssetBundle` (output — Viewer only)

Map of opaque keys to **display handles** (implementation-defined: texture id, blob ref, CDN handle). **Never** embedded in RVE.

| Field | Description |
|-------|-------------|
| `entries` | `Record<bundle_entry_key, MaterializedAssetHandle>` |
| `MaterializedAssetHandle` | Opaque display token; **no** URL in Semantic Layer contracts |

**Bundle miss:** Key absent from `entries` → Viewer fallback per [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md) §8.

---

## 4. AssetResolutionAdapter (Logical)

### 4.1 Definition

**`AssetResolutionAdapter`** is a **pure transformation** (conceptual function), not a pipeline stage:

```text
resolve(
  media_reference: string | null,
  rve_metadata_snapshot: MetadataSnapshot,
  inventory: AssetInventoryRecord[],
  thumbnail_inventory: AssetInventoryRecord[]  // optional separate list
) -> AdapterResult
```

```text
AdapterResult {
  binding: SemanticMediaBinding,
  bundle: MaterializedAssetBundle
}
```

### 4.2 Properties (mandatory)

| Property | Requirement |
|----------|-------------|
| **Deterministic** | Identical inputs → identical `AdapterResult` (§9) |
| **Stateless** | No mutable state, caches with hidden keys, or wall-clock |
| **Pure** | No I/O, no DB, no HTTP, no filesystem |
| **Side-effect free** | Does not mutate `inventory`, RVE, or catalog |

### 4.3 Forbidden locations

| Location | Verdict |
|----------|---------|
| `experience_resolve.rs` | **Forbidden** |
| `cspp/` | **Forbidden** |
| `media/media_semantic_resolver.rs` | **Forbidden** |
| `compose_pipeline.rs` stages 1–3 | **Forbidden** |
| Viewer bind path (after RVE) | **Allowed** (only) |

### 4.4 Relationship to 1b `media_semantic_resolver`

| Aspect | 1b media semantic | 1c.2 adapter |
|--------|-------------------|--------------|
| When | Inside pipeline | After pipeline, at Viewer bind |
| Input | Delivered RVE only | RVE snapshot + `AssetInventoryRecord[]` |
| Authority for `media_state` without assets | Policy + harness hints | N/A when adapter not invoked |
| Coexistence | **Frozen** — unchanged | Optional reconcile at bind; does not replace pipeline output |

When adapter is **not** invoked (1b today), Viewer uses RVE `metadata` only — per frozen behavior.

---

## 5. Asset → Semantic Mapping Rules

All rules are **deterministic** and **declarative**. Priority: evaluate rows **1–8 in order**; first match wins.

### 5.1 `asset_state` → `media_state` (authoritative when adapter runs)

| Step | Condition (asset catalog) | `inventory_state` | `media_state` | `media_reference_validity` | `media_failure_mode` |
|------|---------------------------|-------------------|---------------|----------------------------|----------------------|
| 1 | No matching record for `media_reference` | `MISSING` | `FALLBACK_MEDIA` | `absent` | `missing_reference` |
| 2 | Match `FAILED` | `FAILED` | `FALLBACK_MEDIA` | `stale` | `none` |
| 3 | Match `PENDING` or `PROCESSING` | `PENDING` | `PLACEHOLDER_MEDIA` | `pending` | `delayed_availability` |
| 4 | Match `READY`, `asset_type: derived` | `READY` | `DERIVED_MEDIA` | `valid` | `none` |
| 5 | Match `READY`, `asset_type: video` \| `image`, thumb policy `SHOULD_EXIST`, thumb missing | `READY` | `DERIVED_MEDIA` or `PLACEHOLDER_MEDIA` | `valid` | `none` |
| 6 | Match `READY`, primary ready | `READY` | `REAL_MEDIA` | `valid` | `none` |
| 7 | Match `READY`, binding token stale / wrong `asset_id` | `MISSING` | `FALLBACK_MEDIA` | `stale` | `stale_reference` |
| 8 | `media_reference` is `null` | `MISSING` | `FALLBACK_MEDIA` | `absent` | `missing_reference` |

**Note:** User-facing “failure media path” = **`FALLBACK_MEDIA`** (frozen 1b enum). No `FAILURE_MEDIA` type exists.

`PLACEHOLDER_MEDIA` applies when policy from RVE `media_placeholder_policy` permits and steps 3–4 apply.

### 5.2 `asset_type` → `media_intent` validation alignment

Adapter **does not compute** `media_intent` from `asset_type`. It **validates** consistency only:

| `asset_type` | Compatible `media_intent` (RVE) | On mismatch |
|--------------|-----------------------------------|-------------|
| `video` | `MICRO_DRAMA`, `DOCUMENTARY`, `CLIP`, `MUSIC_VIDEO`, `UNKNOWN` | Flag `intent_validation: warn` in binding (implementation); **do not** change RVE |
| `image` | Any (poster/sponsor) | Always compatible |
| `audio` | `MUSIC_VIDEO`, `UNKNOWN` | Warn if documentary-only intent |
| `derived` | Any | Compatible; `media_state` prefers `DERIVED_MEDIA` |

**Rule INTENT-1:** Mismatch **must not** throw; Viewer uses RVE `media_intent` unchanged.

### 5.3 `asset_id` → `media_reference` binding interpretation

| `media_reference` token | Record selection rule |
|-------------------------|----------------------|
| `asset:{uuid}` | Exact match `asset_id == uuid` |
| `episode:{uuid}` | Primary `video` record where `scope_episode_id == uuid` and `asset_state` maximal per §5.1 |
| `reel:{uuid}` | Primary record where `scope_reel_id == uuid` |
| `slot:{key}:{scope}` | Record mapped via future `MediaReferenceBinding` (1c.1 §3.3); if unmapped → step 1 (missing) |

**Rule BIND-1:** Adapter **never** emits new `media_reference` tokens — only interprets existing.

**Rule BIND-2:** `asset_id` **never** appears in RVE; only inside adapter input and bundle internal keys.

### 5.4 Missing asset → fallback path

When step **1** or **8** matches:

| Output field | Value |
|--------------|-------|
| `media_state` | `FALLBACK_MEDIA` |
| `inventory_state` | `MISSING` |
| `media_failure_mode` | `missing_reference` |
| `bundle.entries[media_reference]` | **Absent** (bundle miss) |

Viewer **must** apply safe-ignore / skeleton fallback ([`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md) §8.3).

---

## 6. MaterializedAssetBundle Boundary

### 6.1 Ownership

| Component | Produces | Consumes |
|-----------|----------|----------|
| Asset Layer (future) | Raw bytes, storage keys | — |
| CDN mapper (future) | Display handles | Storage keys |
| **AssetResolutionAdapter** | `MaterializedAssetBundle` **mapping only** | `AssetInventoryRecord`, RVE snapshot |
| **Viewer** | Pixels / DOM | `MaterializedAssetBundle` + `CompositionPlan` |

### 6.2 Bundle entry rules

| ID | Rule |
|----|------|
| BND-1 | One bundle entry per resolved `media_reference` key when step 6 or 5 applies with handle available. |
| BND-2 | `thumbnail_asset_id` may produce **second** entry `"{media_reference}#thumb"` — never a URL in RVE. |
| BND-3 | Bundle handles are opaque; Viewer **must not** construct URLs from handle string. |
| BND-4 | Adapter **must not** require bundle consumers other than Viewer. |
| BND-5 | Resolver, CSPP, media semantic **must not** read bundle. |

### 6.3 Upstream independence

No upstream system (ingestion, encoding, CDN) may require Viewer or Semantic Layer to understand `asset_type`, buckets, or encode profiles. They publish `AssetInventoryRecord` events only; adapter consumes snapshots.

---

## 7. Unified Failure Reconciliation

### 7.1 No new failure states

| Layer | Failure vocabulary | Change in 1c.2 |
|-------|-------------------|----------------|
| 1b `failure_model` | `media_failure_mode` (4 values) | **Frozen** |
| 1b `media_state` | 4 values including `FALLBACK_MEDIA` | **Frozen** |
| 1c `asset_state` | 4 values including `PROCESSING` | **Frozen** |

**Rule FAIL-1:** Adapter maps asset facts into **existing** 1b enums only.

### 7.2 Unified reconciliation table (detection → representation → bundle)

| Asset detection (catalog) | 1b representation (`SemanticMediaBinding`) | Bundle | Viewer rendering |
|---------------------------|---------------------------------------------|--------|------------------|
| No row | `missing_reference` + `FALLBACK_MEDIA` | miss | Fallback F3 |
| `FAILED` | `FAILED` inventory + `FALLBACK_MEDIA` | miss or stale handle | Fallback |
| `PROCESSING` | `delayed_availability` + `PENDING` + `PLACEHOLDER_MEDIA` | miss or pending handle | Placeholder |
| `PENDING` | `delayed_availability` or `pending` validity | miss | Placeholder |
| `READY` + valid | `none` + `REAL_MEDIA` / `DERIVED_MEDIA` | hit | Bind handle |
| Stale token / wrong id | `stale_reference` + `FALLBACK_MEDIA` | miss | Fallback |
| RVE says absent before adapter | Align step 8; adapter wins at bind | miss | Safe-ignore |

### 7.3 Alignment with 1b `failure_model`

| 1b evaluator input | Adapter equivalent |
|--------------------|------------------|
| `suppress_reference` | Step 8 / null ref |
| `stale_reference` | Step 7 |
| `delayed_availability` | Step 3 (`PROCESSING` \| `PENDING`) |
| `inventory: Ready` + valid ref | Step 6 |

1b pipeline **continues** to evaluate without catalog; adapter reconcile applies only when Viewer invokes bridge.

---

## 8. Strict Separation

| System | Must NOT | May |
|--------|----------|-----|
| **1b resolver** | Read `AssetInventoryRecord` | Emit Base RVE |
| **1b CSPP** | Branch on `asset_state` | Enrich campaigns/slots |
| **1b media semantic** | Lookup `asset_id` | Emit metadata enums |
| **1c catalog / ingest** | Call resolver/CSPP | Emit inventory records |
| **1c CDN** | Write URLs to RVE | Supply handles to adapter |
| **Adapter** | Mutate RVE or pipeline | Translate to binding + bundle |
| **Viewer** | Read catalog | Consume binding + bundle |

**Rule SEP-1:** **Adapter is the only bridge** between Asset internals and Semantic/Viewer consumption.

**Rule SEP-2:** 1c systems **never** influence resolver or CSPP logic ([`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) §6.2).

**Rule SEP-3:** 1b systems **never** read asset system internals ([`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) §6.1).

---

## 9. Determinism and Statelessness

### 9.1 Determinism contract (DET-ADAPTER-1)

> For fixed `(media_reference, rve_metadata_snapshot, inventory, thumbnail_inventory)`, `AdapterResult` is **identical** across invocations.

### 9.2 Tie-breaking (deterministic)

| Tie | Rule |
|-----|------|
| Multiple `READY` candidates for `episode:` | Lowest `asset_id` UUID lexicographic |
| Primary vs `derived` | Prefer `video` over `derived` over `image` for `episode:` |
| Thumb selection | Use `thumbnail_asset_id` if set; else no thumb entry |

### 9.3 Statelessness

Adapter **must not** use: wall clock, random IDs, mutable globals, or external cache not included in inputs.

---

## 10. Future Implementation Gate

| # | Gate |
|---|------|
| A1 | Adapter module **outside** `backend/src/experience/` pipeline crate path OR isolated `asset_resolution/` with **zero** imports from `experience_resolve` / `cspp` |
| A2 | Unit tests: DET-ADAPTER-1, step table §5.1, missing asset §5.4 |
| A3 | Contract test: RVE JSON contains no `asset_id`, no bundle URLs |
| A4 | Viewer integration: optional adapter hook; default path unchanged when inventory `[]` |
| A5 | No new enums in §7.1 |
| A6 | [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) reconciliation superseded at bind by §5.1 (same semantics, executable) |

**1c.2 verdict:** **APPROVED** as bridge contract only. **No implementation authorized.**

---

## 11. References

| Document | Role |
|----------|------|
| [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) | `Asset`, `media_reference` grammar |
| [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) | Layer separation |
| [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md) | Frozen 1b enums |
| [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md) | Bundle consumption |
| [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md) | Semantic media |

---

*End of Phase 1c.2 asset resolution adapter contract.*
