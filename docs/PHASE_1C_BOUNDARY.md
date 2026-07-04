# Phase 1c Boundary — System Transition Gate

**Phase:** 1c.0 — System Transition Gate (architecture only)  
**Status:** Normative boundary between frozen Semantic Layer (1b) and future Asset Layer (1c)  
**Version:** `1.2.0`  
**Project:** ReelForge / Smart Production Studio  
**Prerequisites:** [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md), [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md), [`MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md`](./MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md), [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md), [`CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md`](./CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md)

**Scope:** Two-layer architecture boundary, ownership rules, ingestion isolation, failure split, and explicit non-implementation register. This document does **not** authorize code, schema, API, Viewer, CSPP, or media semantic changes.

**Explicit non-goals (1c.0):** Implementation of thumbnails, ingestion, CDN, encoding, or any modification to the Phase 1b deterministic pipeline.

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Two-Layer Architecture Boundary](#2-two-layer-architecture-boundary)
3. [Strict Ownership Rules](#3-strict-ownership-rules)
4. [Ingestion Boundary](#4-ingestion-boundary)
5. [Failure Boundary Split](#5-failure-boundary-split)
6. [Semantic Layer Freeze (No Leakage)](#6-semantic-layer-freeze-no-leakage)
7. [Systems NOT Implemented](#7-systems-not-implemented)
8. [Phase 1c Implementation Gate](#8-phase-1c-implementation-gate)
9. [References](#9-references)

---

## 1. Purpose

Phase 1b delivered a **complete semantic pipeline** that models viewer experience and incomplete media reality **without asset I/O**. Phase 1c will add **real asset systems** (storage, thumbnails, ingestion, encoding, CDN) that must remain **strictly separated** from the frozen semantic path.

This document is the **transition gate**: no Asset Layer work may collapse into resolver, CSPP, media semantics, or Viewer composition logic.

---

## 2. Two-Layer Architecture Boundary

### 2.1 Layer definitions

| Layer | Phase | Nature | Knows about bytes? |
|-------|-------|--------|-------------------|
| **Semantic Layer** | 1b (frozen) | Deterministic, contract-driven, RVE-shaped | **No** — opaque refs and enums only |
| **Asset Layer** | 1c+ (future) | Storage, generation, delivery, inventory persistence | **Yes** — files, buckets, encodes, CDN |

### 2.2 Semantic Layer pipeline (frozen)

```text
┌─────────────────────────────────────────────────────────────┐
│ SEMANTIC LAYER (Phase 1b — frozen)                          │
│                                                             │
│  experience_resolve  →  Base RVE                            │
│       ↓                                                     │
│  CSPP                →  Delivered RVE (campaigns + slots)   │
│       ↓                                                     │
│  media_semantic      →  Delivered RVE + metadata semantics  │
│       ↓                                                     │
│  viewer_sim          →  CompositionPlan                       │
└─────────────────────────────────────────────────────────────┘
         │                              ▲
         │ opaque media_reference       │ MaterializedAssetBundle
         │ thumbnail_resolution         │ (future handoff only)
         ▼                              │
┌─────────────────────────────────────────────────────────────┐
│ ASSET LAYER (Phase 1c — not in pipeline)                    │
│                                                             │
│  ┌ INGESTION (1c.5 — upstream, async, mutable only) ───┐  │
│  │  UPLOADED→VALIDATING→TRANSCODING→READY|FAILED        │  │
│  │  emits Asset*Event → catalog projection               │  │
│  └──────────────────────────────────────────────────────┘  │
│  thumbnail_orchestrator → generation decisions → assets     │
│  encoding_pipeline → MP4 / HLS / proxies                    │
│  cdn_mapper → fetchable handles (never written into RVE)    │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Handoff contract (future 1c)

| Direction | Allowed | Forbidden |
|-----------|---------|-----------|
| Semantic → Asset | Pass `media_reference`, `thumbnail_resolution`, `inventory_state` **as hints** | Pass URLs, paths, MIME types, bucket names |
| Asset → Viewer | `MaterializedAssetBundle`: `opaque_ref → display_handle` | Mutate RVE, re-run resolver/CSPP |
| Asset → Semantic | **Inventory events** consumed **only** by a future classifier **outside** `experience_resolve` | Direct writes into resolver merge or CSPP |

The Semantic Layer pipeline **order and modules remain unchanged** until a formal architecture amendment.

---

## 3. Strict Ownership Rules

### 3.1 Media semantic layer (`backend/src/media/`)

| May | Must NOT |
|-----|----------|
| Emit `media_state`, `media_intent`, `media_placeholder_policy` | Read object storage, DB thumbnail tables, or CDN config |
| Emit `inventory_state` as **semantic** enum (1b.6 model) | Persist inventory; equate semantic `READY` with DB row without a boundary adapter |
| Emit `thumbnail_resolution`: `SHOULD_EXIST`, `ALLOW_DERIVED`, `MUST_PLACEHOLDER` | Generate, store, resize, or select thumbnail files |
| Emit `media_reference` as opaque token (`episode:{uuid}`, etc.) | Emit or parse URLs, signed links, `s3://`, `https://` |
| Emit `media_failure_mode`, `media_reference_validity` | Run ffprobe, probe codecs, or branch on file extension |
| Classify failure **representation** for RVE consumers | Perform **detection** of ingest failures (Asset Layer) |

**Rule SEM-MEDIA-1:** `thumbnail_resolution` means “orchestrator **should** attempt tier X” — not “thumbnail exists at URL Y”.

**Rule SEM-MEDIA-2:** Semantic `inventory_state` in RVE `metadata` is a **view** for the experience stack, not authoritative storage state. Asset Layer owns authoritative inventory persistence.

### 3.2 Asset Layer (Phase 1c — future modules/services)

| Owns | Must NOT |
|------|----------|
| Thumbnail generation (extract, resize, derive, store) | Alter `layout`, `visibility`, `campaigns[]`, or resolver merge |
| MP4 / asset ingestion (upload, validate, transcode triggers) | Call `experience_resolve::compose` or CSPP `enrich` |
| Encoding pipeline (profiles, HLS, proxies) | Write `playback_url` or `thumbnail_url` into RVE JSON |
| CDN mapping (signed URLs, cache keys, edge config) | Re-run campaign collision or slot priority |
| Authoritative inventory persistence (`PENDING` → `READY` → `FAILED`) | Override `media_intent` or profile `content_format` merge |

**Rule ASSET-1:** All fetchable URLs exist **only** in `MaterializedAssetBundle` (or equivalent), keyed by opaque `media_reference`.

**Rule ASSET-2:** Asset services are **downstream or parallel** to `GET /api/experience/resolve`; they are not stages inside the resolver composition kernel.

### 3.3 CSPP (`experience/cspp/`)

| May | Must NOT |
|-----|----------|
| Enrich `campaigns[]`, `slots[]` | Read or assume `metadata.media_*` |
| Assume campaigns/slots work without media | Require `inventory_state: READY` for injection |
| Remain deterministic on RVE + `platform_campaigns` reads | Read ingestion queues or thumbnail tables |

**Rule CSPP-1:** CSPP **must not** assume media exists (frozen 1b.6 boundary).

### 3.4 Resolver (`experience_resolve.rs`)

| May | Must NOT |
|-----|----------|
| Compose Base RVE §8.1–8.7, §8.10–8.11 | Read ingestion state, CDN, or thumbnail DB |
| Emit structural `slots[]` | Emit URLs or `media_state` from asset tables |

**Rule RES-1:** Resolver purity (RP-1) extends to Asset Layer: ingest/CDN changes **must not** change Base RVE.

### 3.5 Viewer (`viewer_sim/` / production Viewer Phase 2+)

| May | Must NOT |
|-----|----------|
| Consume Base + Delivered RVE for composition | Read experience DB or ingestion tables |
| Bind **resolved** asset handles from bundle | Construct URLs from `media_reference` string |
| Apply fallback hierarchy when bundle miss | Re-evaluate `media_failure_mode` or inventory ladders |
| Tolerate `media_reference: null` | Fail hard on missing reference |

**Rule VIEW-1:** Viewer consumes **resolved references** (materialized handles), not storage layout.

---

## 4. Ingestion Boundary

**Normative detail:** [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md) (Phase 1c.5).

### 4.1 What ingestion is

Ingestion is an **Asset Layer subsystem** and the **only mutable domain** in the architecture (ING-MUT-1). It is:

- **Upstream** of authoritative catalog snapshots (projects into 1c.1 `asset_state`)
- **Outside** the semantic pipeline — explicitly **not** a stage in `compose_pipeline`
- **Asynchronous and non-deterministic by design** (event-driven lifecycle: `UPLOADED` → `VALIDATING` → `TRANSCODING` → `READY` | `FAILED`)
- A producer of **ingestion events only** (`AssetUploadedEvent`, `AssetValidationEvent`, `AssetTranscodingEvent`, `AssetReadyEvent`, `AssetFailedEvent`) per 1c.5 §4

Ingestion accepts uploads, validates, transcodes (future implementation), and eventually updates catalog state. It does **not** interpret semantics or viewer behavior.

### 4.2 What ingestion is NOT

| Forbidden | Reason |
|-----------|--------|
| A stage inside `compose_pipeline` | Breaks frozen pipeline order |
| A reader inside `experience_resolve` | Violates RES-1 / RP-1 |
| An input to CSPP campaign logic | Violates CSPP-1 |
| A direct writer to RVE during resolve | Violates NC-105 and Semantic Layer freeze |
| A caller or callee of `AssetResolutionAdapter` | Adapter is read-time, snapshot-only (1c.2–1c.3) |
| Coupled to `scenario_feed` (1c.4) | Test-only replay; no production ingest simulation |

### 4.3 Event and consistency model (summary)

```text
ingestion_service (async, mutable)
  → Asset*Event { asset_id, ingest_job_id, ingestion_state, observed_at }
  → (future) catalog_projector → AssetInventoryRecord / asset_state

Semantic pipeline (sync, deterministic) — unchanged:
  resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer

Read-time bridge (deterministic per snapshot):
  catalog_snapshot + media_reference → AssetResolutionAdapter → bind outputs
```

**Rule ING-1:** Ingestion produces **asset catalog mutations and ingestion events only**; it does not push merge logic into resolver or CSPP.

**Rule ING-2:** The deterministic pipeline **remains ignorant** of ingestion; semantic `inventory_state` in RVE is not driven by live ingest in 1b. Inconsistency is reconciled **at read-time** by the adapter (1c.2 §5.1), not by blocking resolve.

**Rule ING-3:** Ingestion is **external** to `run_from_base_rve` / `resolve_base_rve` call graph.

**Rule ING-4:** Asset Layer is **eventually consistent**; Semantic Layer is **strictly deterministic and synchronous** per request (1c.5 §7).

**Rule ING-5:** Ingestion performs **no semantic interpretation** and originates **no viewer-visible logic** (1c.5 §8).

---

## 5. Failure Boundary Split

Failures are split across three layers. **Do not collapse** detection, representation, and rendering.

### 5.1 Layer matrix

| Layer | Owner | Responsibility | Example outputs |
|-------|-------|----------------|-----------------|
| **Detection** | Asset Layer | Observe real-world failure (ingest error, missing file, corrupt encode, CDN 404) | `inventory_event`, job status, health flags |
| **Representation** | Media semantic (`failure_model`, `inventory_state`) | Classify what RVE **says** about failure for consumers | `media_failure_mode`, `media_reference_validity`, `media_state`, `inventory_state` |
| **Rendering** | Viewer | Degrade UI without throwing; use plan + bundle | Skip overlay, placeholder tier, empty region skeleton |

### 5.2 Mapping (informative)

| Detection signal | Representation (RVE metadata) | Rendering (Viewer) |
|------------------|-------------------------------|---------------------|
| Ingest job failed | `inventory_state: FAILED`, `media_state: FALLBACK_MEDIA` | Platform fallback asset |
| Asset not yet ingested | `inventory_state: PENDING`, `media_failure_mode: delayed_availability` | Placeholder or omit surface |
| No binding for episode | `media_failure_mode: missing_reference`, ref `null` | Safe-ignore overlay (§8.3 Viewer contract) |
| Stale asset key | `media_failure_mode: stale_reference`, `thumbnail_resolution: ALLOW_DERIVED` | Derived or placeholder tier |
| CDN miss at display time | *(no RVE change)* | Bundle miss → fallback hierarchy (F1–F4) |

**Rule FAIL-1:** Asset detection **must not** write arbitrary strings into RVE; only the media semantic adapter may set frozen metadata enums.

**Rule FAIL-2:** Viewer **must not** reinterpret detection signals; it reads representation + bundle only.

**Rule FAIL-3:** `failure_model` in 1b remains **representation-only** (no I/O). Detection additions in 1c stay in Asset Layer.

---

## 6. Semantic Layer Freeze (No Leakage)

The following are **frozen** and must not gain Asset Layer knowledge in place:

| Component | Frozen behavior | Leakage anti-pattern |
|-----------|-----------------|----------------------|
| `experience_resolve.rs` | Base RVE; `campaigns: []` | `sqlx` on ingest tables inside compose |
| `cspp/` | Structural snapshot preserved | Slot `content_ref` with `https://` URLs |
| `media/` | Metadata semantics only | `inventory_state` from live DB inside resolver path |
| `viewer_sim/` | CompositionPlan from RVE only | Fetch in `build_render_tree` |
| `compose_pipeline.rs` | Four-stage order | Insert `thumbnail_orchestrator` between CSPP and media |

**Amendment process for Semantic Layer:** Requires new normative doc + contract version bump + contract-lock test updates per [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md).

**Amendment process for Asset Layer:** New contract per service (ingestion, thumbnails, CDN, encoding) under `docs/`; **no** change to 1b frozen enums without explicit migration plan.

---

## 7. Systems NOT Implemented

| System | Layer | Status | Notes |
|--------|-------|--------|-------|
| **Thumbnails system** | Asset | Not implemented | `thumbnail_resolution` is semantic **decision** only |
| **Asset ingestion pipeline** | Asset (ingestion domain) | Not implemented | Contract: [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md); no persistence/API yet |
| **CDN / URL system** | Asset | Not implemented | NC-105; URLs only in future `MaterializedAssetBundle` |
| **Media encoding pipeline** | Asset | Not implemented | No transcoding / HLS in experience stack |
| **URL materialization in RVE** | — | Forbidden | `media_reference` stays opaque |
| **Recommendation engine** | Post-1c | Not implemented | Phase 2+ |
| **Production Viewer UI** | Viewer | Not implemented | `viewer_sim` only |
| **Top-level RVE `media` block** | Semantic | Deferred | Semantics in `metadata.*` until schema amendment |
| **Audit storage** | Ops | Not implemented | Governance §8 |
| **Inventory event → resolver adapter** | Boundary | Not implemented | Must not bypass ING-1 |

### 7.1 Pipeline implemented (unchanged)

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

---

## 8. Phase 1c Implementation Gate

Before merging **Asset Layer** code:

| # | Gate |
|---|------|
| G1 | New normative contract per asset subsystem; **ingestion** must satisfy [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md) |
| G2 | Proof of **no** resolver/CSPP/pipeline graph changes unless separate amendment |
| G3 | `MaterializedAssetBundle` handoff documented; no URLs in RVE |
| G4 | Ingestion emits events only; no resolve-path coupling (ING-1–ING-3) |
| G5 | Failure split preserved (FAIL-1–FAIL-3) |
| G6 | Contract-lock tests extended in **existing** test modules only |
| G7 | REM / governance items from closure report addressed where applicable |

**1c.0 verdict:** **APPROVED** as architecture boundary definition. **No implementation authorized** by this document alone.

---

## 9. References

| Document | Role |
|----------|------|
| [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) | Abstract `Asset` entity and reconciliation (1c.1) |
| [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md) | `AssetResolutionAdapter` bridge (1c.2) |
| [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md) | Ingestion lifecycle and events (1c.5) |
| [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) | Unified semantic/asset authority (1c.4.1) |
| [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md) | Frozen 1b semantics and tests |
| [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md) | Semantic media enums |
| [`MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md`](./MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md) | Informative ladders (orchestrator-owned) |
| [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md) | Viewer fallback and bundle binding |
| [`END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md`](./END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md) | E2E harness |
| [`ARCHITECTURE_CLOSURE_REPORT.md`](./ARCHITECTURE_CLOSURE_REPORT.md) | REM items |

---

*End of Phase 1c.0 system transition gate.*
