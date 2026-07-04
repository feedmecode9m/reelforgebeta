# Production Service Boundary Manifest

**Status:** Process-level deployment decomposition (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Maps (does not amend):** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md), [`DEPLOYMENT_TOPOLOGY_RUNTIME_EXECUTION_CONTRACT.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_EXECUTION_CONTRACT.md), [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md), [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md), [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md)

---

## 0. Intent

This document defines **process-level boundaries for production deployment** of ReelForge.

It is strictly:

* a deployment decomposition map
* not an architecture evolution
* not a runtime redesign
* not a semantic extension

No new system behaviors are defined.

---

## 1. System premise (frozen context reference only)

The system executes a deterministic semantic pipeline:

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

All other systems are **supporting, external, or observational**.

---

## 2. Process topology overview

ReelForge production is decomposed into **four process groups**:

```text
┌──────────────────────────────┬────────────────────────────────────────────┐
│ Process Group                │ Responsibility                             │
├──────────────────────────────┼────────────────────────────────────────────┤
│ P1 — Semantic Runtime        │ Deterministic pipeline execution           │
│ P2 — Governance (CI only)    │ DGEL + Hardening + Fusion validation       │
│ P3 — Asset Adapter Bridge    │ Read-only post-compose enrichment          │
│ P4 — External Asset Systems  │ Ingestion / CDN / Encoding (async world)   │
└──────────────────────────────┴────────────────────────────────────────────┘
```

---

## 3. Process boundaries (strict)

### 3.1 P1 — Semantic Runtime Process

**Contains:**

* resolver
* CSPP
* media semantic resolver
* viewer_sim

**Properties:**

* deterministic
* pure execution model (fixed inputs → fixed outputs)
* structured input only (resolve context, profile data per existing contracts)
* no knowledge of asset infrastructure

**Forbidden:**

* asset registry access in orchestrator path
* ingestion awareness in orchestrator path
* runtime asset resolution inside compose stack
* CI interaction in request path
* adapter invocation inside `compose_pipeline`

---

### 3.2 P2 — Governance Process (CI only)

**Contains:**

* DGEL checker (`depgraph-check`, internal `ci-depgraph-check.sh`)
* system hardening suite (`backend/src/system_hardening/`)
* fusion validation (`test_ci_fusion_consistency` via CI entrypoint)

**Authoritative entrypoint:**

```bash
./scripts/ci-architecture-integrity.sh
```

**Properties:**

* non-runtime
* stateless
* fail-fast enforcement layer
* emits only: PASS or `STRUCTURAL_BLOCK` | `SEMANTIC_BLOCK` | `CROSS_LAYER_DRIFT_BLOCK`

**Forbidden:**

* participation in request execution
* modification of runtime state
* influence on `CompositionPlan` or RVE at serve time

---

### 3.3 P3 — Asset Adapter Bridge Process

**Contains:**

* `AssetResolutionAdapter` (read-only mode)
* catalog snapshot reader
* validation helpers (existing adapter types only)

**Properties:**

* post-compose execution only
* non-authoritative over semantic outputs
* deterministic mapping for fixed snapshot + metadata (existing 1c.2 table)

**Rules:**

* **MUST NOT** modify `CompositionPlan`
* **MUST NOT** modify RVE
* **MUST NOT** influence P1 execution ordering or inputs during compose
* **MUST NOT** be invoked between media and `simulate_viewer` in orchestrator

---

### 3.4 P4 — External Asset Systems

**Contains:**

* ingestion system (event-driven)
* CDN / thumbnails / encoding pipeline
* external storage systems
* catalog projection writers (future/non-binding placement)

**Properties:**

* fully asynchronous
* eventually consistent
* non-deterministic by design (relative to a single compose request)

**Rules:**

* **MUST NOT** call into P1, P2, or P3 during compose
* **MUST NOT** influence semantic runtime directly
* **ONLY** produces catalog-side projections consumable by P3 as snapshots

---

## 4. Inter-process communication model

### 4.1 Allowed flows

```text
P4 ──(eventual)──► catalog snapshot ──► P3 (read)
P1 ──► CompositionPlan / RenderTree / RVE ──► client
P1 complete ──► (optional) P3 post-compose bind read
P2 ──► artifact verdict on git SHA (validation only; no IPC to P1 at runtime)
```

| Flow | Binding |
|------|---------|
| P4 → catalog → P3 | Snapshot read only; point-in-time |
| P1 → output | Authoritative compose artifacts |
| P3 after P1 | Optional enrichment trace; no writeback to P1 |
| P2 on merge/deploy | Governance PASS/FAIL; not in request path |

### 4.2 Forbidden flows

| Forbidden | Reason |
|-----------|--------|
| P4 → P1 (direct or indirect) | Ingestion external to pipeline |
| P4 → P2 (runtime influence) | Governance is pre-runtime only |
| P3 → P1 (mutation or compose-time call) | Asset cannot influence semantic evaluation |
| P3 → P1 (reordering pipeline) | Frozen four-stage order |
| P2 → runtime state mutation | CI non-participation |
| P2 → per-request gating inside P1 | Governance not in hot path |
| Any reverse flow from P1 into ingestion commands | Semantic does not drive ingest |

---

## 5. Execution lifecycle (deployment view only)

Request execution is defined as:

1. **P1** executes semantic pipeline (`resolve_base_rve → … → simulate_viewer`)
2. **P1** emits `CompositionPlan`, `RenderTree`, and delivered-with-media RVE
3. **P3** optionally reads catalog snapshot and performs post-output adapter read (no writeback)
4. **P4** operates independently (no request coupling)
5. **P2** validates system correctness out-of-band on revision SHA

No additional steps exist.

```text
  request ──► P1 ──► response (plan + tree + RVE)
                  │
                  └──► (optional) P3 bind trace

  P4 ═══ async ═══► catalog ──► (later) P3 snapshot

  P2 ═══ CI job ═══► PASS | *_BLOCK   (not on request path)
```

---

## 6. Failure domain separation

### 6.1 P2 failures (governance — pre-runtime)

Detected by `./scripts/ci-architecture-integrity.sh` only:

| Classification | Process | Deploy gate |
|----------------|---------|-------------|
| `STRUCTURAL_BLOCK` | P2 (DGEL stage) | Not deployable |
| `SEMANTIC_BLOCK` | P2 (hardening stage) | Not deployable |
| `CROSS_LAYER_DRIFT_BLOCK` | P2 (fusion stage) | Not deployable |

These classifications are **not** P1 request-time error codes.

### 6.2 P1 failures (semantic runtime — request path)

| Condition | Effect |
|-----------|--------|
| Orchestrator error / contract validation failure | Request fails; no P3 authority to repair semantics |
| Nondeterministic output on fixed input | Defect; must fail P2 hardening on next CI run |

P1 failures **do not** add new taxonomy beyond existing runtime errors and CI blocks above.

### 6.3 P3 failures (adapter bridge)

| Condition | Effect |
|-----------|--------|
| Adapter unavailable | **Degraded enrichment only** |
| Stale/missing snapshot | **Degraded enrichment only** (existing mapping table) |
| **MUST NOT** fail P1 compose success | Isolation rule |

### 6.4 P4 failures (external systems)

| Condition | Effect |
|-----------|--------|
| Ingestion delay | Eventual catalog drift |
| Catalog inconsistency | P3 bind degradation |
| Asset missing | P3 mapping to existing placeholder/fallback classes only |
| **MUST NOT** block P1 | Always degrade via snapshot at P3; never block compose |

### 6.5 P2 vs runtime separation

| Layer | When evaluated | Runtime impact |
|-------|----------------|----------------|
| P2 governance | CI / pre-deploy | Blocks deploy when `*_BLOCK` |
| P3 degradation | Optional post-compose | None on `CompositionPlan` |
| P4 async failure | Background | None on P1 for fixed compose inputs |

---

## 7. Deployment mapping

### 7.1 Single-node deployment

All processes may co-locate physically:

| Process | Placement |
|---------|-----------|
| P1 | Same binary / host |
| P3 | Same binary (optional call) or same host |
| P2 | Host CI or pipeline runner |
| P4 | External or mocked |

Logical boundaries in §3 remain mandatory regardless of co-location.

### 7.2 Standard production deployment (recommended)

| Process | Placement |
|---------|-----------|
| P1 | Stateless runtime service (API) |
| P2 | CI pipeline only (external to runtime fleet) |
| P3 | Sidecar service or library boundary post-compose |
| P4 | Fully external infrastructure |

### 7.3 Distributed deployment (future, non-binding)

| Process | Placement |
|---------|-----------|
| P1 | Horizontally scaled replicas |
| P3 | Cache-backed snapshot readers |
| P4 | Multi-region asset system |
| P2 | CI-only ephemeral runners |

Frozen pipeline order and CI entrypoint are unchanged in all shapes.

---

## 8. Determinism guarantee

| Process | Determinism role |
|---------|------------------|
| **P1** | **Sole** source of deterministic system output (`CompositionPlan`, `RenderTree`, frozen `metadata.media_*`) |
| **P3** | Read-only and replay-safe for fixed snapshot + metadata |
| **P4** | Explicitly non-deterministic relative to compose instant |
| **P2** | Enforces determinism proofs; does not participate in output |

---

## 9. System invariance statement

No process boundary defined here is allowed to:

* modify semantic contracts
* introduce new lifecycle states
* redefine pipeline order
* alter CI governance logic or taxonomy
* introduce new partitions or failure classes

---

## 10. Final declaration

> **This document defines process-level deployment decomposition only and does not modify or extend the frozen semantic, asset, or governance contracts.**

---

## References

| Document | Role |
|----------|------|
| [`DEPLOYMENT_TOPOLOGY_RUNTIME_EXECUTION_CONTRACT.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_EXECUTION_CONTRACT.md) | Execution placement mapping |
| [`DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md`](./DEPLOYMENT_TOPOLOGY_RUNTIME_PARTITION_MODEL.md) | Partition topology |
| [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) | P2 failure taxonomy |
| [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md) | Deploy eligibility |

---

*End of Production Service Boundary Manifest v1.0.*
