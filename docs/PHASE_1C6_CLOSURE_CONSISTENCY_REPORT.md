# Phase 1c.6 — Architecture Closure Consistency Report

**Date:** 2026-06-03  
**Phase:** 1c.6 — Cross-layer consistency audit (read-only)  
**Status:** Closure review — no implementation authorized  
**Project:** ReelForge / Smart Production Studio

**Reviewed (read-only):**

| Category | Artifacts |
|----------|-----------|
| 1b contracts | [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md), [`VIEWER_COMPOSITION_CONTRACT.md`](./VIEWER_COMPOSITION_CONTRACT.md), [`CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md`](./CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md), [`END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md`](./END_TO_END_RVE_COMPOSITION_VALIDATION_HARNESS.md) |
| 1c contracts | [`PHASE_1C_BOUNDARY.md`](./PHASE_1C_BOUNDARY.md), [`PHASE_1C1_ASSET_INVENTORY_MODEL.md`](./PHASE_1C1_ASSET_INVENTORY_MODEL.md), [`PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md`](./PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md), [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) |
| 1b implementation | `backend/src/experience/experience_resolve.rs`, `backend/src/experience/cspp/`, `backend/src/media/`, `backend/src/viewer_sim/`, `backend/src/experience/compose_pipeline.rs` |
| 1c implementation | `backend/src/asset_resolution/` (adapter, types; test-only scenario/mock) |
| Tests | `backend/src/experience/pipeline_integration_tests.rs`, `asset_resolution/*` tests (66 lib tests at audit time) |

**No changes made:** Rust, schema, API, pipeline, migrations, or normative enum sets.

**Companion authority map:** [`SYSTEM_SEMANTIC_AUTHORITY_MAP.md`](./SYSTEM_SEMANTIC_AUTHORITY_MAP.md)

---

## 1. Executive Summary

### 1.1 System stability classification

| Dimension | Classification | Notes |
|-----------|----------------|-------|
| **Semantic pipeline (1b)** | **STABLE** | Frozen four-stage order; 51+ contract-lock tests; resolver/CSPP/media/viewer boundaries observed in code |
| **Asset bridge (1c.2–1c.3)** | **STABLE** | Adapter pure, not in `compose_pipeline`; mapping matches 1c.2 §5.1 |
| **Scenario simulation (1c.4)** | **STABLE** | `#[cfg(test)]` modules; no production import path |
| **Ingestion (1c.5)** | **STABLE (contract-only)** | Normative model defined; zero runtime |
| **Cross-doc semantics** | **STABLE WITH CONDITIONS** | Five registered contradiction classes (CL-01–CL-05); all have documented resolutions or deferrals |
| **Production asset path** | **NOT CLOSED** | Ingestion, persistence, Viewer bind — explicitly future gates |

### 1.2 Final verdict

## **STABLE WITH CONDITIONS**

Architecture is **closed for planning and frozen-path implementation**. Phase 1c asset infrastructure (ingest, store, production Viewer bind) remains **gated** until conditions in §8 are satisfied.

### 1.3 Conditions (must hold before “STABLE” without qualification)

| # | Condition | Owner doc |
|---|-----------|-----------|
| C1 | No adapter or scenario insertion into `compose_pipeline` without amendment | [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) §2 |
| C2 | Ingestion implementation obeys [`PHASE_1C5_ASSET_INGESTION_CONTRACT.md`](./PHASE_1C5_ASSET_INGESTION_CONTRACT.md) | 1c.5 §10 |
| C3 | Production Viewer bind uses adapter snapshots; does not dual-write RVE from ingest | 1c.2 BRIDGE-2 |
| C4 | CL-01–CL-05 remain registered; no silent enum expansion | This report §4 |
| C5 | F-001 governance cluster (pinned ARCHIVED) remains deferred with explicit amendment if behavior changes | [`ARCHITECTURE_CLOSURE_REPORT.md`](./ARCHITECTURE_CLOSURE_REPORT.md) |

**Not BLOCKED:** No unresolvable contradiction prevents continuing 1c implementation work under existing contracts.

---

## 2. Full Layer Inventory

### 2.1 Documentation stack (authoritative)

| Phase | Document | Role | Mutable? |
|-------|----------|------|----------|
| 1b.7 | `PHASE_1B7_CONTRACT_LOCK.md` | Semantic wire freeze, pipeline lock | No |
| 1b | `VIEWER_COMPOSITION_CONTRACT.md` | Viewer bind, fallback | No |
| 1b | `CAMPAIGN_AND_SLOT_INJECTION_ARCHITECTURE.md` | CSPP normative | No |
| 1b | `MEDIA_REPRESENTATION_CONTRACT.md` | Media enums | No |
| 1c.0 | `PHASE_1C_BOUNDARY.md` | Two-layer gate | No |
| 1c.1 | `PHASE_1C1_ASSET_INVENTORY_MODEL.md` | Catalog abstract model | No |
| 1c.2 | `PHASE_1C2_ASSET_RESOLUTION_ADAPTER.md` | Adapter mapping | No |
| 1c.4.1 | `ASSET_SEMANTIC_CONTRACT_LOCK.md` | Unified authority | No |
| 1c.5 | `PHASE_1C5_ASSET_INGESTION_CONTRACT.md` | Ingestion lifecycle/events | No |
| 1c.6 | `SYSTEM_SEMANTIC_AUTHORITY_MAP.md` | Ontology + truth hierarchy | No |
| 1c.6 | This report | Closure audit | No |

### 2.2 Implementation modules

| Layer | Path | In production pipeline? | Deterministic? |
|-------|------|-------------------------|----------------|
| Resolver | `experience/experience_resolve.rs` | Yes (stage 1) | Yes |
| CSPP | `experience/cspp/` | Yes (stage 2) | Yes |
| Media semantic | `media/` | Yes (stage 3) | Yes |
| Viewer sim | `viewer_sim/` | Yes (stage 4) | Yes |
| Orchestrator | `experience/compose_pipeline.rs` | Yes | Yes |
| Asset adapter | `asset_resolution/adapter.rs` | **No** | Yes (per snapshot) |
| Scenario feed | `asset_resolution/scenario_feed.rs` | **No** (`#[cfg(test)]`) | Yes |
| Mock registry | `asset_resolution/mock_registry.rs` | **No** (`#[cfg(test)]`) | Yes |
| Ingestion | — | **Not implemented** | N/A (async by design) |

### 2.3 Frozen pipeline (verified)

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

Source: `compose_pipeline.rs::finish_pipeline` — no `asset_resolution` import.

---

## 3. Cross-Layer Contradiction Matrix

Registered contradictions are **expected boundary tensions**, not implementation defects, unless marked **OPEN**.

| ID | Topic | Layers involved | Statement | Resolution / status |
|----|-------|-----------------|-------------|---------------------|
| **CL-01** | Triple state namespaces | Ingestion (1c.5), catalog (1c.1), semantic (1b) | `ingestion_state` (`UPLOADED`…), `asset_state` (`PENDING`…), `inventory_state` (`PENDING`… no `PROCESSING`) use different enums | **RESOLVED** — orthogonal domains; projection table 1c.5 §5.1; adapter maps catalog → bind fields (1c.2) |
| **CL-02** | Four-wire `media_state` vs trinary failure collapse | 1b.7 vs ASCL §3.1 | 1b.7 freezes `DERIVED_MEDIA`; ASCL collapses failures to REAL / PLACEHOLDER / FALLBACK | **RESOLVED** — `DERIVED_MEDIA` is representation tier, not failure class (ASCL §3.2); adapter steps 4–5 only when READY |
| **CL-03** | Dual `media_state` authority at resolve vs bind | Media semantic (pipeline) vs adapter (bind) | Pipeline writes RVE `metadata.media_state` without catalog; adapter would emit `SemanticMediaBinding` at bind | **CONDITIONAL** — coexistence explicit (1c.2 §4.4); production Viewer bind not wired; pipeline truth for `CompositionPlan` today |
| **CL-04** | Semantic `inventory_state` vs catalog absence | 1b media vs 1c.1 | Semantic `MISSING` has no `asset_state` counterpart; catalog absence is non-row | **RESOLVED** — C1-02 in 1c.1 §8; adapter step 1 |
| **CL-05** | Governance F-001 (pinned ARCHIVED) | 1a governance vs resolver | Legacy contract/code tension on profile pins | **DEFERRED** — per 1a.7 closure; does not break 1b/1c layer separation |

**No OPEN contradiction** blocks architectural closure under current scope.

---

## 4. Failure Model Unification Validation

### 4.1 Detection → representation → rendering (1b + 1c)

| Stage | Owner | 1b | 1c | Validated |
|-------|-------|----|----|-----------|
| Detection | Ingestion / Asset (future) | — | Events only (1c.5) | Contract ✅ / impl ❌ |
| Representation | Media semantic + adapter | `failure_model`, RVE metadata | `SemanticMediaBinding` at bind | Code + tests ✅ |
| Rendering | Viewer | `CompositionPlan`, bundle miss fallback | No asset reads | Code ✅ |

### 4.2 `media_state` collapse validation

| Source condition | Expected collapse | 1b media (simulated) | 1c.2 adapter | 1c.4 scenarios | Match |
|------------------|-------------------|----------------------|--------------|----------------|-------|
| Absent reference | `FALLBACK_MEDIA` | ✅ harness | ✅ step 1/8 | ✅ lifecycle step 0 | ✅ |
| Catalog `FAILED` | `FALLBACK_MEDIA` | ✅ `inventory_state::Failed` | ✅ step 2 | ✅ lifecycle step 3 | ✅ |
| Catalog `PROCESSING` / `PENDING` | `PLACEHOLDER_MEDIA` | ✅ pending path | ✅ step 3 | ✅ processing steps | ✅ |
| Catalog `READY` + valid bind | `REAL_MEDIA` | ✅ harness READY | ✅ step 6 | ✅ lifecycle step 2 | ✅ |
| Stale `asset:{uuid}` | `FALLBACK_MEDIA` | ✅ stale harness | ✅ step 7 | — | ✅ |

### 4.3 Auxiliary failure fields (frozen, unified)

| Field | Cross-layer rule | Drift risk |
|-------|------------------|------------|
| `media_failure_mode` | Four values only; ingest must not add wire strings to RVE | Low — ASCL-EXP-1 |
| `media_reference_validity` | Adapter + `failure_model` aligned on pending/stale/absent | Low — contract tests |
| `inventory_state` | Semantic four-value set; catalog `PROCESSING` → adapter `PENDING` | Medium — document only (CL-01) |

### 4.4 `DERIVED_MEDIA` special case

| Rule | Validation |
|------|------------|
| Not a failure outcome | Adapter uses only when `asset_state: READY` + derived type or thumb policy (1c.2 §5.1 steps 4–5) | ✅ code paths |
| Pipeline may emit without assets | Policy/harness only | ✅ by design (CL-03) |
| Must not represent ingest `FAILED` | 1c.5 §8, ASCL §3.2 | ✅ |

---

## 5. State Ownership Map

| Concept | Owner layer | Namespace | Mutable by | Authoritative for |
|---------|-------------|-----------|------------|-------------------|
| `ingestion_state` | Ingestion (1c.5) | Job lifecycle | Ingestion only | Ingest progress (future) |
| `asset_state` | Asset catalog (1c.1) | Catalog row | Ingestion projection | Byte readiness |
| `asset_id`, `asset_type`, `asset_source` | Asset catalog | Catalog row | Ingestion | Asset identity |
| `inventory_state` | Semantic (1b) | RVE `metadata` | Media semantic (pipeline) | Experience claim |
| `media_state` | Semantic (1b) RVE; adapter (bind) | RVE / binding | Media semantic; adapter at bind | Display class |
| `media_reference` | Semantic (1b) | RVE `metadata` | Media semantic | Opaque bind key |
| `media_failure_mode`, `media_reference_validity` | Semantic (1b) | RVE `metadata` | Media semantic | Failure representation |
| `media_intent`, `media_placeholder_policy` | Semantic (1b) | RVE `metadata` | Media semantic / profile | Policy |
| `thumbnail_resolution` | Semantic (1b) | RVE `metadata` | Media semantic | Thumbnail tier decision |
| `campaigns[]`, `slots[]` | CSPP (1b) | RVE top-level | CSPP | Campaign delivery |
| Base RVE structure | Resolver (1b) | RVE §8 | Resolver | Layout/visibility/theme |
| `CompositionPlan` | Viewer (1b) | Viewer artifact | Viewer sim | Render tree |
| `SemanticMediaBinding` | Adapter (1c.3) | Bind-only struct | — (derived) | Read-time reconcile |
| `MaterializedAssetBundle` | Adapter (1c.3) | Bind-only map | — (derived) | Display handles |
| `AssetScenarioFeed` steps | Test (1c.4) | Test memory | Test code only | Nothing in production |
| `MaterializedAssetHandle` | Future CDN | Bundle only | Asset/CDN | Pixels (future) |

---

## 6. Forbidden Dependency Path Analysis

### 6.1 Normative forbidden edges (all documents aligned)

| From → To | Verdict | Code audit |
|-----------|---------|------------|
| ingestion → resolver/CSPP/media/viewer/pipeline | **Forbidden** | No ingestion module ✅ |
| ingestion → adapter | **Forbidden** | No ingest ✅ |
| adapter → pipeline stages | **Forbidden** | Not in `compose_pipeline` ✅ |
| adapter → RVE write | **Forbidden** | Pure output struct ✅ |
| scenario → production modules | **Forbidden** | `#[cfg(test)]` ✅ |
| resolver → asset catalog | **Forbidden** | No `asset_resolution` in resolve ✅ |
| CSPP → `metadata.media_*` | **Forbidden** | Module comment + no reads ✅ |
| media → asset DB | **Forbidden** | No sqlx/storage in `media/` ✅ |
| viewer → asset catalog | **Forbidden** | RVE-only inputs ✅ |
| semantic → ingestion await | **Forbidden** | Sync pipeline ✅ |

### 6.2 Allowed edges (future-safe)

| From → To | When |
|-----------|------|
| ingestion → catalog projector → `asset_state` | Future impl (1c.5 §5) |
| catalog snapshot → adapter → Viewer bind | Future production bind |
| scenario → adapter | Tests only |

### 6.3 Risk: accidental pipeline coupling

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Import `AssetResolutionAdapter` in `compose_pipeline` | Low | G2 gates; ASCL §2; code review |
| `scenario_feed` exported without `cfg(test)` | Low | Enforced in `mod.rs` |
| Ingest worker calls `resolve` | Medium (future) | 1c.5 §9 forbidden diagram |
| Dual-write RVE from ingest events | Medium (future) | ING-BC-1, FAIL-1 |

---

## 7. Drift Risk Analysis

| Area | Risk level | Mechanism | Guard |
|------|------------|-----------|-------|
| New `media_state` enum | **High** if ungated | Feature pressure | ASCL-EXP-1; contract-lock tests |
| Adapter in pipeline | **High** | Convenience | `compose_pipeline` audit; pipeline tests |
| Ingest → RVE direct write | **High** | Ops shortcuts | 1c.5 §8; NC-105 |
| `PROCESSING` added to semantic `inventory_state` | **Medium** | Name collision CL-01 | Amendment + map update |
| Harness keys leaking to production | **Low** | Copy-paste | `harness_*` only in tests |
| DERIVED vs PLACEHOLDER adapter step 5 | **Low** | Thumb policy | Deterministic adapter tests |
| F-001 governance | **Low** (isolated) | Profile pins | Deferred register |
| Doc/code pipeline order | **Low** | Refactor | Single orchestrator |

**Overall drift risk:** **Low–Medium** with contracts frozen; **Medium** during first ingest implementation (C2–C3).

---

## 8. Test and Contract Coverage Summary

| Register | Count (approx.) | Scope |
|----------|-----------------|-------|
| 1b.7 contract lock | 7 tests | Enums, resolver, CSPP, media, viewer |
| 1b.7 regression | 4 tests | Stability |
| 1c.3 adapter | 5 tests | Mapping paths |
| 1c.4 scenario | 4 tests | Replay, backward compat |
| Adapter unit | 4 tests | Scenario replay |
| Scenario feed unit | 2 tests | Determinism |
| **Total lib tests** | **66** | All passing at audit |

**Gap (accepted):** No integration test for ingestion (not implemented). No production Viewer bind test (not wired).

---

## 9. Consistency Rules Verification

| Rule | Required state | Audit result |
|------|--------------|--------------|
| Ingestion external and mutable only | 1c.5 sole mutable domain | ✅ contract; no code |
| Semantic deterministic and immutable | Frozen pipeline + tests | ✅ |
| Scenario test-only, non-influential | `#[cfg(test)]` | ✅ |
| Adapter mapping-only | No RVE write; §5.1 table only | ✅ |
| No new semantics without amendment | ASCL §8 | ✅ documented |

---

## 10. Closure Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 1b layers inventoried and bounded | ✅ |
| 2 | All 1c contracts through 1c.5 referenced | ✅ |
| 3 | Contradiction matrix CL-01–CL-05 complete | ✅ |
| 4 | Failure model unified across 1b/1c | ✅ |
| 5 | State ownership map complete | ✅ |
| 6 | Forbidden paths analyzed | ✅ |
| 7 | Drift risks documented | ✅ |
| 8 | Authority map published | ✅ [`SYSTEM_SEMANTIC_AUTHORITY_MAP.md`](./SYSTEM_SEMANTIC_AUTHORITY_MAP.md) |
| 9 | Verdict issued | ✅ **STABLE WITH CONDITIONS** |

---

## 11. References

| Document | Role |
|----------|------|
| [`SYSTEM_SEMANTIC_AUTHORITY_MAP.md`](./SYSTEM_SEMANTIC_AUTHORITY_MAP.md) | Canonical ontology (1c.6) |
| [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) | Unified invariants |
| [`ARCHITECTURE_CLOSURE_REPORT.md`](./ARCHITECTURE_CLOSURE_REPORT.md) | Phase 1a verdict (F-001) |

---

*End of Phase 1c.6 closure consistency report.*
