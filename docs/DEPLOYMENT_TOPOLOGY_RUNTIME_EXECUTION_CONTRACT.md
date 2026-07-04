# Deployment Topology & Runtime Execution Contract

**Status:** Deployment mapping specification (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Maps (does not amend):** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md), [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md), [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md), [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md)

**Explicit exclusions:** Code, CI, schema, Rust modules, new runtime logic, new semantic concepts, new partitions, new failure taxonomies, new invariants, contract reinterpretation.

---

## 1. Partition mapping (existing only)

ReelForge deploys into **four partitions** already defined in [`DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md). This contract assigns **execution placement** only.

| Partition | Existing components (reference) | Deployment mapping role |
|-----------|--------------------------------|-------------------------|
| **Semantic Runtime** | resolver → CSPP → media semantic → viewer_sim | Request-serving compose path |
| **CI / Governance** | DGEL, system hardening, fusion validation | Pre-deploy gate only |
| **Asset-adjacent** | adapter, catalog snapshot reader | Optional post-compose read |
| **External** | ingestion, CDN, thumbnails, encoding | Async; non-request-path |

No additional partitions are defined by this document.

---

## 2. Execution topology (placement, not orchestration)

### 2.1 Placement modes

| Mode | Semantic Runtime | Asset-adjacent | CI / Governance | External |
|------|------------------|----------------|-----------------|----------|
| **In-process (single binary)** | Same process as API | Optional same-process call | Not in binary hot path | Not in binary hot path |
| **Sidecar (optional)** | Primary container | Adjacent container; RPC optional | Not in sidecar request path | Not in sidecar |
| **External service (future-only, non-binding)** | Dedicated `semantic-api` replicas | Dedicated bind reader service | Ephemeral CI runners | Worker pools / CDN |

Placement choices **do not** alter the frozen pipeline order or introduce orchestration beyond `compose_pipeline` as already wired.

### 2.2 What this document does not specify

| Out of scope | Reason |
|--------------|--------|
| Service mesh rules | Infrastructure choice |
| Load balancer algorithms | Infrastructure choice |
| Container images / K8s manifests | Implementation |
| New control flow between stages | Frozen in canonical contract §2 |

---

## 3. Request lifecycle (existing pipeline only)

### 3.1 Mandatory lifecycle (in-process or service-equivalent)

For each resolve/compose request, the **Semantic Runtime partition** executes exactly:

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

| Step | Existing owner | Output (existing) |
|------|----------------|-------------------|
| 1 | resolver | Base RVE |
| 2 | CSPP | Delivered RVE |
| 3 | media semantic | Delivered with media (`metadata.media_*` per frozen enums) |
| 4 | viewer_sim | `CompositionPlan` (includes `RenderTree`) |

### 3.2 Optional post-compose step (asset-adjacent only)

After step 4 completes:

```text
(optional) catalog snapshot read → adapter resolve (read-only) → bind enrichment trace
```

| Rule | Source (reference only) |
|------|-------------------------|
| Adapter is **post-compose only** | ASCL §2, MINIMAL_PRODUCTION_SLICE §2.2 |
| Adapter **must not** mutate `CompositionPlan` or RVE | ASCL §6, hardening parity tests |
| Pipeline **must not** be reordered | Canonical contract §2 |

### 3.3 Lifecycle diagram (deployment view)

```text
  HTTP / harness request
           │
           ▼
  ┌────────────────────────────┐
  │ Semantic Runtime partition │
  │  resolve → CSPP → media   │
  │  → viewer_sim              │
  └─────────────┬──────────────┘
                │ CompositionPlan, RenderTree, RVE JSON
                ▼
         client / Studio response
                │
                │ (optional, same or separate placement)
                ▼
  ┌────────────────────────────┐
  │ Asset-adjacent partition │
  │  snapshot → adapter read │
  └────────────────────────────┘
```

External partition processes **do not** appear in this lifecycle.

---

## 4. Failure domains (existing classes only)

### 4.1 Governance failures (pre-runtime)

Detected only by `./scripts/ci-architecture-integrity.sh` per [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md):

| Classification | Partition | Deployability ([`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md)) |
|----------------|-----------|----------------------------------------------------------------------------------------|
| `STRUCTURAL_BLOCK` | CI / Governance (DGEL stage) | Not deployable |
| `SEMANTIC_BLOCK` | CI / Governance (hardening stage) | Not deployable |
| `CROSS_LAYER_DRIFT_BLOCK` | CI / Governance (fusion stage) | Not deployable |
| *(none — PASS)* | All governance stages | Deployable per readiness boundary |

No additional CI failure categories are defined here.

### 4.2 Runtime degradation (asset-adjacent only)

| Condition | Semantic outputs | Classification |
|-----------|------------------|----------------|
| Adapter unavailable | Unchanged `CompositionPlan`, `RenderTree`, RVE | **Runtime degradation** (asset layer only) |
| Stale catalog snapshot | Unchanged compose artifacts; bind mapping per existing adapter table | **Runtime degradation** (asset layer only) |
| Ingest/CDN/thumb/encode failure | Unchanged compose artifacts | **Runtime degradation** (external partition only) |

Runtime degradation **does not** introduce new semantic failure states, `media_state` values, or `asset_state` values.

### 4.3 Semantic runtime failure at request time

| Condition | Effect |
|-----------|--------|
| Orchestrator error / invalid RVE | Request fails; no adapter authority to repair semantics |
| Nondeterministic output on fixed input | Architecture defect; must surface as `SEMANTIC_BLOCK` on next CI run |

---

## 5. Deployment shapes (restricted set)

### 5.1 Single-node (dev / baseline)

| Partition | Placement |
|-----------|-----------|
| Semantic Runtime | One `backend` process |
| Asset-adjacent | Optional in-process function call after compose |
| CI / Governance | Host or CI runner; `ci-architecture-integrity.sh` |
| External | Absent or mocked |

### 5.2 Separated-process (recommended production)

| Partition | Placement |
|-----------|-----------|
| Semantic Runtime | One or more API replicas (stateless) |
| Asset-adjacent | Same host or separate bind endpoint |
| CI / Governance | Merge/tag pipeline only |
| External | Separate workers; no callback into orchestrator |

### 5.3 Fully distributed (future, non-binding)

| Partition | Placement |
|-----------|-----------|
| Semantic Runtime | Horizontally scaled dedicated service |
| Asset-adjacent | Independent bind readers |
| CI / Governance | Ephemeral fleet |
| External | Queue workers, object store, CDN |

This shape is **non-binding** for current releases. Frozen pipeline order and CI entrypoint remain unchanged regardless of shape.

---

## 6. Semantic freeze rule (declarative restatement)

The following statements **map deployment behavior** to existing frozen contracts. They do **not** amend those contracts.

| Rule | Deployment meaning |
|------|-------------------|
| Semantic runtime is immutable and deterministic | Replicas must not share mutable compose state; inputs fully determine outputs |
| Asset layer cannot influence semantic evaluation | Asset-adjacent code is not on the orchestrator stack |
| CI is non-runtime governance only | No CI hook in resolve request path |
| Ingestion is external and eventually consistent | Catalog visible to adapter via snapshot only, not live pipeline input |
| Adapter is read-only and post-hoc only | Invoked after `simulate_viewer`; no RVE/`CompositionPlan` writeback |

**Reference anchors (unchanged):** Canonical contract §2, §7, §8; ASCL §2; CI_OPERATIONAL_MODEL §1.

---

## 7. Observability mapping (strict limitation)

Observability **labels** map to existing artifacts only. No new telemetry semantics.

### 7.1 Semantic Runtime partition

| Observable (existing) | Trace association |
|----------------------|-------------------|
| `CompositionPlan` | Per resolve request |
| `RenderTree` | Embedded in plan |
| `media_state` | `metadata` on delivered-with-media RVE |
| `campaigns[]` / `slots[]` | Delivered RVE after CSPP |
| Stage latency (resolver, CSPP, media, viewer_sim) | Partition A span only |

### 7.2 Asset-adjacent partition (optional)

| Observable (existing) | Trace association |
|----------------------|-------------------|
| Adapter enrichment result | Optional span after compose |
| Catalog snapshot identifier / read time | Bind span only |

### 7.3 CI / Governance partition

| Observable (existing) | Trace association |
|----------------------|-------------------|
| Governance stage PASS/FAIL | CI job log |
| `STRUCTURAL_BLOCK` / `SEMANTIC_BLOCK` / `CROSS_LAYER_DRIFT_BLOCK` | CI job exit classification |

### 7.4 Explicitly excluded from new observability semantics

| Not introduced here |
|---------------------|
| New metric names for ingest/retry semantics |
| New log levels for “truth” arbitration |
| New correlation IDs that merge CI into runtime authority |
| New health checks that mutate compose behavior |

---

## 8. Forbidden content (this document)

This contract **must not** be read as doing any of the following:

| Forbidden interpretation |
|--------------------------|
| New lifecycle models beyond §3 |
| New “truth layers” or authority reordering |
| Redefinition of `media_state`, `asset_state`, ingestion states, adapter, CSPP, resolver, or viewer_sim |
| Pipeline stage refactor or reorder proposals |
| New abstraction layers or partitions |
| CI model or governance expansion |
| New asset or ingestion semantics |
| Architecture proposal or forward system design |

---

## 9. Cross-reference index (mapping only)

| Question | Answer location |
|----------|-----------------|
| What partitions exist? | §1; PARTITION_MODEL |
| Where does CI run? | §2.1 CI row; CI_OPERATIONAL_MODEL |
| When is deploy allowed? | §4.1; PRODUCTION_READINESS_BOUNDARY |
| Minimal product surface? | §3; MINIMAL_PRODUCTION_SLICE |
| Allowed data flows? | PARTITION_MODEL §4 |

---

## 10. Intent statement

> **This document defines deployment topology mapping only and does not modify or extend the frozen semantic, asset, or governance contracts.**

---

*End of Deployment Topology & Runtime Execution Contract v1.0.*
