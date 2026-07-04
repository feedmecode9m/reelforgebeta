# Phase 1c.5 — Asset Ingestion Contract (Architecture Only)

**Phase:** 1c.5 — Asset Ingestion Contract Definition  
**Status:** Normative contract (no implementation)  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio  
**Prerequisites:** [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md), [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md), [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md)

**Scope:** Formal ingestion lifecycle, event model, mutability rules, eventual-consistency boundary, and strict separation from the frozen Semantic Layer. This document does **not** define databases, APIs, queues, workers, schema migrations, pipeline stages, or runtime code.

**Explicit non-goals (1c.5):** Implementation of ingestion services, persistence, orchestration, interaction with `scenario_feed` (1c.4), or any change to resolver, CSPP, media semantic, viewer, or `AssetResolutionAdapter`.

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Architectural Position](#2-architectural-position)
3. [Ingestion Lifecycle (Conceptual)](#3-ingestion-lifecycle-conceptual)
4. [Ingestion Event Model](#4-ingestion-event-model)
5. [Catalog Projection (Ingestion → Asset Layer)](#5-catalog-projection-ingestion--asset-layer)
6. [Strict Separation Rules](#6-strict-separation-rules)
7. [Eventual Consistency Model](#7-eventual-consistency-model)
8. [Ingestion Boundary Contract](#8-ingestion-boundary-contract)
9. [Forbidden Interactions](#9-forbidden-interactions)
10. [Future Implementation Gate](#10-future-implementation-gate)
11. [References](#11-references)

---

## 1. Purpose

Phase 1c.1 defined the **catalog view** of assets (`asset_state`, `asset_type`). Phase 1c.2–1c.4 defined the **read-time bridge** to semantics (adapter, scenarios, contract lock). Phase 1c.5 defines the **only permitted mutable domain** in the architecture: **asset ingestion** — how bytes enter the system, move through validation and transcoding, and eventually affect catalog state **without** touching the deterministic experience pipeline.

This document answers:

| Question | Answered here |
|----------|---------------|
| What are ingestion states? | §3 lifecycle (ingestion domain) |
| How do states change? | §4 event-driven transitions (definition only) |
| Who may mutate what? | §6 separation — ingestion mutates Asset Layer only |
| How does async ingestion relate to sync semantics? | §7 eventual consistency |
| What may ingestion never do? | §8–§9 boundary contract |

---

## 2. Architectural Position

### 2.1 Layer placement

```text
┌──────────────────────────────────────────────────────────────────┐
│ SEMANTIC LAYER (1b — frozen, synchronous, deterministic)        │
│  resolve_base_rve → cspp::enrich → media_semantic → viewer_sim    │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ read-time only (future bind)
                              │ AssetResolutionAdapter (1c.3)
                              │
┌──────────────────────────────────────────────────────────────────┐
│ ASSET LAYER — CATALOG (1c.1 — authoritative snapshots)            │
│  AssetInventoryRecord { asset_state: PENDING|PROCESSING|READY|FAILED } │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ catalog projection (events only)
                              │
┌──────────────────────────────────────────────────────────────────┐
│ INGESTION DOMAIN (1c.5 — mutable, async, non-deterministic)      │
│  UPLOADED → VALIDATING → TRANSCODING → READY | FAILED             │
│  emits: Asset*Event → (future) inventory store                    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Mutability authority

| Domain | Mutable? | Deterministic? | In pipeline? |
|--------|----------|----------------|--------------|
| Semantic Layer (1b) | **No** (frozen contracts) | **Yes** | **Yes** |
| Asset catalog (1c.1) | **Yes** (via ingestion/events only) | **No** (eventually consistent) | **No** |
| Ingestion (1c.5) | **Yes** — **sole mutable subsystem** | **No** (by design) | **No** |
| Adapter (1c.3) | **No** (pure function) | **Yes** (per snapshot) | **No** |
| Scenario feed (1c.4) | **No** (test replay only) | **Yes** | **No** (test) |

**Rule ING-MUT-1:** Ingestion is the **only** architectural subsystem authorized to initiate Asset Layer state changes over time.

**Rule ING-MUT-2:** No other subsystem (including semantic pipeline, adapter, or scenario replay) may **write** authoritative catalog state in production — adapter and scenarios **read** snapshots only.

### 2.3 Upstream and non-deterministic by design

Ingestion is **upstream** of catalog materialization and **downstream** of studio upload intent. It is intentionally:

- **Asynchronous** — transitions occur on wall-clock, queue depth, and worker availability (defined, not implemented)
- **Non-deterministic** — two identical uploads may complete in different order or timing
- **Outside** the semantic pipeline — `compose_pipeline` never awaits ingestion

---

## 3. Ingestion Lifecycle (Conceptual)

### 3.1 Ingestion states (ingestion domain only)

These states describe **ingestion job progress**, not RVE fields and not semantic `inventory_state`. They are **not** wire values in RVE `metadata`.

| State | Meaning |
|-------|---------|
| `UPLOADED` | Bytes accepted; ingest job registered; no validation started |
| `VALIDATING` | Format, container, policy, and integrity checks in flight |
| `TRANSCODING` | Encode / transcode / packaging work in flight |
| `READY` | Ingestion terminal success; catalog may publish `asset_state: READY` |
| `FAILED` | Ingestion terminal failure; catalog may publish `asset_state: FAILED` |

**Rule ING-LC-1:** Ingestion lifecycle states are **orthogonal** to catalog `asset_state` (1c.1). Implementations **must** map between them via events (§5), not alias them in code or docs without explicit mapping table.

### 3.2 State machine (normative)

```text
                    ┌─────────────┐
                    │  UPLOADED   │
                    └──────┬──────┘
                           │ AssetValidationEvent (start)
                           ▼
                    ┌─────────────┐
               ┌───│ VALIDATING  │───┐
               │   └──────┬──────┘   │
               │          │ pass     │ fail
               │          ▼          ▼
               │   ┌─────────────┐  ┌────────┐
               │   │ TRANSCODING │  │ FAILED │ (terminal)
               │   └──────┬──────┘  └────────┘
               │          │
               │     pass │ fail
               │          ├──────────────────► FAILED
               │          ▼
               │   ┌─────────────┐
               └──►│    READY    │ (terminal)
                   └─────────────┘
```

### 3.3 Transition rules

| ID | Rule |
|----|------|
| ING-TR-1 | Every transition **must** be justified by exactly one domain event (§4). |
| ING-TR-2 | Transitions are **event-driven** and **asynchronous** in definition: consumers observe events after work completes; no synchronous coupling to resolve requests. |
| ING-TR-3 | No persistence layer is defined in 1c.5; state machine is a **contract** for future stores and workers. |
| ING-TR-4 | Re-entry from `FAILED` requires a **new** ingest attempt (new correlation id); in-place resurrection is undefined until a future amendment. |
| ING-TR-5 | `READY` and `FAILED` are **terminal** for a given ingest job correlation id. |

### 3.4 Allowed transitions

| From | Event (trigger) | To |
|------|-----------------|-----|
| — (start) | `AssetUploadedEvent` | `UPLOADED` |
| `UPLOADED` | `AssetValidationEvent` (started) | `VALIDATING` |
| `VALIDATING` | `AssetValidationEvent` (passed) | `TRANSCODING` |
| `VALIDATING` | `AssetValidationEvent` (failed) | `FAILED` |
| `TRANSCODING` | `AssetTranscodingEvent` (progress) | `TRANSCODING` (same state, new event) |
| `TRANSCODING` | `AssetTranscodingEvent` (completed) | `READY` (ingestion) |
| `TRANSCODING` | `AssetTranscodingEvent` (failed) | `FAILED` |
| `READY` (ingestion) | `AssetReadyEvent` | `READY` (terminal, catalog projection) |
| `FAILED` | `AssetFailedEvent` | `FAILED` (terminal) |

---

## 4. Ingestion Event Model

Events are **descriptions** of state transitions. They do not implement handlers, queues, or storage in 1c.5.

### 4.1 Common event envelope (abstract)

All ingestion events share:

| Field | Required | Description |
|-------|----------|-------------|
| `event_id` | Yes | Unique event identifier (opaque) |
| `event_type` | Yes | One of §4.2–§4.6 type names |
| `asset_id` | Yes | Target asset correlation id |
| `ingest_job_id` | Yes | Ingest attempt correlation id |
| `observed_at` | Yes | ISO-8601 timestamp (ingestion clock; not resolve clock) |
| `ingestion_state` | Yes | Post-transition ingestion state (§3.1) |
| `scope_episode_id` | No | Binding hint for catalog projection |
| `scope_reel_id` | No | Binding hint for catalog projection |
| `payload` | No | Event-specific body (§4.2–§4.6) |

**Rule ING-EV-1:** Events **must not** contain URLs, signed links, bucket paths, or MIME types in fields that could be copied into RVE (NC-105).

**Rule ING-EV-2:** Events **must not** contain semantic fields (`media_state`, `media_intent`, `inventory_state`, campaign ids, layout keys).

### 4.2 `AssetUploadedEvent`

| Property | Value |
|----------|-------|
| **Describes** | Initial registration after upload accept |
| **Ingestion transition** | → `UPLOADED` |
| **Typical catalog effect** | Create or update record: `asset_state: PENDING` |

| `payload` field | Description |
|-----------------|-------------|
| `asset_type` | `video` \| `image` \| `audio` (initial guess) |
| `asset_source` | `upload` \| `ingest` |
| `byte_length` | Optional size hint |
| `content_fingerprint` | Optional opaque hash |

### 4.3 `AssetValidationEvent`

| Property | Value |
|----------|-------|
| **Describes** | Validation started, passed, or failed |
| **Ingestion transitions** | `UPLOADED` → `VALIDATING`; pass → `TRANSCODING`; fail → `FAILED` |

| `payload` field | Description |
|-----------------|-------------|
| `validation_phase` | `started` \| `passed` \| `failed` |
| `failure_code` | Optional opaque code when `failed` |
| `failure_reason` | Optional human-audit string (not for RVE) |

### 4.4 `AssetTranscodingEvent`

| Property | Value |
|----------|-------|
| **Describes** | Transcode/encode progress or completion |
| **Ingestion transitions** | `VALIDATING` → `TRANSCODING` (on first start); remain or → `READY` / `FAILED` |

| `payload` field | Description |
|-----------------|-------------|
| `transcode_phase` | `started` \| `progress` \| `completed` \| `failed` |
| `profile_key` | Optional encode profile identifier (opaque) |
| `progress_ratio` | Optional 0.0–1.0 for `progress` |

### 4.5 `AssetReadyEvent`

| Property | Value |
|----------|-------|
| **Describes** | Ingestion terminal success |
| **Ingestion transition** | → `READY` (ingestion domain) |
| **Typical catalog effect** | `asset_state: READY`; optional `thumbnail_asset_id` linkage |

| `payload` field | Description |
|-----------------|-------------|
| `derived_asset_ids` | Optional list of child assets (proxies, thumbs) |
| `primary_rendition_id` | Optional opaque rendition key |

### 4.6 `AssetFailedEvent`

| Property | Value |
|----------|-------|
| **Describes** | Ingestion terminal failure |
| **Ingestion transition** | → `FAILED` (ingestion domain) |
| **Typical catalog effect** | `asset_state: FAILED` |

| `payload` field | Description |
|-----------------|-------------|
| `failure_stage` | `validation` \| `transcoding` \| `storage` \| `unknown` |
| `failure_code` | Optional opaque code |
| `retryable` | Boolean hint for operator UI (not semantic) |

### 4.7 Event ordering (informative)

Within a single `ingest_job_id`, events **should** be totally ordered by `observed_at`. Cross-job ordering for the same `asset_id` is undefined. Consumers **must** tolerate out-of-order delivery at the catalog projector and rely on idempotent projection rules (future implementation).

---

## 5. Catalog Projection (Ingestion → Asset Layer)

Ingestion does not write RVE. It **may** project into the catalog model (1c.1) through a future **inventory projector** (not defined here).

### 5.1 Informative mapping: ingestion state → `asset_state`

| Ingestion state (§3.1) | Projected `asset_state` (1c.1) |
|------------------------|--------------------------------|
| `UPLOADED` | `PENDING` |
| `VALIDATING` | `PROCESSING` |
| `TRANSCODING` | `PROCESSING` |
| `READY` (ingestion) | `READY` |
| `FAILED` (ingestion) | `FAILED` |

**Rule ING-PROJ-1:** Projection is **one-way**. Semantic Layer **must not** infer ingestion state from `asset_state` during resolve.

**Rule ING-PROJ-2:** Adapter (1c.3) reads **catalog snapshots only**, never raw ingestion events.

### 5.2 Projection side effects (allowed vs forbidden)

| Allowed catalog mutations | Forbidden |
|---------------------------|-----------|
| `asset_state`, `asset_type`, `asset_source` | RVE `metadata.media_*` |
| `scope_episode_id`, `scope_reel_id` | `campaigns[]`, `slots[]`, layout |
| `thumbnail_asset_id` (Asset Layer link) | `CompositionPlan` |
| New `derived` asset rows | URLs in any experience artifact |

---

## 6. Strict Separation Rules

### 6.1 Ingestion may only modify Asset Layer state

| ID | Statement |
|----|-----------|
| ING-SEP-1 | Ingestion **may** emit events and (future) update authoritative asset catalog rows. |
| ING-SEP-2 | Ingestion **must not** invoke or modify resolver, CSPP, media semantic, or viewer_sim. |
| ING-SEP-3 | Ingestion **must not** call `AssetResolutionAdapter` or consume `SemanticMediaBinding`. |
| ING-SEP-4 | Ingestion **must not** read or write `scenario_feed` / test scenarios. |
| ING-SEP-5 | Ingestion **must not** perform semantic interpretation (no `media_state`, no placeholder policy). |

### 6.2 Downstream systems must remain ignorant

| System | Requirement |
|--------|-------------|
| Resolver (1b) | No ingest tables, queues, or event subscriptions |
| CSPP (1b) | No assumption that ingest completed |
| Media semantic (1b) | No live ingest polling; harness hints test-only |
| Viewer (1b) | No ingest status UI in `viewer_sim` |
| Adapter (1c.3) | Snapshot-only input; no event stream |
| Scenario (1c.4) | No coupling to ingestion events |

### 6.3 No viewer-visible logic in ingestion

Ingestion **must not** decide:

- Which panel is visible
- Which placeholder tier the viewer shows
- Campaign winners or slot bindings
- `media_intent` or `content_format`

Those remain Semantic Layer or adapter read-time concerns per [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md).

---

## 7. Eventual Consistency Model

### 7.1 Two clocks

| Clock | Domain | Behavior |
|-------|--------|----------|
| **Resolve clock** | Semantic pipeline | Synchronous per request; deterministic output |
| **Ingest clock** | Ingestion | Asynchronous; event-ordered per job |

A resolve request at time T **may** observe catalog snapshots from T − Δ where Δ is unbounded in the contract (no SLA in 1c.5).

### 7.2 Consistency guarantees (normative)

| ID | Guarantee |
|----|-----------|
| ING-EC-1 | **Semantic Layer** remains strictly deterministic: same RVE inputs → same pipeline outputs, regardless of ingest progress. |
| ING-EC-2 | **Asset Layer** is **eventually consistent** with ingestion: given quiescent ingestion, catalog converges to reflect terminal events. |
| ING-EC-3 | **Adapter** resolves **inconsistencies at read-time only**: given a catalog snapshot + `media_reference`, output is deterministic; it does not heal or push catalog state. |
| ING-EC-4 | Stale reads (catalog behind ingestion) surface as `PENDING` / `PROCESSING` catalog states → adapter maps to `PLACEHOLDER_MEDIA` per 1c.2 §5.1 step 3. |
| ING-EC-5 | Missing catalog rows surface as `FALLBACK_MEDIA` at bind time, not as pipeline failures. |

### 7.3 Diagram: consistency boundaries

```text
  [ Upload / Studio ] ──async──► [ Ingestion events ] ──► [ Catalog store ]
                                                                    │
                                                                    │ snapshot read
                                                                    ▼
  [ Resolve request ] ──sync──► [ Semantic pipeline ]     [ Adapter @ bind ]
         │                              │                         │
         └──────── no ingest await ─────┴─────────────────────────┘
```

---

## 8. Ingestion Boundary Contract

### 8.1 Outputs (only)

Ingestion **produces**:

1. Ingestion domain events (§4)
2. Asset catalog mutations (§5) — future persistence
3. Optional derived asset registrations (thumbnails, proxies) as separate `asset_id` rows

### 8.2 Non-outputs (never)

| Forbidden output | Reason |
|------------------|--------|
| RVE JSON mutations | Semantic freeze |
| `CompositionPlan` changes | Viewer inputs frozen per resolve |
| Semantic enum writes | ASCL-EXP-1 |
| Direct Viewer notifications | Viewer binds at display time via adapter/bundle |
| Pipeline stage callbacks | ING-3 (1c.0) |

### 8.3 Contract summary

| ID | Rule |
|----|------|
| ING-BC-1 | Ingestion produces **asset state changes only** (catalog + events). |
| ING-BC-2 | **No semantic interpretation** occurs inside ingestion. |
| ING-BC-3 | **No viewer-visible logic** originates in ingestion. |
| ING-BC-4 | Semantic interpretation of catalog snapshots happens **only** in `AssetResolutionAdapter` at read-time (future Viewer bind), not during ingest. |
| ING-BC-5 | Media semantic pipeline remains a **policy simulation** without ingest I/O until a separate, explicit amendment. |

---

## 9. Forbidden Interactions

```text
 FORBIDDEN EDGES (1c.5)
 ─────────────────────
 ingestion ──X──► experience_resolve
 ingestion ──X──► cspp
 ingestion ──X──► media_semantic_resolver
 ingestion ──X──► viewer_sim
 ingestion ──X──► compose_pipeline
 ingestion ──X──► AssetResolutionAdapter (call path)
 ingestion ──X──► scenario_feed
 adapter     ──X──► ingestion (event subscription)
 semantic    ──X──► ingestion (poll / await)
```

**ING-BC-6:** Any implementation introducing an edge above requires architecture amendment per [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) §10 and [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) §6.

---

## 10. Future Implementation Gate

Before merging ingestion **implementation**:

| # | Gate |
|---|------|
| G1 | This document (1c.5) referenced in service README / ops runbook |
| G2 | Event schemas versioned separately from RVE `schema_version` |
| G3 | Inventory projector idempotent; provably no RVE writes |
| G4 | Proof of no resolver/CSPP/pipeline/adapter/scenario code changes in same merge unless amended |
| G5 | Contract tests: ingest events do not alter `run_from_base_rve` output |
| G6 | Failure split preserved: detection in ingest, representation in semantic/adapter, rendering in Viewer |
| G7 | Persistence design reviewed against §5 projection table |

**1c.5 verdict:** **APPROVED** as ingestion architecture contract. **No implementation authorized** by this document alone.

---

## 11. References

| Document | Role |
|----------|------|
| [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md) | Layer gate; §4 updated for 1c.5 |
| [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) | Catalog `asset_state` |
| [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md) | Read-time mapping |
| [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) | Frozen semantic/asset authority |
| [`MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md`](./MEDIA_INVENTORY_AND_PLACEHOLDER_ARCHITECTURE.md) | Informative semantic ladders |

---

*End of Phase 1c.5 asset ingestion contract.*
