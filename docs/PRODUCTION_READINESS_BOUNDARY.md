# Production Readiness Boundary

**Status:** Normative governance boundary (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Authority:** [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) (sole operational gate), [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) (governance baseline)

**Explicit non-goals:** Code, CI script, pipeline, schema, runtime, or enforcement topology changes. No new validators, checkers, or CI layers.

**Purpose:** Define the precise boundary between **correct frozen-semantic system behavior** (what existing CI proves) and **production-safe deployment eligibility** (what operators may treat as logically safe to ship the semantic core).

---

## Table of Contents

1. [Definition of Production Readiness](#1-definition-of-production-readiness)
2. [Required System State](#2-required-system-state-all-must-pass)
3. [Stability Guarantees](#3-stability-guarantees)
4. [Non-Requirements](#4-non-requirements-critical)
5. [Deployment Boundary Rule](#5-deployment-boundary-rule)
6. [Failure Modes](#6-failure-modes)
7. [Versioning Rule](#7-versioning-rule)
8. [Final Declaration](#8-final-declaration)

---

## 1. Definition of Production Readiness

### 1.1 What “production-ready” means in ReelForge

**Production readiness** is an **architecture governance verdict**, not an infrastructure completeness score.

In this system, a codebase revision is **production-ready** when it satisfies **all** conditions proven by the single CI operational pipeline defined in [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md):

```bash
./scripts/ci-architecture-integrity.sh
# exit code 0 required
```

| Term | Meaning |
|------|---------|
| **Correct system behavior** | Structural graph legal (DGEL) + semantic invariants hold (hardening) + no cross-layer drift (fusion validation) |
| **Production-safe deployment eligibility** | Operators may deploy the **frozen semantic core** knowing architecture integrity CI has passed on that revision |
| **Not implied** | Full Asset Layer infrastructure, ingest workers, CDN, or production Viewer bind |

Production readiness is **tied exclusively** to [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md). No other script, manual checklist, or informal test confers readiness.

### 1.2 What production readiness is not

| Misconception | Actual boundary |
|---------------|-----------------|
| “All features implemented” | Controlled-zone infrastructure may be incomplete |
| “DGEL passed once locally” | Only full operational pipeline on the target revision counts |
| “Semantic tests green in isolation” | Standalone `cargo test system_hardening` is **not** a readiness gate |
| “Ops dashboards green” | Operational telemetry is outside this boundary |

### 1.3 Relationship to the canonical contract

[`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) defines **what** the system must be. [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) defines **how CI proves it**. This document defines **when that proof constitutes deployment eligibility**.

---

## 2. Required System State (ALL MUST PASS)

A revision is production-ready **only if every item below is true** on that revision, as enforced by the CI operational model.

### 2.1 CI operational pipeline (mandatory)

| Stage | Requirement | Proven by |
|-------|-------------|-----------|
| **1 — DGEL** | Structural **PASS** | `depgraph-check` via stage 1; no `STRUCTURAL_BLOCK` |
| **2 — System Hardening** | Semantic **PASS** (default + `runtime_asset_mode`) | Stage 2a and 2b; no `SEMANTIC_BLOCK` |
| **3 — Fusion Validation** | Cross-layer **PASS** | `test_ci_fusion_consistency`; classification **NONE** (not `CROSS_LAYER_DRIFT_BLOCK`) |

**Gate command:**

```bash
./scripts/ci-architecture-integrity.sh
echo $?   # must be 0
```

### 2.2 DGEL structural requirements

| ID | State |
|----|-------|
| **PR-DGEL-1** | `architecture/dependency_policy.toml` parses and applies |
| **PR-DGEL-2** | All production module imports conform to allowed edges |
| **PR-DGEL-3** | **No forbidden dependency edges** detected |
| **PR-DGEL-4** | Documented exceptions only (policy `[[exception_rules]]`) |

Forbidden edges include (representative; full list in policy TOML): resolver/CSPP/media → asset_resolution; ingestion → semantic pipeline; scenario → production paths.

### 2.3 System hardening semantic requirements

| ID | State |
|----|-------|
| **PR-HAR-1** | Pipeline deterministic repeatability (harness) |
| **PR-HAR-2** | CSPP and viewer purity invariants |
| **PR-HAR-3** | Frozen metadata key set; golden snapshots aligned |
| **PR-HAR-4** | `runtime_asset_mode` does not alter semantic outputs (stage 2b) |
| **PR-HAR-5** | No `asset_runtime` imports in frozen semantic modules |

### 2.4 Fusion validation requirements

| ID | State |
|----|-------|
| **PR-FUS-1** | Inline DGEL run inside fusion test agrees with structural PASS |
| **PR-FUS-2** | Semantic harness deterministic when DGEL PASS |
| **PR-FUS-3** | **`CROSS_LAYER_DRIFT_BLOCK` = NONE** (stage 3 exit success) |

If stage 3 fails after stages 1–2 passed, the revision is **not production-ready** regardless of partial confidence in individual layers.

---

## 3. Stability Guarantees

When production readiness holds, the following **logical** guarantees apply to the frozen semantic system. These are **already enforced** by existing CI; this section states the deployment-facing interpretation only.

### 3.1 Determinism (repeatable CI runs)

| Guarantee | Source |
|-----------|--------|
| Identical harness inputs → identical `CompositionPlan`, delivered RVE, media metadata snapshot | System hardening: `test_pipeline_deterministic_repeatability`, golden hashes |
| CSPP does not mutate Base RVE structure or metadata ordering | `test_cspp_purity` |
| Viewer simulation is a pure function of inputs | `test_viewer_purity` |
| CI re-runs on the same revision produce the same pass/fail outcome | Deterministic tests + static DGEL |

**Operational meaning:** Flaky CI on an unchanged revision indicates **loss of production readiness** until root-caused and the pipeline passes again.

### 3.2 Runtime observability without semantic effect

| Guarantee | Source |
|-----------|--------|
| `runtime_asset_mode` may enrich internally | Controlled observability zone (canonical §8.4) |
| `runtime_asset_mode` **must not** change pipeline outputs | Stage 2b + `test_runtime_asset_mode_does_not_change_semantics` |
| Adapter `resolve_with_runtime` must not alter binding vs plain resolve | Fusion / parity tests when feature enabled |

**Operational meaning:** Enabling runtime asset features in deployment must not change RVE or `CompositionPlan` semantics for the frozen pipeline path.

### 3.3 Adapter and scenario isolation from production pipeline

| Guarantee | Source |
|-----------|--------|
| `AssetResolutionAdapter` is **not** in `compose_pipeline` | ASCL §2, canonical §2 |
| `scenario_feed` / `mock_registry` have **zero** production authority | DGEL scenario isolation, hardening import scan |
| Ingestion does not call or mutate semantic pipeline stages | DGEL forbidden edges, canonical INV-ING-* |

**Operational meaning:** Production resolve paths depend only on resolver → CSPP → media → viewer_sim. Catalog/scenario/ingest subsystems cannot silently alter semantic output while CI passes.

---

## 4. Non-Requirements (CRITICAL)

The following are **explicitly not required** for production readiness under v1.0. Their absence does **not** block the deployment boundary rule (§5).

### 4.1 Asset Layer infrastructure (controlled zone)

| Not required | Notes |
|--------------|-------|
| Ingestion implementation (upload, transcode workers) | Contract locked; impl optional |
| Asset CDN / delivery handles in production | Handles belong in `MaterializedAssetBundle`, not RVE |
| Thumbnail generation / `thumbnail_asset_id` population | Asset Layer only |
| Encoding / HLS / proxy pipelines | No semantic pipeline coupling |
| `asset_catalog` Rust module / SQL projector | Future controlled-zone work |
| Production Viewer bind using `MaterializedAssetBundle` | Outside frozen semantic CI proof |

### 4.2 Observability and test-only systems

| Not required | Notes |
|--------------|-------|
| `runtime_asset_mode` enabled in production | Feature is observability-only; CI proves parity when enabled in test |
| Runtime asset registry (`asset_runtime`) deployed | Not in production pipeline |
| Scenario feeds in production | Test-only forever |
| Adapter runtime enrichment (`resolve_with_runtime`) in prod | Optional bind-time path; not pipeline |
| `phase_1c4_*` scenario replay coverage in CI entrypoint | Derivative / observability tests |

### 4.3 Future 1c systems

| Not required | Notes |
|--------------|-------|
| Full catalog persistence | Eventual consistency at adapter read |
| Ingest event bus operational | Semantic pipeline must not await it |
| Operational metrics / alerting on ingest | Ops concern, not architecture readiness |
| Studio preview channel (governance PI-*) | Separate implementation track |

### 4.4 Summary rule

> **Incomplete Asset Layer infrastructure does not negate production readiness** when the CI operational model passes in full on the target revision.

Production readiness certifies the **frozen semantic architecture and its enforcement proof**, not end-to-end media delivery infrastructure.

---

## 5. Deployment Boundary Rule

### 5.1 Canonical rule

> **If [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) passes in full,**  
> **the system is considered “logically production-ready”**  
> **regardless of incomplete infrastructure layers.**

“Passes in full” means:

1. `./scripts/ci-architecture-integrity.sh` exit code `0`
2. All three pipeline stages report PASS
3. Failure classification is **NONE** (no `STRUCTURAL_BLOCK`, `SEMANTIC_BLOCK`, or `CROSS_LAYER_DRIFT_BLOCK`)

### 5.2 What operators may assume

| Assumption | Valid when rule holds |
|------------|----------------------|
| Frozen semantic pipeline is architecturally sound | Yes |
| Import graph respects layer boundaries | Yes |
| Semantic outputs are regression-locked for harness | Yes |
| Deploying semantic-core services will not violate documented invariants | Yes (logical) |
| All media bytes exist for all episodes | **No** |
| Ingest jobs complete before resolve | **No** |

### 5.3 What operators must still manage separately

- Runtime infrastructure (DB, object storage, CDN) provisioning
- Secrets, scaling, monitoring, incident response
- Asset Layer rollout when implemented (must obey controlled zone, not readiness gate)
- Product/feature launch criteria beyond architecture

### 5.4 Merge and release gate

| Gate type | Requirement |
|-----------|-------------|
| Architecture merge | CI operational model PASS on PR revision |
| Release tag / deploy artifact | Same PASS on **exact** artifact commit SHA |
| Hotfix | Re-run full pipeline; partial checks invalid |

---

## 6. Failure Modes

Production readiness is **binary**: eligible or not deployable. There is no partial readiness tier.

| CI classification | Production readiness | Deployable (semantic core) |
|-------------------|----------------------|----------------------------|
| **NONE** (all stages PASS) | **READY** | **Yes** (logically) |
| **STRUCTURAL_BLOCK** | **NOT READY** | **No** |
| **SEMANTIC_BLOCK** | **NOT READY** | **No** |
| **CROSS_LAYER_DRIFT_BLOCK** | **NOT READY** | **No** |

### 6.1 Interpretation for operators

| Classification | Meaning for deployment |
|----------------|------------------------|
| `STRUCTURAL_BLOCK` | Layer imports violate policy — risk of hidden coupling and future semantic corruption |
| `SEMANTIC_BLOCK` | Pipeline parity, purity, or snapshot regression — risk of nondeterministic or wrong viewer experience |
| `CROSS_LAYER_DRIFT_BLOCK` | Structure and semantics disagree — risk of “green DGEL, broken experience” or inverse |

**No warnings-only deploy path exists.** Any classification above blocks logical production readiness until the full CI operational model passes again.

### 6.2 Partial stage success (fail-fast)

Because the pipeline is fail-fast, a failing revision may have incomplete stage visibility (e.g. stage 1 FAIL → stages 2–3 not run). Such revisions are **not deployable** regardless of local confidence in unexecuted stages.

---

## 7. Versioning Rule

### 7.1 Contract binding

Production readiness under this boundary is **tied to** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md).

| Event | Readiness effect |
|-------|------------------|
| CI PASS on `v1.0` contract baseline | Readiness **valid** for that revision |
| Formal amendment to canonical contract | Readiness **invalidated** until CI operational model PASS on amended baseline |
| DGEL policy change (`dependency_policy.toml`) | Readiness **invalidated** until CI PASS |
| Hardening golden / hash change | Readiness **invalidated** until CI PASS |
| New enforcement surface (forbidden by canonical §6.4) | **Out of scope** — does not confer readiness |

### 7.2 Amendment protocol linkage

Per canonical §10, any change that alters frozen semantic meaning, pipeline shape, import graph, or enforcement topology requires:

1. Contract version bump (`v1.0` → `v1.1` / `v2.0`)
2. Updated subordinate docs as applicable
3. **Full** `./scripts/ci-architecture-integrity.sh` PASS on the post-amendment revision

Until step 3 completes, the revision must be treated as **not production-ready** even if infrastructure work is complete.

### 7.3 Documentation-only changes

Clarifications to docs that **do not contradict** frozen contracts do not, by themselves, invalidate readiness. Implementation or policy changes always require re-proof via CI.

---

## 8. Final Declaration

### PRODUCTION READINESS DECLARATION

> **ReelForge is production-ready when and only when the CI operational model passes without any failure classification.**

Equivalently:

| Condition | Verdict |
|-----------|---------|
| `./scripts/ci-architecture-integrity.sh` → exit `0`, classification **NONE** | **LOGICALLY PRODUCTION-READY** |
| Any `STRUCTURAL_BLOCK`, `SEMANTIC_BLOCK`, or `CROSS_LAYER_DRIFT_BLOCK` | **NOT PRODUCTION-READY** |
| Infrastructure layers incomplete but CI PASS | **LOGICALLY PRODUCTION-READY** (semantic core only) |

### 8.1 Boundary summary

```text
 ┌─────────────────────────────────────────────────────────────┐
 │  PRODUCTION READINESS BOUNDARY                              │
 ├─────────────────────────────────────────────────────────────┤
 │  IN:  CI_OPERATIONAL_MODEL full PASS (v1.0 contract)        │
 │  OUT: Asset ingest, CDN, thumbs, runtime registry, scenarios│
 │  BLOCK: Any of 3 CI failure classifications                 │
 └─────────────────────────────────────────────────────────────┘
```

### 8.2 References

| Document | Role |
|----------|------|
| [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) | **Sole operational proof** of readiness |
| [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) | Governance baseline and amendment rules |
| [`CI_ARCHITECTURE_INTEGRITY_MODEL.md`](./CI_ARCHITECTURE_INTEGRITY_MODEL.md) | Background (subordinate) |
| [`DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md`](./DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md) | DGEL detail (subordinate) |

---

*End of Production Readiness Boundary v1.0.*
