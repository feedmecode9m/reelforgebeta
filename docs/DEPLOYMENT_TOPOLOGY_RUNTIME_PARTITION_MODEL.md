# Deployment Topology & Runtime Partition Model

**Status:** Normative deployment topology (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Authority:** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md), [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md), [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md)

**Explicit non-goals:** Code, CI scripts, pipelines, contracts, schema, new systems, layers, or semantic concepts.

**Purpose:** Define **where** ReelForge components run in real deployments—runtime partitions, service boundaries, and allowed data flows—without describing internal module logic. Preserves the frozen semantic pipeline and existing CI governance model.

---

## Table of Contents

1. [System Deployment Overview](#1-system-deployment-overview)
2. [Core Runtime Partitions](#2-core-runtime-partitions)
3. [Boundary Rules](#3-boundary-rules)
4. [Data Flow Topology](#4-data-flow-topology)
5. [Failure Isolation Model](#5-failure-isolation-model)
6. [Deployment Shapes](#6-deployment-shapes)
7. [Scaling Principles](#7-scaling-principles)
8. [Observability Boundaries](#8-observability-boundaries)
9. [Final Declaration](#9-final-declaration)

---

## 1. System Deployment Overview

### 1.1 Partitions, not modules

ReelForge is deployed as **runtime partitions**—coarse isolation boundaries with distinct authority, scaling, and failure domains. Rust modules (`experience/`, `media/`, `asset_resolution/`, etc.) **map into** partitions; they do not define partitions themselves.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         REELFORGE DEPLOYMENT                            │
├──────────────────────────────┬──────────────────────────────────────────┤
│  SEMANTIC RUNTIME            │  ASSET-ADJACENT (non-semantic)            │
│  (authoritative experience)  │  (read-only enrichment)                  │
├──────────────────────────────┴──────────────────────────────────────────┤
│  CI & GOVERNANCE (pre-runtime only — never in request path)             │
├─────────────────────────────────────────────────────────────────────────┤
│  EXTERNAL / DEFERRED (ingest, CDN, thumbs, encoding — optional)         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Semantic vs asset vs governance

| Partition class | Runs in production request path? | Authority |
|-----------------|----------------------------------|-----------|
| **Semantic runtime** | **Yes** — primary user-facing path | RVE + `CompositionPlan` truth |
| **Asset-adjacent** | **Optional** — bind/read path only | Catalog snapshot at read time; non-authoritative over semantics |
| **CI & governance** | **No** — build/merge/deploy gate only | Architecture proof; zero runtime truth |
| **External / deferred** | **Async / optional** — never inside orchestrator | Bytes, jobs, delivery; eventual consistency |

### 1.3 Alignment with minimal slice and readiness

| Document | Topology role |
|----------|-----------------|
| [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md) | LEVEL 0–1 = semantic partition (+ optional asset-adjacent bind) |
| [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md) | Deploy eligibility when CI governance partition PASS on SHA |
| [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) | Governance partition execution model |
| [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) | Frozen rules all partitions must obey |

---

## 2. Core Runtime Partitions

### A. Semantic Runtime Partition

**Role:** Deterministic experience composition—the **only** partition that may produce authoritative `CompositionPlan`, `RenderTree`, and delivered RVE semantics.

| Deployed capability | Source modules (reference) | In frozen orchestrator? |
|--------------------|----------------------------|-------------------------|
| Resolver | `experience/experience_resolve`, loaders, contract | Stage 1 |
| CSPP | `experience/cspp/` | Stage 2 |
| Media semantic resolver | `media/` (`apply_media_semantic_stub` path) | Stage 3 |
| Viewer simulation | `viewer_sim/` | Stage 4 |

**Orchestrator wiring (single process or service):**

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

| Property | Requirement |
|----------|-------------|
| Determinism | Same inputs → same outputs (canonical DET-*) |
| Purity | No await on ingest; no catalog mutation during run |
| Isolation | No imports from ingestion, scenario_feed, or asset_runtime in frozen path (DGEL) |

**Typical deployment unit:** `backend` API service handling `GET /api/experience/resolve` (or equivalent harness entry).

**Outputs leaving partition:** `base_rve`, `delivered_rve`, `delivered_with_media`, `composition_plan` (includes `render_tree`).

---

### B. CI & Governance Partition

**Role:** Pre-runtime validation—proves structural and semantic architecture before an artifact is considered deployable.

| Component | Implementation reference | Runtime? |
|-----------|-------------------------|----------|
| DGEL checker | `depgraph-check`, `ci-depgraph-check.sh` (internal) | **No** |
| System hardening suite | `backend/src/system_hardening/` | **No** |
| Fusion validation | `test_ci_fusion_consistency` via CI entrypoint | **No** |

**Authoritative entrypoint (only):**

```bash
./scripts/ci-architecture-integrity.sh
```

| Stage | Partition activity |
|-------|-------------------|
| 1 — DGEL | Structural graph check |
| 2 — System Hardening | Semantic invariant tests |
| 3 — Fusion Validation | Cross-layer consistency |

**Deployment unit:** Ephemeral CI runner, pre-push hook, or merge pipeline job—**never** co-located as a dependency of live resolve requests.

| Rule | Source |
|------|--------|
| Governance does not serve traffic | CI_OPERATIONAL_MODEL CI-OP-3 |
| No new enforcement surfaces | Canonical §6.4 |
| PASS required for production readiness | PRODUCTION_READINESS_BOUNDARY §5 |

---

### C. Asset-Adjacent Partition (Non-Semantic)

**Role:** Read-only catalog reconciliation and bind enrichment—**adjacent** to semantic runtime, **not inside** the orchestrator.

| Deployed capability | Source modules (reference) | Authority |
|--------------------|----------------------------|-----------|
| Asset adapter | `asset_resolution/adapter.rs` | Bind mapping only |
| Catalog snapshot reader | Fixtures, DB read, in-memory registry | Point-in-time catalog view |
| Read-only enrichment | `AdapterResult`, `SemanticMediaBinding` | Supplements display; does not override `CompositionPlan` |

| Property | Requirement |
|----------|-------------|
| Invocation | **After** semantic outputs exist (LEVEL 1 minimal slice) |
| Input | `MetadataSnapshot` + catalog snapshot + optional `media_reference` |
| Forbidden | Calling resolver, CSPP, media, or viewer stages; mutating RVE in orchestrator path |
| Determinism | Fixed snapshot + metadata → fixed adapter result |

**Typical deployment unit:** Same host as API (in-process call) **or** separate lightweight “bind” service—topology choice must preserve **logical isolation** (§3).

**Not included:** `scenario_feed`, `mock_registry` (test-only), `runtime_asset_mode` registry (observability; non-authoritative per hardening).

---

### D. External / Deferred Partition

**Role:** Mutable infrastructure and byte delivery—**explicitly outside** semantic runtime and minimal production slice.

| System | Nature | Consistency |
|--------|--------|-------------|
| Ingestion pipeline | Async jobs | Eventual |
| CDN | Delivery handles | External |
| Thumbnails | Asset generation | External |
| Encoding / transcoding | Derived assets | External |
| Catalog projector (future) | `asset_state` persistence | Eventual → snapshot at read |

| Rule | Source |
|------|--------|
| Must not call semantic orchestrator | DGEL forbidden edges |
| Must not write RVE or `CompositionPlan` | Canonical INV-ING-* |
| May feed catalog snapshots only | 1c.5 handoff model |

**Deployment unit:** Separate workers, queues, object stores, CDNs—physically and logically distinct from semantic API service.

---

## 3. Boundary Rules

### 3.1 Semantic runtime

| ID | Rule |
|----|------|
| **TOPO-S1** | Semantic partition must be **pure and deterministic** for fixed inputs (profile, context, harness base). |
| **TOPO-S2** | No network calls to ingest, CDN, or mutable catalog **during** orchestrator execution. |
| **TOPO-S3** | No adapter, scenario, or ingestion code in the orchestrator call stack. |
| **TOPO-S4** | Semantic partition is the **sole** source of `CompositionPlan` / `RenderTree` authority. |

### 3.2 Asset-adjacent partition

| ID | Rule |
|----|------|
| **TOPO-A1** | Asset partition **cannot influence semantic evaluation** (orchestrator inputs/outputs immutable by adapter). |
| **TOPO-A2** | Catalog reads are **snapshots**—point-in-time, not live streaming truth during compose. |
| **TOPO-A3** | Adapter failure must not fail resolve/composition (degraded enrichment only — §5). |
| **TOPO-A4** | `runtime_asset_mode` enrichment, if enabled, remains observability-only (hardening parity). |

### 3.3 CI & governance partition

| ID | Rule |
|----|------|
| **TOPO-G1** | Governance partition **must not participate in runtime execution** (no CI hooks in request path). |
| **TOPO-G2** | CI PASS is a **deploy gate**, not a runtime feature flag. |
| **TOPO-G3** | Only `./scripts/ci-architecture-integrity.sh` confers governance PASS in CI context. |

### 3.4 External / deferred partition

| ID | Rule |
|----|------|
| **TOPO-E1** | Ingestion is **asynchronous**; semantic path must not await completion. |
| **TOPO-E2** | Consistency with semantics is **external only**—via catalog snapshot at adapter read. |
| **TOPO-E3** | Ingest/CDN/thumb/encode failures do not change frozen enum meaning in RVE. |

### 3.5 Cross-partition summary

```text
  Governance ──X──► Runtime request path
  External     ──X──► Orchestrator (direct)
  Asset        ──X──► Semantic inputs during compose
  Semantic     ──X──► Ingest writes / catalog mutation
```

---

## 4. Data Flow Topology

### 4.1 Allowed flows

```text
                    ┌─────────────────────────┐
  resolve context ─►│  SEMANTIC RUNTIME       │
                    │  resolver→CSPP→media→   │
                    │  viewer_sim             │
                    └───────────┬─────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
    CompositionPlan      RenderTree         delivered_with_media
    (primary output)       (embedded)         (RVE + metadata)


    catalog snapshot ──► ┌─────────────────────────┐
    (point-in-time)      │  ASSET-ADJACENT         │
    metadata snapshot ──►│  adapter (read-only)    │
                         └───────────┬─────────────┘
                                     ▼
                         bind enrichment (AdapterResult)
                                     │
                                     ▼
                         viewer bind / display layer (client)
                         (does not replace CompositionPlan)


    upload / transcode ──► ┌─────────────────────────┐
                           │  EXTERNAL / DEFERRED    │
                           │  ingestion → catalog    │
                           └───────────┬─────────────┘
                                       │
                                       ▼ (eventual)
                           catalog snapshot ──► asset-adjacent only
```

| Flow | Direction | Allowed |
|------|-----------|---------|
| Semantic runtime → outputs | Forward | **Yes** — `CompositionPlan`, `RenderTree`, RVE |
| Asset partition → adapter enrichment → viewer bind | Forward (read-only) | **Yes** — after semantic outputs; client-side or adjacent service |
| Ingestion → catalog → adapter | Forward (eventual) | **Yes** — snapshot read only; no semantic callback |
| CI governance → artifact verdict | Forward (pre-deploy) | **Yes** — exit code / classification only |

### 4.2 Forbidden reverse flows

| Forbidden flow | Violation |
|----------------|-----------|
| Ingestion → resolver / CSPP / media / viewer | Pipeline coupling |
| Catalog → semantic orchestrator (live mutation) | Nondeterminism / authority inversion |
| Adapter → mutate `CompositionPlan` or RVE mid-compose | Asset influences semantics |
| CDN → write URLs into RVE | NC-105 |
| Scenario → production resolve path | Test-only authority |
| CI → inline runtime gate per request | Governance in hot path |
| Semantic → push `asset_state` into RVE | Catalog column leak |

```text
 FORBIDDEN (topology)
 ═══════════════════════════════════════════════════

 ingestion ──X──► semantic runtime
 catalog     ──X──► orchestrator (live)
 adapter     ──X──► CSPP / resolver / media / viewer (during compose)
 semantic    ──X──► ingestion commands
 CI          ──X──► request-serving path
```

---

## 5. Failure Isolation Model

Failures are **partition-scoped**. A failure in one partition must not collapse authority in another.

| Failure domain | Partition | User/system impact | Production readiness |
|----------------|-----------|----------------------|------------------------|
| **Semantic runtime failure** | A | Wrong or missing `CompositionPlan` / RVE | **CI block** (`SEMANTIC_BLOCK` or harness divergence) — **not deployable** |
| **DGEL / structural violation** | B (governance) | Architecture unsafe | **CI block** (`STRUCTURAL_BLOCK`) — **not deployable** |
| **Cross-layer drift** | B (governance) | Structure/semantic disagree | **CI block** (`CROSS_LAYER_DRIFT_BLOCK`) — **not deployable** |
| **Asset partition failure** | C | Bind enrichment missing or default | **Degraded enrichment only** — semantic outputs unchanged; deployable if CI PASS |
| **Catalog snapshot stale** | C | Adapter maps to placeholder/fallback `media_state` | **Degraded bind** — no orchestrator change |
| **Ingestion failure** | D | Bytes delayed; catalog snapshot ages | **Eventual consistency drift** — **no semantic impact** on fixed compose inputs |
| **CDN / thumb / encode failure** | D | Delivery handles absent | **No semantic impact** — LEVEL 2 concern |

### 5.1 Failure decision matrix

| Symptom | Partition | Action |
|---------|-----------|--------|
| Resolve returns nondeterministic plan | A | Block deploy; fix semantic partition |
| `depgraph-check` fails | B | Block deploy; fix imports |
| Hardening golden drift | B | Block deploy; restore parity or amend contract |
| Adapter timeout | C | Serve composition; omit or default bind |
| Ingest job FAILED | D | Retry ingest; semantic API unchanged |
| CI runner OOM | B | Retry CI; no production traffic impact |

### 5.2 Mapping to CI classifications

| CI classification | Topology interpretation |
|-------------------|-------------------------|
| `STRUCTURAL_BLOCK` | Partition A code may run, but **revision not deployable** — graph illegal |
| `SEMANTIC_BLOCK` | Partition A behavior regressed — **not deployable** |
| `CROSS_LAYER_DRIFT_BLOCK` | Partitions A vs B proof disagree — **not deployable** |
| PASS (none) | Partitions A–D may deploy per minimal slice level; CI does not require D |

---

## 6. Deployment Shapes

Semantic runtime **logical isolation** is mandatory in every shape. Physical co-location is permitted; **authority mixing** is not.

### 6.1 Single-node (development)

```text
┌──────────────────────────────────────────────┐
│  host (dev)                                  │
│  ┌────────────────────────────────────────┐  │
│  │ backend: semantic runtime (A)        │  │
│  │ optional in-process adapter calls (C)│  │
│  └────────────────────────────────────────┘  │
│  CI: local ./scripts/ci-architecture-integrity.sh (B) │
│  external: mocked or absent (D)              │
└──────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| Use | Local dev, harness, integration tests |
| Risk | Process co-location — must still respect TOPO-* rules in code paths |
| CI | Same entrypoint as production governance |

### 6.2 Separated services (recommended production minimum)

```text
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ semantic-api    │     │ bind-service    │     │ ingest-workers  │
│ partition A     │     │ partition C     │     │ partition D     │
│                 │     │                 │     │                 │
│ orchestrator    │────►│ adapter read    │     │ async jobs      │
│ only            │ JSON│ catalog snapshot│◄────│ catalog write   │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
    CompositionPlan → CDN / client (D for bytes only)


┌─────────────────┐
│ ci-runner       │  partition B — on merge/tag only
└─────────────────┘
```

| Service | Partition | Request path |
|---------|-----------|--------------|
| `semantic-api` | A | **Yes** — resolve / compose |
| `bind-service` | C | Optional — post-compose bind |
| `ingest-workers` | D | **No** — async only |
| `ci-runner` | B | **No** |

### 6.3 Fully distributed (future)

```text
 semantic-api (horizontally scaled, stateless)
 bind-service (scaled on snapshot read load)
 catalog-service (partition D storage — eventual)
 ingest / encode / thumb / CDN workers (partition D)
 CI fleet (partition B — ephemeral)
```

| Constraint (unchanged) | Reason |
|------------------------|--------|
| Semantic pods remain stateless deterministic | TOPO-S1 |
| No ingest subscriber inside semantic pod | TOPO-E1 |
| Catalog changes propagate only via snapshots to C | TOPO-A2 |
| CI never fronted as load balancer | TOPO-G1 |

**Future topology does not relax frozen pipeline or CI model.**

---

## 7. Scaling Principles

### 7.1 Semantic runtime partition (A)

| Principle | Detail |
|-----------|--------|
| **Deterministic scale-out** | Horizontally scale **identical** replicas; no shared mutable compose state |
| **Input-driven** | Scale on resolve QPS, episode/profile cardinality |
| **Cache policy** | Only deterministic caches keyed by full resolve inputs; no catalog live views in cache key |
| **Avoid** | Co-scheduling ingest workers in same pool as semantic API |

### 7.2 Asset-adjacent partition (C)

| Principle | Detail |
|-----------|--------|
| **Independent scaling** | Scale on bind QPS separately from compose QPS |
| **Snapshot locality** | Prefer snapshot version pinned per request |
| **Failure isolation** | Timeouts here must not propagate as compose 5xx unless product chooses hard dependency (discouraged) |

### 7.3 External / deferred partition (D)

| Principle | Detail |
|-----------|--------|
| **Async scale** | Queue-based workers; bursty ingest/transcode |
| **No semantic coupling** | Scale without redeploying semantic-api |
| **Eventual projection** | Catalog freshness is operational SLO, not compose SLO |

### 7.4 CI & governance partition (B)

| Principle | Detail |
|-----------|--------|
| **Stateless & ephemeral** | Runners created per job; no production data |
| **Not scaled with traffic** | Scales with merge velocity / parallel PRs |
| **Single entrypoint per job** | `ci-architecture-integrity.sh` only |

---

## 8. Observability Boundaries

Each partition exposes **different** observability contracts. Do not treat all logs/metrics as one “ReelForge” stream without partition labels.

### 8.1 Semantic runtime (A)

| Exposes | Does not expose |
|---------|-----------------|
| Deterministic trace IDs per resolve (episode, profile, schema_version) | Ingest job IDs as compose dependencies |
| Stage timings: resolver, CSPP, media, viewer | CDN fetch latency inside orchestrator |
| `CompositionPlan` hash / revision fingerprint | Raw catalog rows |
| CSPP collision outcomes | `asset_state` |

**Log character:** reproducible — same inputs should produce same trace classification on replay.

### 8.2 Asset-adjacent (C)

| Exposes | Does not expose |
|---------|-----------------|
| Snapshot version / read timestamp | Semantic stage internals |
| Adapter mapping outcome (`AdapterResult`) | Orchestrator mutation (must be empty) |
| `media_reference` resolution path | Scenario replay labels |

**Log character:** eventual consistency — snapshot age, stale read warnings.

### 8.3 External / deferred (D)

| Exposes | Does not expose |
|---------|-----------------|
| `ingestion_state`, job retries, transcode progress | RVE field changes |
| CDN cache hit/miss, encode profiles | `CompositionPlan` contents |
| `asset_state` transitions | `media_intent` inference |

**Log character:** async pipeline — lag, backlog, failure recovery.

### 8.4 CI & governance (B)

| Exposes | Does not expose |
|---------|-----------------|
| Stage PASS/FAIL, classification (`*_BLOCK` or none) | Production user traffic |
| `depgraph-check` violation edges | Runtime adapter traces |
| Hardening test failure names | Customer PII |

**Log character:** validation only — tied to git SHA, not episode ID.

### 8.5 Cross-partition correlation

| Allowed correlation key | Use |
|-------------------------|-----|
| `git_sha` / deploy version | Link CI PASS to running semantic-api |
| `episode_id` | Semantic + bind + (optional) ingest — **never** rewrite compose from ingest events |
| `snapshot_version` | Asset-adjacent + catalog only |

---

## 9. Final Declaration

### DEPLOYMENT TOPOLOGY DECLARATION

> **ReelForge is a partitioned deterministic system where correctness is enforced**  
> **in CI and execution purity is guaranteed in the semantic runtime partition,**  
> **while asset and ingestion systems remain externally consistent and non-authoritative.**

### 9.1 Partition obligations (summary)

| Partition | Runs at request time? | Authoritative for experience? |
|-----------|----------------------|------------------------------|
| A — Semantic runtime | Yes | **Yes** |
| B — CI & governance | No | No (proof only) |
| C — Asset-adjacent | Optional | No (bind enrichment only) |
| D — External / deferred | Async | No |

### 9.2 Deployability reminder

| Condition | Meaning |
|-----------|---------|
| CI operational model PASS | Revision **production-ready** ([`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md)) |
| LEVEL 0 minimal slice | Deploy partition A only |
| LEVEL 1 minimal slice | Deploy A + optional C |
| LEVEL 2 infrastructure | Add D; topology expands; **A isolation unchanged** |

### 9.3 References

| Document | Role |
|----------|------|
| [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) | Frozen pipeline and zones |
| [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) | Governance partition |
| [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md) | When deploy is allowed |
| [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md) | Smallest runtime surface per partition |

---

*End of Deployment Topology & Runtime Partition Model v1.0.*
