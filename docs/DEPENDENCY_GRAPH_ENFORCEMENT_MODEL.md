# Dependency Graph Enforcement Model (DGEL)

**Phase:** 1c.7+ enforcement tooling  
**Status:** Active CI gate  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio

**Authority:** [`PHASE_1B7_CONTRACT_LOCK.md`](./PHASE_1B7_CONTRACT_LOCK.md), [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md), [`PHASE_1C7_ARCHITECTURE_FREEZE.md`](./PHASE_1C7_ARCHITECTURE_FREEZE.md), [`SYSTEM_SEMANTIC_AUTHORITY_MAP.md`](./SYSTEM_SEMANTIC_AUTHORITY_MAP.md)

**Policy file:** [`architecture/dependency_policy.toml`](../architecture/dependency_policy.toml)  
**Tool crate:** `tools/depgraph-check/`

---

## 1. Purpose

DGEL provides **compile-time-adjacent, deterministic CI validation** that Rust module imports respect the frozen ReelForge layer architecture. It prevents forbidden cross-layer coupling before tests run.

| Property | Value |
|----------|-------|
| Deterministic | Same source tree → same graph |
| Static | `syn` parse only; no runtime execution |
| No network / DB | Local filesystem scan |
| Pipeline-neutral | Does not modify RVE or `compose_pipeline` |

---

## 2. Architecture Layers (Nodes)

| Node | Source paths | Role |
|------|--------------|------|
| `resolver` | `experience/experience_resolve.rs`, loaders, contract, … | Base RVE composition |
| `cspp` | `experience/cspp/` | Campaign/slot enrichment |
| `orchestrator` | `experience/compose_pipeline.rs` | Frozen pipeline wiring |
| `media_semantic` | `media/` | Metadata media fields |
| `viewer_sim` | `viewer_sim/` | `CompositionPlan` simulation |
| `asset_resolution` | `asset_resolution/` (production modules) | Adapter bridge |
| `scenario` | `scenario_feed`, `mock_registry`, `scenario_validation` | Test-only replay |
| `ingestion` | `ingestion/` | Mutable ingest domain |
| `asset_catalog` | *(future)* | Catalog projector placeholder |

---

## 3. Allowed Transformation Graph

Production code may only depend across layers as follows:

```text
ingestion ──► asset_catalog (future)

orchestrator ──► resolver | cspp | media_semantic | viewer_sim

resolver ──► cspp

cspp ──► media_semantic          (via orchestrator today; direct import forbidden)

media_semantic ──► viewer_sim    (via orchestrator today)

asset_resolution ──► viewer_sim  (boundary types only; future bind)
```

**Orchestrator** is the only module that wires the frozen pipeline:

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

---

## 4. Forbidden Edges (Hard Fail)

Full list in `architecture/dependency_policy.toml` under `forbidden_edges`.

Representative violations:

| Edge | Rule |
|------|------|
| `resolver → asset_resolution` | No asset knowledge in resolver |
| `cspp → asset_resolution` | CSPP media-agnostic |
| `ingestion → resolver` | Ingestion external to pipeline |
| `asset_resolution → cspp` | Adapter does not mutate pipeline |
| `scenario → *` (production) | Test-only isolation |
| `viewer_sim → cspp` | No upstream influence *(except documented exception)* |

---

## 5. Documented Exceptions

| From | To | File | Reason |
|------|-----|------|--------|
| `cspp` | `viewer_sim` | `experience/cspp/composition_plan.rs` | `CompositionPlan` embeds `RenderTree` (1b.5 data-only) |
| `viewer_sim` | `cspp` | `viewer_sim/viewer_simulation.rs` | Returns `CompositionPlan` type (1b.5 data-only) |

Add new exceptions only via `[[exception_rules]]` in the policy TOML **and** architecture amendment (PHASE_1C7 §6.3).

---

## 6. Test-Only Paths

Imports from these paths are **excluded** from production graph enforcement:

- `pipeline_integration_tests.rs`
- `integration_tests.rs`, `resolve_tests.rs`
- `asset_resolution/adapter.rs` (unit tests import `scenario_feed`)
- Paths under `/tests/`

**Rule:** `scenario_feed` and `mock_registry` must not be imported from non-test production modules.

---

## 7. Tool Usage

### 7.1 From repository root (workspace)

```bash
cargo run -p depgraph-check
```

### 7.2 CI script

```bash
./scripts/ci-depgraph-check.sh
```

### 7.3 Custom policy path

```bash
DEPGRAPH_POLICY_PATH=/path/to/dependency_policy.toml cargo run -p depgraph-check
```

### 7.4 Release build (CI)

```bash
cargo run -p depgraph-check --release
```

---

## 8. CI Integration

DGEL runs **only** as stage 1 of the authoritative CI entrypoint. Do not invoke `ci-depgraph-check.sh` standalone in CI.

```yaml
# Required pattern
- name: Architecture Integrity
  run: ./scripts/ci-architecture-integrity.sh
```

Operational detail: [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md)

---

## 9. Failure Output Format

On violation:

```text
❌ ARCHITECTURE VIOLATION DETECTED

Violation: cspp → asset_resolution
File: backend/src/experience/cspp/mod.rs:42

Rule: CSPP must not access Asset Layer (CSPP-6)

Fix:
- Move logic to AssetResolutionAdapter
- Or pass via SemanticMediaBinding only
```

Exit code: **1** (FAIL).  
Exit code: **0** (PASS).

---

## 10. How It Works

1. Walk `backend/src/**/*.rs`
2. Map each file → layer via `path_layers` in policy TOML
3. Parse `use crate::...` with `syn` (skip `#[cfg(test)]` modules)
4. Resolve target crate path → target layer
5. Compare layer edge against `forbidden_edges` / `allowed_edges`
6. Apply `exception_rules` for documented boundaries
7. Report violations with file + line

---

## 11. Drift Classification (aligned with PHASE_1C7)

| Action | DGEL result |
|--------|-------------|
| New `use crate::asset_resolution` in `media/` | **FAIL** |
| Ingest module importing `experience_resolve` | **FAIL** |
| New contract test importing adapter in `pipeline_integration_tests.rs` | **PASS** (test-only path) |
| New `exception_rules` without amendment | **PASS** at CI — **still needs doc amendment** |

---

## 12. Future Extension Hooks

Policy `[future]` section reserves:

| Hook | Intent |
|------|--------|
| `multi_repo` | Graph across workspace crates |
| `wasm_modules` | Isolate WASM guest imports |
| `viewer_plugins` | Plugin allowlist per surface |
| `recommendation_layer` | Isolate recommendation engine node |

---

## 13. Maintenance

| Change | Required updates |
|--------|------------------|
| New experience submodule | `path_layers` in policy TOML |
| New forbidden edge | `forbidden_edges` + this doc |
| Legitimate boundary | `exception_rules` + amendment doc |
| New top-level crate module in architecture | Add layer mapping + rules |

### 13.1 TOML policy authoring rule

In `dependency_policy.toml`, **`[[path_layers]]` and `[[exception_rules]]` must be the last array-of-table sections** in the file. Any root-level keys placed after `[[...]]` blocks are parsed as nested fields inside the last table element (TOML scoping). Keep `version`, `crate_root`, `boundary_types`, `allowed_edges`, `forbidden_edges`, and `test_only_paths` **above** all `[[...]]` sections.

---

## 14. References

| Artifact | Path |
|----------|------|
| Policy | `architecture/dependency_policy.toml` |
| Checker | `tools/depgraph-check/` |
| CI entrypoint | `scripts/ci-architecture-integrity.sh` |
| DGEL internal script | `scripts/ci-depgraph-check.sh` (not a CI entrypoint) |
| Workspace | `Cargo.toml` (root) |

---

*End of Dependency Graph Enforcement Model.*
