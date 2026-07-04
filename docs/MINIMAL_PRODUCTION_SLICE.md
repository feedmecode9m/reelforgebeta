# Minimal Production Slice

**Status:** Normative runtime-surface definition (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Authority:** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md), [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md)

**Explicit non-goals:** Code, CI, pipeline, schema, API, ingestion, CDN, thumbnails, runtime registry implementation, or new enforcement surfaces.

**Purpose:** Define the **smallest end-to-end production-capable slice** that operates entirely within the frozen architecture (1b semantic core + 1c read-only adapter contract) and produces **observable, deterministic user-facing semantics**—without requiring Asset Layer infrastructure.

---

## Table of Contents

1. [Purpose of the Minimal Slice](#1-purpose-of-the-minimal-slice)
2. [End-to-End Flow (Minimal)](#2-end-to-end-flow-minimal)
3. [Included Systems](#3-included-systems-only-these-count-as-production-slice)
4. [Excluded Systems](#4-excluded-systems-critical)
5. [User-Visible Output Definition](#5-user-visible-output-definition)
6. [Degree of Completeness Model](#6-degree-of-completeness-model)
7. [Deployment Interpretation](#7-deployment-interpretation)
8. [Stability Guarantee](#8-stability-guarantee)
9. [Final Declaration](#9-final-declaration)

---

## 1. Purpose of the Minimal Slice

### 1.1 What “first real product behavior” means

In ReelForge, **first real product behavior** is not “all media infrastructure online.” It is the **smallest coherent runtime** that:

1. Accepts a resolve context (episode / profile inputs).
2. Executes the **frozen semantic pipeline** deterministically.
3. Emits **observable composition artifacts** a client can render or inspect.
4. Optionally performs **read-only adapter bind** against a catalog snapshot **without** mutating pipeline outputs.
5. Remains provable under [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md).

This is **minimal viable runtime semantics**—not infrastructure completeness.

### 1.2 Architectural boundaries (non-negotiable)

| Boundary | Rule |
|----------|------|
| Semantic core | Frozen four-stage orchestrator (1b); no fifth stage |
| Adapter | Read-only bridge (1c); **not** inside `compose_pipeline` per ASCL §2 |
| Asset infrastructure | May be absent; catalog supplied as **snapshot** at bind time only |
| CI | [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) is the validation gate; no extensions |

### 1.3 Distinction from production readiness

| Concept | Question answered |
|---------|-----------------|
| **Production readiness** | “Is this revision architecturally safe to deploy?” ([`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md)) |
| **Minimal production slice** | “What is the smallest runtime that delivers usable deterministic product output?” (this document) |

A system may be **production-ready** (CI PASS) while operating only at **LEVEL 0** or **LEVEL 1** completeness (§6).

---

## 2. End-to-End Flow (Minimal)

### 2.1 Canonical logical flow

The **minimal production slice** is described by this **logical** end-to-end chain:

```text
resolver → CSPP → media semantic layer → [read-only adapter] → viewer_sim
                                              ↑
                                    catalog snapshot (optional)
```

### 2.2 Frozen orchestrator vs bind adjacency (critical)

The **runtime orchestrator** remains the frozen four-stage path (unchanged):

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

| Segment | In `compose_pipeline`? | Role in minimal slice |
|---------|------------------------|------------------------|
| resolver → CSPP → media → viewer_sim | **Yes** | **Core runtime** — produces all primary user-visible artifacts |
| adapter (read-only) | **No** | **Adjacent bind** — reconciles catalog vs `metadata` **after** media semantics exist; does not reorder or replace viewer stage |

**Clarification:** Adapter **logically follows** media semantic output (it consumes `MetadataSnapshot` derived from delivered-with-media RVE) and **precedes or accompanies** client bind/display interpretation. It does **not** execute between media and `simulate_viewer` inside the orchestrator. Viewer inputs are **only** Base RVE + delivered-with-media JSON.

This preserves ASCL §2 while still defining a complete **product-facing** story: composition from the pipeline; bind classification from optional adapter read.

### 2.3 Real vs stubbed vs deferred

| Component | Status in minimal slice | Notes |
|-----------|-------------------------|-------|
| **Resolver** | **Real** | Production resolve path / harness base RVE |
| **CSPP** | **Real** | Campaign/slot injection per frozen rules |
| **Media semantic layer** | **Real logic, stubbed inventory** | `apply_media_semantic_stub` applies frozen enums; byte reality deferred |
| **Viewer sim** | **Real** | Deterministic `CompositionPlan` / `RenderTree` |
| **Adapter** | **Real mapping, snapshot input** | Pure function over in-memory catalog records; no I/O required |
| **Catalog persistence** | **Deferred** | Snapshot may be mock, fixture, or static registry |
| **Ingestion / CDN / thumbs** | **Deferred** | Not in slice (§4) |

### 2.4 Deterministic vs deferred

| Concern | Deterministic (required) | Deferred (allowed) |
|---------|--------------------------|---------------------|
| RVE shape after resolve | Yes | — |
| `campaigns[]` / `slots[]` after CSPP | Yes | — |
| `metadata.media_*` after media layer | Yes | — |
| `CompositionPlan` / `RenderTree` | Yes | — |
| Adapter bind for fixed snapshot + metadata | Yes | — |
| Byte fetch, transcode, CDN URL | — | Yes (LEVEL 2) |
| Eventual catalog consistency | — | Yes (snapshot frozen at read) |

---

## 3. Included Systems (Only These Count as “Production Slice”)

Only the following systems constitute the **minimal production slice**. All are already defined by frozen contracts; this section names the deployable **runtime surface**, not new modules.

| System | Phase | Function in slice | CI / contract anchor |
|--------|-------|-------------------|----------------------|
| **Resolver** | 1b | Base RVE from context | `experience_resolve`, 1b.7 |
| **CSPP** | 1b | Delivered RVE (campaigns, slots) | `experience/cspp/`, ASCL §2 |
| **Media semantic resolver** | 1b | `metadata.media_*` semantics | `media/`, stub apply path |
| **Viewer simulation** | 1b | `CompositionPlan` / `RenderTree` | `viewer_sim/`, VIEW-* |
| **Asset adapter** | 1c | Read-only bind enrichment | `AssetResolutionAdapter`, 1c.2–1c.3 |
| **CI operational model** | — | Validation gate (not runtime) | `./scripts/ci-architecture-integrity.sh` |

### 3.1 Runtime invocation pattern (minimal)

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. Run frozen orchestrator (required)                        │
│    compose_pipeline::run / run_from_base_rve                 │
│    → base_rve, delivered_rve, delivered_with_media, plan     │
├──────────────────────────────────────────────────────────────┤
│ 2. Optional read-only adapter (LEVEL 1 bind surface)         │
│    AssetResolutionAdapter::resolve(snapshot, metadata)       │
│    → SemanticMediaBinding / AdapterResult                    │
│    (must not alter step 1 artifacts)                         │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 What counts as “running the slice”

| Action | Included? |
|--------|-----------|
| HTTP `GET /api/experience/resolve` → orchestrator path | Yes |
| Harness `run_from_base_rve` → same artifacts | Yes |
| Test-only adapter after pipeline (1c.3/1c.4 pattern) | Yes (bind surface) |
| Scenario feed driving production resolve | **No** |
| Ingest worker updating RVE | **No** |

---

## 4. Excluded Systems (Critical)

The following are **not part** of the minimal production slice. Their presence or absence does not change slice membership.

| Excluded system | Reason |
|-----------------|--------|
| **Ingestion pipeline** | Async mutable domain; external to semantic path |
| **CDN / thumbnails / encoding** | Byte delivery; LEVEL 2 infrastructure |
| **`scenario_feed` system** | Test-only; zero production authority |
| **Runtime asset registry implementation** | Observability zone; not required for slice output |
| **`asset_runtime` / `runtime_asset_mode` in prod** | Optional; CI proves non-semantic effect only |
| **Future 1c infrastructure** | Catalog projector, transcode workers, storage mappers |
| **Any non-deterministic external system** | Network/time/random catalog mutation during orchestrator run |

**Rule:** If a system can introduce **nondeterminism** or **semantic mutation** inside the frozen orchestrator, it is **out of slice**.

---

## 5. User-Visible Output Definition

**Observable behavior** means artifacts a client, Studio tool, or harness can inspect **without** requiring bytes on disk or CDN URLs.

### 5.1 Primary outputs (from viewer_sim — always in slice)

| Output | Type | Description |
|--------|------|-------------|
| **CompositionPlan** | Structured plan | Full composition artifact including render instructions |
| **RenderTree** | Tree embedded in plan | Zone/panel/slot visibility and ordering for viewer |
| **Delivered with media RVE** | JSON | Delivered RVE + frozen `metadata.media_*` fields |

### 5.2 Semantic classification outputs (from media layer)

| Field | User-visible meaning |
|-------|---------------------|
| **`media_state`** | Viewer-facing tier: `REAL_MEDIA`, `DERIVED_MEDIA`, `PLACEHOLDER_MEDIA`, `FALLBACK_MEDIA` |
| **`inventory_state`** | Semantic inventory view: `PENDING`, `READY`, `MISSING`, `FAILED` |
| **`media_intent`** | Presentation class (e.g. `DOCUMENTARY`, `CLIP`) |
| **`thumbnail_resolution`** | Thumbnail tier decision (not a file path) |
| **`media_reference`** | Opaque bind token (`episode:{uuid}`, `asset:{uuid}`, null) |

### 5.3 CSPP outputs (when campaigns/slots active)

| Output | User-visible meaning |
|--------|---------------------|
| **`campaigns[]`** | Injected campaign records on delivered RVE |
| **`slots[]`** | Slot bindings / collision-resolved placements |
| **Slot injection results** | Which slots rendered, suppressed, or deferred per CSPP rules |

Empty `campaigns[]` / `slots[]` is valid observable output (deterministic “no injection”).

### 5.4 Secondary bind output (adapter — LEVEL 1, optional surface)

| Output | User-visible meaning |
|--------|---------------------|
| **`SemanticMediaBinding`** | Reconciled bind class from catalog snapshot + metadata |
| **`AdapterResult`** | Trinary outcome aligned to `media_state` vocabulary |

Adapter output **supplements** display/bind interpretation; it **must not** replace or mutate `CompositionPlan` when used per contract (1c.3 tests: viewer unchanged).

### 5.5 Explicitly not user-visible in minimal slice

| Not observable here | Where it belongs |
|--------------------|------------------|
| HTTPS media URLs in RVE | Forbidden (NC-105); LEVEL 2 bundle handles |
| `ingestion_state` | Ingestion domain only |
| `asset_state` in API response | Catalog-internal |
| Scenario timeline labels | Test harness only |

---

## 6. Degree of Completeness Model

Three levels describe how much of the **product** is live—not how much of **architecture enforcement** exists (CI always required for readiness).

### LEVEL 0 — Semantic correctness only (current baseline)

| Property | Value |
|----------|-------|
| **Runtime** | Frozen orchestrator only |
| **Adapter** | Not invoked in product path |
| **Outputs** | RVE + `CompositionPlan` / `RenderTree` |
| **Catalog** | Ignored at runtime |
| **CI** | Operational model PASS |
| **Typical use** | Resolve API, composition harness, contract proofs |

**Baseline today:** Production readiness can be achieved at LEVEL 0.

### LEVEL 1 — Minimal production slice (this document)

| Property | Value |
|----------|-------|
| **Runtime** | Orchestrator + **optional read-only adapter** on catalog snapshot |
| **Outputs** | LEVEL 0 artifacts **plus** bind classification when adapter invoked |
| **Catalog** | In-memory snapshot / fixture (no persistence required) |
| **Infrastructure** | Still **no** ingest, CDN, or thumbs |
| **CI** | Same operational model PASS (no new gates) |

**Definition:** First **usable deterministic runtime surface** that includes asset **abstraction** at bind time without asset **infrastructure**.

### LEVEL 2 — Full asset + ingestion system (future, not required)

| Property | Value |
|----------|-------|
| **Runtime** | LEVEL 1 + persistent catalog + ingest events + delivery handles |
| **Outputs** | Materialized bytes via `MaterializedAssetBundle` (opaque handles) |
| **CI** | Still operational model PASS; no new enforcement per canonical §6.4 |
| **Required for minimal slice?** | **No** |

```text
 LEVEL 0 ──► semantic orchestrator only
     │
     ▼
 LEVEL 1 ──► + read-only adapter bind (minimal production slice)
     │
     ▼
 LEVEL 2 ──► + ingest / CDN / catalog persistence (future)
```

---

## 7. Deployment Interpretation

### 7.1 Core clarifications

> **Production readiness ≠ full feature completeness.**

> **Production slice = first usable deterministic runtime surface.**

| Statement | Meaning |
|-----------|---------|
| CI PASS | Revision is **logically production-ready** ([`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md)) |
| Deploy LEVEL 0 | Ship semantic resolve + composition only |
| Deploy LEVEL 1 | Ship semantic core **and** bind endpoint that calls adapter read-only with snapshots |
| Deploy LEVEL 2 | Requires controlled-zone infrastructure; **outside** minimal slice |

### 7.2 Operator checklist (minimal slice deploy)

| Step | Requirement |
|------|-------------|
| 1 | `./scripts/ci-architecture-integrity.sh` PASS on deploy SHA |
| 2 | Orchestrator path enabled (resolve → CSPP → media → viewer) |
| 3 | If LEVEL 1: adapter wired **outside** orchestrator; catalog snapshot source documented |
| 4 | Confirm no excluded systems (§4) are wired into orchestrator |
| 5 | Do **not** treat ingest/CDN absence as blocking if LEVEL 1 criteria met |

### 7.3 What “deployable product” means at LEVEL 1

A product instance **implements the minimal slice** when users (or Studio) can:

1. Trigger resolve and receive deterministic RVE + `CompositionPlan`.
2. See consistent `media_state` and slot/campaign injection results.
3. Optionally query bind classification from the same metadata + catalog snapshot.
4. Observe **no change** in composition when only catalog bytes arrive later (eventual consistency at bind, not in orchestrator).

---

## 8. Stability Guarantee

The minimal production slice inherits stability from existing enforcement—**no new guarantees** are introduced.

| Guarantee | Enforcement |
|-----------|-------------|
| **CI operational model PASS** | Required for production readiness; blocks deploy on any `*_BLOCK` |
| **Determinism across repeated runs** | System hardening: repeatability, purity, golden snapshots |
| **No dependency on asset infrastructure** | Orchestrator uses semantic stub; adapter accepts snapshot without I/O |
| **`runtime_asset_mode` does not affect slice outputs** | Stage 2b + parity tests |
| **Adapter does not mutate pipeline artifacts** | 1c.3 tests + ASCL orchestrator ban |
| **Scenario / ingest cannot influence orchestrator** | DGEL forbidden edges + hardening import scan |

**Corollary:** LEVEL 1 deploys must not wire ingest polling, CDN fetch, or scenario replay into the orchestrator path—even if LEVEL 2 infrastructure exists elsewhere in the repo.

---

## 9. Final Declaration

### MINIMAL PRODUCTION SLICE DECLARATION

> **The minimal production slice is the smallest coherent runtime system**  
> **that produces deterministic, observable output under CI governance,**  
> **without requiring any asset infrastructure systems.**

Formally, the slice is:

```text
Frozen orchestrator (resolver → CSPP → media → viewer_sim)
  + optional read-only adapter bind (catalog snapshot)
  + CI operational model PASS
  − ingestion, CDN, thumbs, encoding, scenario_feed, runtime registry (prod)
```

### 9.1 Summary table

| Question | Answer |
|----------|--------|
| What is the slice? | LEVEL 1 runtime semantics per §2–§3 |
| What do users see? | §5 outputs |
| Is ingest required? | **No** |
| Is CI required? | **Yes** ([`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md)) |
| Does slice imply LEVEL 2? | **No** |

### 9.2 References

| Document | Role |
|----------|------|
| [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) | Frozen zones and pipeline |
| [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md) | Deploy eligibility gate |
| [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) | Proof of correctness |
| [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) | Orchestrator vs adapter boundary |

---

*End of Minimal Production Slice v1.0.*
