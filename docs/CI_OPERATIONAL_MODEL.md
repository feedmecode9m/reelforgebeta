# CI Operational Model

**Status:** Authoritative CI operations guide  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio

**Authority:** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`CI_ARCHITECTURE_INTEGRITY_MODEL.md`](./CI_ARCHITECTURE_INTEGRITY_MODEL.md)

**Supersedes for CI operations:** Informal multi-script CI patterns, standalone `ci-depgraph-check` in workflows, ad-hoc `cargo test system_hardening` outside the fusion pipeline.

---

## 1. Single CI truth pipeline

### 1.1 Authoritative entrypoint (only)

From repository root:

```bash
./scripts/ci-architecture-integrity.sh
```

| Rule | Requirement |
|------|-------------|
| **CI-OP-1** | Exactly **one** external CI entrypoint exists: `scripts/ci-architecture-integrity.sh`. |
| **CI-OP-2** | All other enforcement mechanisms are **internal** to this script. |
| **CI-OP-3** | Workflows, pre-push hooks, and merge gates **must** call only this script for architecture integrity. |
| **CI-OP-4** | Exit code `0` = CI valid; non-zero = **BLOCKED** (no warnings-only path). |

### 1.2 Internal-only components (not CI entrypoints)

| Component | Role | CI invocation |
|-----------|------|---------------|
| `scripts/ci-depgraph-check.sh` | DGEL stage implementation | Called by fusion script stage 1 only |
| `cargo run -p depgraph-check` | DGEL tool | Via `ci-depgraph-check.sh` only |
| `cargo test -p backend --lib system_hardening` | Semantic tests | Via fusion script stage 2 only |
| `cargo test … test_ci_fusion_consistency` | Cross-layer gate | Via fusion script stage 3 only |

**Do not** add workflow steps that run `ci-depgraph-check.sh`, `depgraph-check`, or `system_hardening` tests independently in CI context.

### 1.3 Immutable execution order

```text
┌─────────────────────────────────────────────────────────────────┐
│  ./scripts/ci-architecture-integrity.sh                       │
├─────────────────────────────────────────────────────────────────┤
│  [1] DGEL                  structural import graph            │
│        └─ internal: ci-depgraph-check.sh → depgraph-check     │
│  [2] SYSTEM HARDENING      semantic invariants + snapshots    │
│        ├─ [2a] default features (skip fusion test)            │
│        └─ [2b] runtime_asset_mode parity (skip fusion test)   │
│  [3] FUSION VALIDATION     cross-layer consistency            │
│        └─ test_ci_fusion_consistency only                     │
└─────────────────────────────────────────────────────────────────┘
```

> **No stage may be run independently in CI context outside this sequence.**

Fail-fast: the first failing stage stops the pipeline and emits exactly one failure classification (§2).

---

## 2. Failure classification model

CI recognizes **exactly three** terminal failure states. No additional categories, severity levels, or informal warnings exist.

| Classification | Stage | Meaning | CI verdict |
|----------------|-------|---------|------------|
| **STRUCTURAL_BLOCK** | 1 (DGEL) | Dependency graph violates `dependency_policy.toml` | **BLOCKED** |
| **SEMANTIC_BLOCK** | 2 (System Hardening) | Pipeline parity, purity, snapshot, or runtime toggle invariant failed | **BLOCKED** |
| **CROSS_LAYER_DRIFT_BLOCK** | 3 (Fusion Validation) | DGEL and semantic harness disagree on system health | **BLOCKED** |

### 2.1 Mapping (no other outcomes)

| Observed failure | Classification |
|------------------|----------------|
| `depgraph-check` non-zero | `STRUCTURAL_BLOCK` |
| Any `system_hardening` test fails (stage 2) | `SEMANTIC_BLOCK` |
| `test_ci_fusion_consistency` fails after stages 1–2 passed | `CROSS_LAYER_DRIFT_BLOCK` |
| All stages pass | *(none — PASS)* |

### 2.2 Output format

On **BLOCKED**, the entrypoint prints a single classification block with per-stage PASS/FAIL. No remediation automation; classification is diagnostic only.

---

## 3. Enforcement hierarchy (collapsed view)

For CI operations, the enforcement stack collapses to one orchestrated pipeline:

```text
                    ┌──────────────────────────┐
                    │  CI ENTRYPOINT (fusion)  │
                    └────────────┬─────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
    STRUCTURAL              SEMANTIC              CROSS-LAYER
    (DGEL)                  (Hardening)           (Fusion test)
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                    Canonical Contract v1.0 (governance)
```

| Layer | Validates | Does not validate |
|-------|-----------|-------------------|
| DGEL | `use` graph, forbidden edges | Enum meaning, determinism |
| System Hardening | Semantic parity, snapshots, purity | Full import graph (partial string scan only) |
| Fusion Validation | DGEL PASS ↔ semantic harness alignment | New domains |

**Canonical contract** ([`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md)) defines **what** must hold. This operational model defines **how CI proves it** in one run.

---

## 4. Redundancy classification

Audit of overlapping enforcement (documentation only — no code removal).

### 4.1 DGEL vs Canonical Contract

| Overlap | Classification | Rationale |
|---------|----------------|-----------|
| Forbidden import edges in policy TOML | **REQUIRED** | Machine-checkable; contract states rules in prose |
| Layer definitions and authority | **DERIVATIVE** (contract) | Human governance; DGEL does not read contract file |
| `test_dgel_policy_compliance` in hardening | **DERIVATIVE** | Inline re-run of DGEL inside stage 2; stage 1 already enforces |

### 4.2 System Hardening vs CI Fusion

| Overlap | Classification | Rationale |
|---------|----------------|-----------|
| `test_ci_fusion_consistency` | **REQUIRED** | Sole explicit cross-layer drift detector (stage 3) |
| Full `system_hardening` suite in stage 2 | **REQUIRED** | Semantic guarantees (parity, purity, goldens) |
| Fusion script orchestration | **REQUIRED** | Single entrypoint; stages 2+3 split prevents skipping drift check |
| `CI_ARCHITECTURE_INTEGRITY_MODEL.md` | **DERIVATIVE** | Historical fusion doc; operations superseded by this file |

### 4.3 Scenario system vs adapter tests

| Overlap | Classification | Rationale |
|---------|----------------|-----------|
| `test_adapter_statelessness` (hardening) | **REQUIRED** | Stateless adapter invariant for CI semantic layer |
| `phase_1c4_*` scenario replay tests | **DERIVATIVE** | Deeper catalog timelines; not in CI entrypoint |
| `scenario_feed` in adapter unit tests | **OBSERVABILITY ONLY** | Local/dev coverage; zero production authority |
| Mock registry in pipeline integration tests | **DERIVABILITY / OBSERVABILITY** | Harness replay; not invoked by CI entrypoint |

### 4.4 Runtime feature tests

| Overlap | Classification | Rationale |
|---------|----------------|-----------|
| Stage 2b `runtime_asset_mode` | **REQUIRED** | Proves observability toggle does not break semantic tests |
| `test_runtime_asset_mode_does_not_change_semantics` | **REQUIRED** | Output parity inside hardening suite |
| `asset_runtime` integration tests | **OBSERVABILITY ONLY** | Outside CI entrypoint; not merge-blocking unless wired in |

---

## 5. Non-expansion rule (critical)

> **The architecture is frozen in enforcement topology.**  
> **No additional CI validators, checkers, or enforcement systems may be introduced.**  
> **Any future enforcement must replace or merge an existing mechanism.**

| Allowed | Forbidden |
|---------|-----------|
| Extend tests inside `system_hardening` | New top-level CI scripts parallel to `ci-architecture-integrity.sh` |
| Update `dependency_policy.toml` via amendment | New checker crates without removing/replacing DGEL |
| Bump golden snapshots with audit | Separate workflow jobs for DGEL or hardening alone |
| Clarify docs | “Optional” architecture checks that bypass the single pipeline |

Canonical reference: [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) §6.4 and §12.

---

## 6. CI integration

### GitHub Actions (required pattern)

```yaml
- name: Architecture Integrity
  run: ./scripts/ci-architecture-integrity.sh
```

### Local pre-push

```bash
./scripts/ci-architecture-integrity.sh
```

### Invalid patterns (do not use in CI)

```bash
# INVALID — standalone DGEL bypasses fusion validation
./scripts/ci-depgraph-check.sh

# INVALID — semantic-only bypasses structural gate
cargo test -p backend --lib system_hardening

# INVALID — competes with single entrypoint
cargo run -p depgraph-check
```

---

## 7. Relationship to other documents

| Document | Role after operationalization |
|----------|------------------------------|
| **This document** | **Authoritative** for CI execution and failure taxonomy |
| [`CI_ARCHITECTURE_INTEGRITY_MODEL.md`](./CI_ARCHITECTURE_INTEGRITY_MODEL.md) | Background: fusion rationale (subordinate) |
| [`DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md`](./DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md) | DGEL policy detail (subordinate) |
| [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) | System governance and freeze state |

---

*End of CI Operational Model.*
