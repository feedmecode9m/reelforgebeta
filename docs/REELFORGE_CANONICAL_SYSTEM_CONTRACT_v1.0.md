# ReelForge Canonical System Contract v1.0

**Status:** **AUTHORITATIVE** — single source of truth for all future development  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Role:** This document **consolidates** all prior normative architecture into one governance contract. It does not replace detail references; it **supersedes informal interpretation** when documents disagree. Detail remains in phase-specific artifacts (linked below).

**Explicit non-goals (v1.0):** Code, schema, API, pipeline, runtime, CI tooling, or dependency policy changes. Documentation-only consolidation and governance freeze.

**Detail references (subordinate to this contract unless formally amended):**

| Domain | Primary references |
|--------|-------------------|
| Semantic Layer (1b) | [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) |
| Asset boundary (1c) | [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md), [`PHASE_1C1`–`1C5`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md) docs |
| Authority ontology | [`SYSTEM_SEMANTIC_AUTHORITY_MAP.md`](./SYSTEM_SEMANTIC_AUTHORITY_MAP.md) |
| Freeze enforcement | [`PHASE_1C7_ARCHITECTURE_FREEZE.md`](./PHASE_1C7_ARCHITECTURE_FREEZE.md) |
| Structural enforcement | [`DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md`](./DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md), [`architecture/dependency_policy.toml`](../architecture/dependency_policy.toml) |
| Semantic enforcement | `backend/src/system_hardening/` |
| CI operations | [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) |
| CI composition (background) | [`CI_ARCHITECTURE_INTEGRITY_MODEL.md`](./CI_ARCHITECTURE_INTEGRITY_MODEL.md) |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Frozen Semantic Core (1b)](#2-frozen-semantic-core-1b)
3. [Asset Abstraction Layer (1c)](#3-asset-abstraction-layer-1c)
4. [Dependency Enforcement (DGEL)](#4-dependency-enforcement-dgel)
5. [System Hardening Layer](#5-system-hardening-layer)
6. [CI Fusion Model](#6-ci-fusion-model)
7. [Authority Hierarchy](#7-authority-hierarchy)
8. [Evolution Rules](#8-evolution-rules)
9. [Forbidden Actions](#9-forbidden-actions)
10. [Amendment Protocol](#10-amendment-protocol)
11. [Validation Requirement](#11-validation-requirement)
12. [System State Declaration](#12-system-state-declaration)

---

## 1. System Overview

### 1.1 Definition

**ReelForge** is a **deterministic, multi-layer pipeline system** that transforms resolve context and experience configuration into a **Resolved Viewer Experience (RVE)** and a **CompositionPlan** (render tree) without coupling to byte storage, network fetch, or async ingest completion.

The system is organized into:

| Layer class | Nature | Mutability |
|-------------|--------|------------|
| **Semantic Layer** | Contract-driven RVE + composition | **Frozen** (v1.0) |
| **Asset Layer** | Catalog, ingestion, delivery infrastructure | **Controlled** (implementation allowed) |
| **Enforcement Layer** | DGEL + hardening + CI fusion | **Active** (CI-only; no runtime) |

### 1.2 Core guarantee

For any fixed inputs to the frozen pipeline:

```text
identical inputs → identical Base RVE → identical Delivered RVE
                → identical media metadata semantics → identical CompositionPlan
```

Non-determinism, hidden state, or runtime toggles that alter semantic output are **architectural defects**.

### 1.3 System boundary

```text
                    ┌──────────────────────────────────────┐
  HTTP / harness    │  SEMANTIC CORE (frozen)              │
  resolve context ─►│  resolver → CSPP → media → viewer   │──► RVE + CompositionPlan
                    └──────────────────┬───────────────────┘
                                       │ opaque refs only
                    ┌──────────────────▼───────────────────┐
                    │  ASSET LAYER (external)              │
                    │  catalog · adapter · ingestion       │
                    └──────────────────────────────────────┘
```

The semantic core **never** awaits ingestion, **never** embeds URLs in RVE, and **never** imports asset runtime modules in frozen modules (enforced by DGEL and hardening).

---

## 2. Frozen Semantic Core (1b)

### 2.1 Frozen production pipeline

The **only** authorized production experience path:

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

| Stage | Module domain | Output artifact |
|-------|---------------|-----------------|
| **Resolver** | `experience/experience_resolve.rs` (+ loaders, contract) | **Base RVE** |
| **CSPP** | `experience/cspp/` | **Delivered RVE** (`campaigns[]`, `slots[]`) |
| **Media semantic** | `media/` | **Delivered with media** (`metadata.media_*`) |
| **Viewer sim** | `viewer_sim/` | **CompositionPlan** / **RenderTree** |

**Orchestrator:** `experience/compose_pipeline.rs` — wiring only; no semantic invention.

### 2.2 Resolver

| Property | Rule |
|----------|------|
| Authority | Owns Base RVE structure: `layout`, `visibility`, `theme`, `labels`, `resolve_context`, `provenance` |
| Forbidden | Asset catalog, ingestion, adapter, URLs, `asset_state` |
| Determinism | Same profile + context → same Base RVE (RES-* in 1b.7) |

### 2.3 CSPP (Campaign / Slot Post-Processor)

| Property | Rule |
|----------|------|
| Authority | Injects `campaigns[]` and `slots[]`; collision resolution per CSPP contract |
| Forbidden | Media bytes, `asset_state`, adapter calls, semantic metadata mutation beyond delivery fields |
| Purity | Must not alter Base RVE structural snapshot or pre-existing `metadata` ordering (hardening: `test_cspp_purity`) |

### 2.4 Media semantic layer

| Property | Rule |
|----------|------|
| Authority | Owns frozen `metadata.media_*` enums and fields |
| Frozen enums | `media_state`, `inventory_state`, `media_intent`, `media_placeholder_policy`, `media_failure_mode`, `media_reference_validity`, `thumbnail_resolution` |
| Forbidden | New media states, URL-shaped strings (NC-105), direct catalog/`asset_state` reads in pipeline |

**`media_state` (semantic):** `REAL_MEDIA`, `DERIVED_MEDIA`, `PLACEHOLDER_MEDIA`, `FALLBACK_MEDIA` — **closed set**.

### 2.5 Viewer simulation

| Property | Rule |
|----------|------|
| Authority | Produces `CompositionPlan` / `RenderTree` from Base + delivered-with-media inputs |
| Forbidden | Upstream mutation of RVE, resolver/CSPP calls, ingestion |
| Purity | Pure function of inputs (hardening: `test_viewer_purity`) |
| Determinism | Identical inputs → identical render tree (DET-1 / VIEW-3) |

### 2.6 Composition determinism guarantees

| ID | Guarantee |
|----|-----------|
| **DET-1** | Full pipeline: identical harness input → identical `CompositionPlan`, delivered RVE, and media metadata snapshot |
| **DET-2** | CSPP: structural snapshot of Base RVE unchanged after enrich |
| **DET-3** | Viewer: `simulate_viewer(base, delivered)` is referentially pure across repeated calls |
| **DET-4** | No fifth pipeline stage without formal amendment (§10) |

---

## 3. Asset Abstraction Layer (1c)

The Asset Layer is **outside** the semantic pipeline. It provides catalog truth, read-time bind, and async ingestion — **abstracted here**; implementation detail in phase docs.

### 3.1 Asset model (abstract)

| Concept | Domain | Allowed values (frozen) | In RVE? |
|---------|--------|-------------------------|---------|
| `asset_id` | Catalog | UUID | No |
| `asset_type` | Catalog | `video`, `image`, `audio`, `derived` | No |
| `asset_state` | Catalog | `PENDING`, `PROCESSING`, `READY`, `FAILED` | **No** |
| `asset_source` | Catalog | `upload`, `ingest`, `generated`, `external` | No |
| `AssetInventoryRecord` | Catalog | Row snapshot | No |

**Invariant:** `asset_state` **must not** be conflated with `media_state` (semantic). Catalog mutates over time; RVE semantics do not mirror catalog columns directly.

### 3.2 Adapter (read-only bridge)

| Property | Rule |
|----------|------|
| Role | `AssetResolutionAdapter` maps catalog snapshot + `MetadataSnapshot` → `SemanticMediaBinding` / `MaterializedAssetBundle` |
| Pipeline | **Forbidden** inside `compose_pipeline` until explicit amendment |
| Semantics | Mapping table per 1c.2 §5.1 — **no new semantic invention** |
| Statelessness | Same registry + input → identical `AdapterResult` (hardening: `test_adapter_statelessness`) |

### 3.3 Scenario system (test-only)

| Property | Rule |
|----------|------|
| Modules | `scenario_feed`, `mock_registry`, `scenario_validation` |
| Authority | **Zero** production truth |
| Import rule | `#[cfg(test)]` only; never in resolver, CSPP, media, compose_pipeline |
| Purpose | Replay catalog timelines for adapter and pipeline integration tests |

### 3.4 Ingestion boundary (external system)

| Property | Rule |
|----------|------|
| Domain | Async mutable jobs: `UPLOADED` → `VALIDATING` → `TRANSCODING` → `READY` \| `FAILED` |
| Authority | Job progress only — **lowest** production truth rank |
| Forbidden | RVE writes, pipeline calls, `metadata.media_*` mutation, resolve-time await |
| Handoff | Events → catalog projection → adapter read at bind time only |

```text
 ingestion (async) ──► catalog (eventual) ──► adapter (read, bind-time)
                                              ✗ pipeline
```

---

## 4. Dependency Enforcement (DGEL)

### 4.1 Structural correctness definition

**DGEL** (Dependency Graph Enforcement Layer) validates that Rust `use` paths respect the frozen layer graph **before** semantic tests run. It is **structural**, not semantic: it cannot prove determinism or enum closure, only import topology.

| Property | Value |
|----------|-------|
| Policy | [`architecture/dependency_policy.toml`](../architecture/dependency_policy.toml) |
| Tool | `tools/depgraph-check` (`cargo run -p depgraph-check`) |
| CI script | [`scripts/ci-depgraph-check.sh`](../scripts/ci-depgraph-check.sh) |

### 4.2 Layer nodes

| Node | Responsibility |
|------|----------------|
| `resolver` | Base RVE |
| `cspp` | Campaign/slot delivery |
| `orchestrator` | `compose_pipeline` wiring |
| `media_semantic` | `metadata.media_*` |
| `viewer_sim` | CompositionPlan |
| `asset_resolution` | Adapter (production) |
| `scenario` | Test-only replay |
| `ingestion` | Mutable ingest |
| `asset_catalog` | Future projector (placeholder) |

### 4.3 Forbidden import graph (representative)

Full list: `forbidden_edges` in policy TOML. Violations are **hard fail**.

| Forbidden edge | Rationale |
|----------------|-----------|
| `resolver → asset_resolution` | Resolver remains asset-agnostic |
| `cspp → asset_resolution` | CSPP media-agnostic |
| `media_semantic → asset_resolution` | Media semantics do not read catalog in pipeline |
| `ingestion → resolver \| cspp \| media_semantic \| viewer_sim \| orchestrator` | Ingestion external to pipeline |
| `asset_resolution → resolver \| cspp \| media_semantic \| orchestrator` | Adapter does not mutate pipeline |
| `viewer_sim → resolver` (and upstream semantic) | Viewer is downstream-only |
| `scenario → *` (production paths) | Test isolation |

**Allowed orchestration path:**

```text
orchestrator → resolver | cspp | media_semantic | viewer_sim
resolver → cspp → media_semantic → viewer_sim   (logical flow via orchestrator)
asset_resolution → viewer_sim                   (boundary types only)
ingestion → asset_catalog                       (future)
```

### 4.4 Documented exceptions (data-only)

| From | To | Reason |
|------|-----|--------|
| `cspp` | `viewer_sim` | `CompositionPlan` embeds `RenderTree` |
| `viewer_sim` | `cspp` | Returns `CompositionPlan` type |

New exceptions require policy TOML `[[exception_rules]]` **and** §10 amendment.

### 4.5 Test-only path exclusions

DGEL excludes test modules from production graph enforcement, including:

- `pipeline_integration_tests.rs`, `integration_tests.rs`, `resolve_tests.rs`
- Adapter unit tests importing `scenario_feed`
- Paths under `/tests/`

**Rule:** Production modules must not import `scenario_feed` or `mock_registry`.

---

## 5. System Hardening Layer

### 5.1 Purpose

The **System Hardening Invariant Suite** (`backend/src/system_hardening/`) is a **CI verification and regression-lock layer**. It does not implement runtime behavior; it **proves** semantic invariants hold over time.

**Entry:** `cargo test -p backend --lib system_hardening`

### 5.2 Invariant suite definition

| Test | Invariant enforced |
|------|------------------|
| `test_runtime_asset_mode_does_not_change_semantics` | Pipeline outputs identical across runs; runtime adapter enrichment does not alter binding |
| `test_pipeline_deterministic_repeatability` | 10 identical runs → identical artifacts |
| `test_adapter_statelessness` | Adapter is pure over registry + metadata |
| `test_cspp_purity` | CSPP preserves Base structure and metadata |
| `test_viewer_purity` | Viewer is pure function of inputs |
| `test_no_forbidden_import_paths` | Frozen modules contain no `asset_runtime` imports |
| `test_no_semantic_field_additions` | Delivered metadata keys ⊆ frozen set |
| `test_snapshot_hashes_locked` | Documentary harness hash regression |
| `test_snapshot_json_golden_files` | JSON golden comparison (plan, RVE, media, render tree) |
| `test_dgel_policy_compliance` | Inline `depgraph-check` PASS |
| `test_ci_fusion_consistency` | DGEL + semantic harness agree; no cross-layer drift |

### 5.3 Runtime parity guarantee

**`runtime_asset_mode`** (Cargo feature) is an **observability zone** toggle:

| Allowed | Forbidden |
|---------|-----------|
| Internal runtime registry enrichment | Changing `CompositionPlan`, delivered RVE, media metadata, or render tree |
| Adapter `resolve_with_runtime` for diagnostics | Importing `asset_runtime` in resolver, CSPP, media, compose_pipeline |

**Contract:** `runtime_asset_mode` MUST behave as a pure observational toggle. Any semantic output delta = **BLOCKED** (hardening failure).

### 5.4 Deterministic execution rules

| Rule | Enforcement |
|------|-------------|
| HAR-1 | DefaultHasher-stable JSON snapshots for regression |
| HAR-2 | Documentary harness in `harness.rs` — change only via formal amendment |
| HAR-3 | Golden files under `system_hardening/snapshots/` — update via `WRITE_HARDENING_SNAPSHOTS=1` bootstrap only with audit |
| HAR-4 | No new serialization formats — reuse existing `serde_json` patterns |

---

## 6. CI Operational Model

### 6.1 Single entrypoint

**Authoritative CI command (only):**

```bash
./scripts/ci-architecture-integrity.sh
```

Detail: [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md)

`scripts/ci-depgraph-check.sh` and direct `cargo test system_hardening` invocations are **internal** — not valid standalone CI steps.

### 6.2 Immutable pipeline

```text
DGEL → SYSTEM HARDENING → FUSION VALIDATION
```

> **No stage may be run independently in CI context outside this sequence.**

| Stage | Domain |
|-------|--------|
| 1 — DGEL | Structural import graph |
| 2 — System Hardening | Semantic invariants + runtime parity |
| 3 — Fusion Validation | Cross-layer consistency (`test_ci_fusion_consistency`) |

### 6.3 Failure taxonomy (exactly three)

| Classification | CI verdict |
|----------------|------------|
| `STRUCTURAL_BLOCK` | **BLOCKED** |
| `SEMANTIC_BLOCK` | **BLOCKED** |
| `CROSS_LAYER_DRIFT_BLOCK` | **BLOCKED** |

No additional failure categories or informal warnings.

### 6.4 Non-expansion rule (enforcement topology frozen)

> **The architecture is frozen in enforcement topology.**  
> **No additional CI validators, checkers, or enforcement systems may be introduced.**  
> **Any future enforcement must replace or merge an existing mechanism.**

| Allowed | Forbidden |
|---------|-----------|
| Extend `system_hardening` tests | New parallel CI entrypoint scripts |
| Amend `dependency_policy.toml` | New checker crates without replacing DGEL |
| Update goldens with audit | Optional/split CI jobs bypassing the single pipeline |

---

## 7. Authority Hierarchy

When layers disagree, resolution follows this order (**highest wins for its domain**):

```text
 Priority 1 — SEMANTIC EXPERIENCE TRUTH (1b, frozen)
   Resolver → CSPP → Media semantic → Viewer sim
   Owns: RVE shape, campaigns/slots, metadata media enums, CompositionPlan

 Priority 2 — STRUCTURAL ARCHITECTURE TRUTH (DGEL)
   Import graph, forbidden edges, orchestrator isolation
   Owns: module coupling rules; does NOT override semantic enum meaning

 Priority 3 — ADAPTER BIND TRUTH (1c.3, read-time)
   AssetResolutionAdapter
   Owns: bind outcome for a given catalog snapshot; does NOT rewrite prior RVE

 Priority 4 — ASSET CATALOG TRUTH (1c.1)
   asset_state, asset_id, scopes — eventual consistency

 Priority 5 — INGESTION JOB TRUTH (1c.5)
   ingestion_state, ingest events — async only

 EXCLUDED — SCENARIO REPLAY (1c.4)
   Test-only; zero production authority
```

### 7.1 Hierarchy rules (canonical)

| ID | Rule |
|----|------|
| **AUTH-C1** | Semantic pipeline output is authoritative for resolve/harness paths. |
| **AUTH-C2** | DGEL is authoritative for **import topology**; semantic docs are authoritative for **meaning**. |
| **AUTH-C3** | Adapter wins at bind-time only; must not retroactively edit RVE from a prior resolve. |
| **AUTH-C4** | Catalog is authoritative for byte existence; `inventory_state` in RVE is a **view**, not a store. |
| **AUTH-C5** | Ingestion is authoritative for job progress only; semantic layers must not await it. |
| **AUTH-C6** | Scenario has no rank in production truth. |

### 7.2 Non-overlap principle

| Domain | Owner | Not owned by |
|--------|-------|--------------|
| RVE enum meaning | Semantic (1b) | DGEL, adapter, catalog |
| `use` graph legality | DGEL | Semantic tests (prove meaning, not imports) |
| Bind mapping | Adapter | Resolver, CSPP |
| Byte readiness | Catalog / ingestion | `media_state` in RVE |

---

## 8. Evolution Rules

### 8.1 Zone model

```text
 ┌──────────────── FROZEN ZONE ─────────────────────────────────┐
 │  resolver · CSPP · media_semantic · viewer_sim · pipeline    │
 │  RVE metadata.media_* enums · CompositionPlan contract       │
 │  Rule: NO semantic expansion without §10 amendment           │
 └──────────────────────────────────────────────────────────────┘

 ┌──────────────── CONTROLLED ZONE ─────────────────────────────┐
 │  ingestion · encoding · thumbnails · CDN · catalog store     │
 │  Rule: infrastructure only; outputs = catalog + opaque refs │
 └──────────────────────────────────────────────────────────────┘

 ┌──────────────── OBSERVABILITY ZONE ────────────────────────────┐
 │  runtime_asset_mode · scenario replay · hardening harness      │
 │  Rule: enrich/observe internally; MUST NOT alter semantic out │
 └──────────────────────────────────────────────────────────────┘
```

### 8.2 Frozen zone

| Permitted | Forbidden |
|-----------|-----------|
| Deterministic refactors with identical outputs | New `media_state` / `inventory_state` values |
| Bug fixes restoring contract compliance | Fifth pipeline stage |
| Contract tests extending **existing** modules | Adapter inside `compose_pipeline` |
| Documentation clarifications (non-contradicting) | Production `scenario_feed` imports |

### 8.3 Controlled zone

May implement (per 1c.5, 1c.7 §7):

- Upload accept, validation, transcode, `Asset*Event` emission
- Encoding profiles, HLS, proxies as `derived` assets
- Thumbnail generation linked via `thumbnail_asset_id`
- CDN signed URLs → `MaterializedAssetBundle` handles only
- Catalog persistence for `AssetInventoryRecord`

**Must not:** write RVE, call pipeline stages, add semantic columns consumed by resolver, embed URLs in RVE.

### 8.4 Observability zone

| Mechanism | Constraint |
|-----------|------------|
| `runtime_asset_mode` | Internal registry enrichment; parity tests mandatory |
| Scenario / mock registry | Test-only; never production authority |
| Hardening golden updates | Formal amendment + CI hash refresh |

### 8.5 Allowed evolution paths (summary)

| Path | Requires amendment? |
|------|---------------------|
| Ingestion worker implementation | No (if §8.3 obeyed) |
| Catalog SQL schema (asset columns only) | No |
| Operational metrics on ingest jobs | No |
| New RVE semantic field or enum | **Yes** (§10) |
| Pipeline reorder or adapter in orchestrator | **Yes** (§10) |
| New DGEL exception edge | **Yes** (§10) |
| Unfreeze semantic architecture | **Yes** — executive review + new contract version |

---

## 9. Forbidden Actions

The following are **unconditionally forbidden** under v1.0 without §10 amendment:

### 9.1 Semantic prohibitions

| ID | Forbidden action |
|----|------------------|
| **FORB-1** | Add new `media_state`, `inventory_state`, or `media_failure_mode` wire values |
| **FORB-2** | Add new semantic pipeline layer or reorder frozen stages |
| **FORB-3** | Insert `AssetResolutionAdapter` into `compose_pipeline` |
| **FORB-4** | Let ingestion or catalog mutate RVE or `CompositionPlan` |
| **FORB-5** | Alias `asset_state` to `media_state` |
| **FORB-6** | Embed URL-shaped strings in RVE JSON (NC-105) |

### 9.2 Structural prohibitions

| ID | Forbidden action |
|----|------------------|
| **FORB-7** | Import `asset_resolution` from resolver, CSPP, or media_semantic |
| **FORB-8** | Import `ingestion` from any semantic module |
| **FORB-9** | Import `scenario_feed` / `mock_registry` from production modules |
| **FORB-10** | Import `asset_runtime` in resolver, CSPP, media, compose_pipeline |

### 9.3 Enforcement bypass prohibitions

| ID | Forbidden action |
|----|------------------|
| **FORB-11** | Ship semantic changes without hardening golden/hash update when outputs shift |
| **FORB-12** | Merge when DGEL fails (“fix later”) |
| **FORB-13** | Use `runtime_asset_mode` or other features to bypass DGEL or hardening |
| **FORB-14** | Disable fusion CI stage while claiming architecture compliance |

### 9.4 Authority inversions (always forbidden)

- Ingestion sets `media_intent`
- CSPP reads `asset_state`
- Viewer writes catalog rows
- Scenario drives production resolve

---

## 10. Amendment Protocol

### 10.1 When amendment is required

Any change that would trigger **FORB-*** rules or alter frozen semantic meaning requires a **formal amendment** before implementation merge.

### 10.2 Amendment checklist

| Step | Artifact |
|------|----------|
| 1 | Written amendment proposal (scope, risk, rollback) |
| 2 | Version bump of **this contract** (`v1.0` → `v1.1` or `v2.0`) |
| 3 | Update subordinate docs (1b.7, ASCL, 1c.x as applicable) |
| 4 | Schema / `schema_version` bump if RVE wire changes |
| 5 | DGEL policy update if import graph changes |
| 6 | Hardening golden + hash refresh |
| 7 | CI fusion green on [`scripts/ci-architecture-integrity.sh`](../scripts/ci-architecture-integrity.sh) |
| 8 | Architecture audit sign-off (per 1c.6 / 1c.7 closure process) |

### 10.3 Severity classes

| Class | Example | Contract bump |
|-------|---------|---------------|
| **Patch** | Doc clarification, no behavior change | None |
| **Minor** | New DGEL exception (data-only), new controlled-zone infra | `v1.0.x` doc note |
| **Major** | New RVE field, adapter mapping change | `v1.1` |
| **Breaking** | Pipeline reorder, enum expansion, unfreeze | `v2.0` + executive review |

### 10.4 Post-amendment CI extension

Any amendment that changes outputs **must** extend:

- `system_hardening` snapshots and hash constants
- `test_ci_fusion_consistency` if structural/semantic coupling changes
- `dependency_policy.toml` if edges change

---

## 11. Validation Requirement

### 11.1 Active enforcement systems (documentary confirmation)

| System | Domain | Validates | Does not validate |
|--------|--------|-------------|-------------------|
| **DGEL** | Structural | Import graph, forbidden edges | Enum closure, determinism |
| **System Hardening** | Semantic | Pipeline parity, purity, snapshots, runtime toggle | Import graph (partial: static string scan only) |
| **CI entrypoint** | Operations | Three-stage pipeline; three failure states | Runtime behavior |

### 11.2 Contradiction check (v1.0 audit)

| Check | Result |
|-------|--------|
| Pipeline order in ASCL = compose_pipeline = hardening harness | **Aligned** |
| DGEL forbids adapter in resolver/CSPP/media = ASCL §2 | **Aligned** |
| `asset_state` ∉ RVE = INV-AS-3 = hardening metadata keys | **Aligned** |
| Scenario test-only = DGEL `scenario` isolation = FORB-9 | **Aligned** |
| `runtime_asset_mode` observability = hardening parity tests | **Aligned** |
| CI operational pipeline (DGEL → hardening → fusion) | **Aligned** |
| Authority: semantic > structural > adapter > catalog > ingestion > scenario | **Aligned** with §7 |

**No overlapping authority domains detected** at v1.0 consolidation. DGEL and hardening are **complementary**, not competing: structure vs meaning.

### 11.3 CI validity rule (canonical)

```bash
./scripts/ci-architecture-integrity.sh
```

Exit code `0` = architecture v1.0 compliance for CI purposes. Non-zero = **BLOCKED**.

---

## 12. System State Declaration

### SYSTEM STATE DECLARATION

> **ReelForge architecture is now considered v1.0 COMPLETE AND FROZEN at the semantic layer.**  
> All future work must conform to defined extension zones (§8) or follow the amendment protocol (§10).

| Property | v1.0 state |
|----------|------------|
| Semantic pipeline | **LOCKED** — four stages, fixed order |
| Semantic RVE enums | **LOCKED** — per 1b.7 / ASCL |
| Asset bridge contract | **LOCKED** — adapter mapping; not in pipeline |
| Ingestion model | **LOCKED** (contract); implementation in controlled zone |
| Scenario system | **LOCKED** — test-only forever |
| DGEL | **ACTIVE** |
| System hardening | **ACTIVE** |
| CI operational pipeline | **ACTIVE** (single entrypoint) |
| Semantic expansion | **PROHIBITED** without §10 |

### 12.1 What v1.0 complete means

| Complete | Not required for v1.0 declaration |
|----------|-----------------------------------|
| Semantic architecture defined and frozen | Full ingestion implementation |
| Enforcement trinity (DGEL + hardening + fusion) operational | Production Viewer bind |
| Authority map and boundary docs consolidated here | `asset_catalog` Rust module |
| Regression locks and golden harness in CI | CDN / encoding workers |

### 12.2 Developer obligation

All contributors must:

1. Read this contract before semantic or cross-layer changes.
2. Run `./scripts/ci-architecture-integrity.sh` before merge requests affecting backend architecture.
3. Classify work into §8 zones; if none fit, initiate §10 amendment.
4. Treat any hardening or DGEL failure as **merge-blocking**.

---

## Appendix A — Frozen pipeline quick reference

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
        │                │                    │                      │
     Base RVE      Delivered RVE      + media metadata        CompositionPlan
```

## Appendix B — Document lineage

This contract consolidates Phase **1b.7**, **1c.0–1c.7**, **ASCL**, **DGEL**, **system hardening**, and **CI fusion** without amending their technical content. On conflict between a phase doc and this contract **before amendment**, phase detail governs implementation specifics; this contract governs **system-wide obligations and freeze state**.

---

*End of ReelForge Canonical System Contract v1.0.*
