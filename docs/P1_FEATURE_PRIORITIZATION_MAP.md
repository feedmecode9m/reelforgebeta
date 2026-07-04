# P1 Feature Prioritization Map (Build-First Mode)

**Status:** Executable engineering priorities (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**Pipeline (frozen, reference only):**

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

**Workflow:** [`SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md`](./SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md)

---

## Hard constraints (this document)

This document **MUST NOT**:

* introduce new system layers or partitions
* modify or redefine pipeline order
* extend CI, DGEL, hardening, or fusion logic
* define new contracts, schemas, or governance models
* introduce new semantic concepts (`media_state`, `asset_state`, etc.)
* propose new architectures or “future systems”

This is **pure build prioritization inside existing P1 only**.

---

## 1. Purpose

Define what to build next inside:

```text
resolver → CSPP → media → viewer_sim
```

No other systems are in scope.

---

## 2. Scope restriction

**In scope (P1 only):**

* resolver logic refinement
* CSPP enrichment correctness
* media semantic resolver improvements
* viewer_sim rendering correctness

**Explicitly excluded:**

* P2 CI systems
* P3 adapter
* P4 ingestion / CDN / encoding
* any asset infrastructure

---

## 3. Goal of this document

Provide a **ranked list of real engineering work** based on:

* user-facing impact (resolve → compose path)
* runtime correctness
* determinism stability
* test coverage gaps (from existing suites)
* known edge cases (from harness + contract-lock tests)

This is **not** architecture design.

---

## 4. Current baseline (already strong — do not redo)

| Area | Existing coverage |
|------|-------------------|
| Harness vectors (5 formats) | `pipeline_vector_*` in `pipeline_integration_tests.rs` |
| CSPP structural immutability | `contract_lock_cspp_structural_immutable` |
| Slot collision determinism | `regression_campaign_slot_collision_deterministic` |
| Media enum lock | `contract_lock_frozen_enum_consistency`, media unit tests |
| Failure model matrix | `contract_lock_failure_model_exhaustive` |
| Pipeline determinism | `contract_lock_cspp_viewer_determinism`, system hardening |
| Missing reference regression | `regression_missing_media_reference_stable` |

Priorities below are **gaps and refinements**, not greenfield systems.

---

## 5. Prioritization format

Each item includes: **Feature / Fix**, **P1 module**, **Why (runtime impact)**, **Risk**, **Determinism impact**.

**Risk:** LOW = localized fix; MEDIUM = cross-stage or metadata; HIGH = resolve/DB path or collision rules.

**Determinism impact:** YES = intentional output change (requires controlled test + CI); NO = preserve same inputs → same outputs.

---

## 6. Ranked backlog

### Priority 1 — Ship-path correctness (do first)

| # | Feature / Fix | P1 module | Why it matters | Risk | Determinism |
|---|---------------|-----------|----------------|------|-------------|
| **P1-01** | **Production-shaped media input path** — full pipeline using `experience_profile.content_format` (not only `harness_content_format`) | media | Real `compose_pipeline::run` responses use profile-shaped Base RVE; media intent/policy must match production fields today only harness-tested in isolation | MEDIUM | NO |
| **P1-02** | **DB resolve → compose parity** — `compose_pipeline::run` matches harness semantics for `media_state` / `CompositionPlan` on same episode fixture | resolver + media + viewer_sim | `pipeline_full_run_with_database_optional` skips without `DATABASE_URL`; production API path is primary user surface | HIGH | NO |
| **P1-03** | **CSPP `enrich_with_pool` vs `enrich` equivalence** — same episode context yields same structural snapshot + slot binding rules as harness `enrich` | CSPP | Async path loads campaigns from DB stub; drift between sync/async enrich breaks determinism across deploy shapes | MEDIUM | NO |

### Priority 2 — User-visible composition quality

| # | Feature / Fix | P1 module | Why it matters | Risk | Determinism |
|---|---------------|-----------|----------------|------|-------------|
| **P1-04** | **RenderTree slot surface mapping coverage** — exercise all `slot_key_to_surface` paths with active slots + visibility on/off | viewer_sim | `render_tree_builder` admits nodes from slots; incomplete coverage risks empty or duplicate `RenderNode`s in real campaigns | MEDIUM | NO |
| **P1-05** | **Hero / panel visibility mode matrix** — `STATIC_IMAGE`, `OFF`, and default modes produce stable `admitted_surfaces` + HERO node presence | viewer_sim | `regression_viewer_surface_rendering_deterministic` covers one mode; clients depend on visibility-driven surfaces | LOW | NO |
| **P1-06** | **Campaign active-window filtering** — expired / future `start_date` / `end_date` campaigns excluded deterministically | CSPP | Wrong active set changes `campaigns[]`, `slots[]`, and render tree campaign bindings | MEDIUM | NO |
| **P1-07** | **Multi-scope slot collision table** — extend collision tests beyond episode vs platform (series scope, priority ties) | CSPP | `regression_campaign_slot_collision_deterministic` proves one tie-break; additional scopes are common in contract docs | MEDIUM | NO |

### Priority 3 — Resolver robustness (offline-first)

| # | Feature / Fix | P1 module | Why it matters | Risk | Determinism |
|---|---------------|-----------|----------------|------|-------------|
| **P1-08** | **RDR harness tests without DB** — mirror critical `resolve_tests` rules using fixture Base RVE builders | resolver | Most resolver tests skip without `DATABASE_URL`; slows iteration and hides regressions on merge | LOW | NO |
| **P1-09** | **`validate_rve` failure clarity** — stable error messages for contract violations at resolve boundary | resolver (contract) | API consumers and Studio need actionable validation failures without changing RVE shape | LOW | NO |
| **P1-10** | **Pinned draft / profile edge cases** — deterministic errors for `PinnedDraft`, missing profile, archived profile (per existing RDR) | resolver | Documented REM/contradiction cluster; behavior must stay deterministic and explicit | HIGH | NO |

### Priority 4 — Media semantic edge hardening

| # | Feature / Fix | P1 module | Why it matters | Risk | Determinism |
|---|---------------|-----------|----------------|------|-------------|
| **P1-11** | **`DERIVED_MEDIA` + `harness_semantic_derived` path** — thumbnail `ALLOW_DERIVED` consistency through full pipeline | media | Derived tier is frozen enum but has thinner E2E coverage than `REAL_MEDIA` / `PLACEHOLDER` | LOW | NO |
| **P1-12** | **`FAILED` inventory + hero off** — fallback ladder matches `inventory_to_media_state` table under full pipeline | media | `contract_lock_inventory_state_complete` is unit-level; E2E vector for `FAILED` + visibility OFF is thin | LOW | NO |
| **P1-13** | **Policy override via `metadata.media_placeholder_policy`** — production override path (not harness-only) | media | `extract_policy_override` exists; pipeline vectors always use default policy from intent | MEDIUM | NO |
| **P1-14** | **Stale / delayed reference vectors** — E2E harness for `harness_reference_stale` and `harness_reference_delayed` through `run_from_base_rve` | media | Failure model unit-tested; full-pipeline golden stability not locked for both | LOW | NO |

### Priority 5 — Viewer_sim polish (low risk, high confidence)

| # | Feature / Fix | P1 module | Why it matters | Risk | Determinism |
|---|---------------|-----------|----------------|------|-------------|
| **P1-15** | **Direct `render_tree_builder` unit tests** — admitted surfaces ordering and empty `slots[]` / empty `campaigns[]` | viewer_sim | Logic lives in `render_tree_builder.rs`; today mostly indirect via integration tests | LOW | NO |
| **P1-16** | **Null-safe `layout` / `visibility` missing keys** — default admit rules without panic | viewer_sim | Malformed or minimal RVE must fail validation earlier, not panic in viewer | LOW | NO |
| **P1-17** | **`CompositionPlan` version + schema consistency** — assert wire fields on all harness vectors (extend `assert_pipeline_ok`) | viewer_sim | Clients rely on `plan_version` + `schema_version` stability | LOW | NO |

---

## 7. Allowed work categories (reference)

| Category | Examples from backlog |
|----------|----------------------|
| **A. Resolver** | P1-08, P1-09, P1-10 |
| **B. CSPP** | P1-03, P1-06, P1-07 |
| **C. Media semantic** | P1-01, P1-11 – P1-14 |
| **D. Viewer_sim** | P1-04, P1-05, P1-15 – P1-17 |

---

## 8. Explicitly forbidden categories

* no asset layer work (P3)
* no ingestion / CDN discussion (P4)
* no adapter evolution
* no CI expansion (P2) except golden updates when P1 output intentionally changes under amendment
* no new theoretical models or future architecture sections
* no pipeline reorder or fifth stage

---

## 9. Stability principle

> **Every item must preserve deterministic output unless explicitly labeled as a controlled test scenario.**

| Before merge (RISK / HIGH items) | Command |
|----------------------------------|---------|
| CI operational model | `./scripts/ci-architecture-integrity.sh` |
| Local P1 tests | `cargo test -p backend --lib` (targeted modules) |

If **P1-01** or **P1-03** changes golden harness output, follow [`SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md`](./SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md) RISK path and refresh hardening snapshots only with audit.

---

## 10. Suggested execution order (sprints)

| Sprint focus | Items | Outcome |
|--------------|-------|---------|
| **Sprint A** | P1-01, P1-02, P1-03 | Production resolve path trusted |
| **Sprint B** | P1-04, P1-05, P1-06, P1-07 | Campaign/slot/render tree correctness |
| **Sprint C** | P1-08 – P1-10 | Resolver offline confidence |
| **Sprint D** | P1-11 – P1-17 | Edge media + viewer hardening |

Order within a sprint may shuffle if a **HIGH** risk item blocks release.

---

## 11. Classification quick-check

| If you are about to… | Classification |
|----------------------|----------------|
| Fix `content_format` extraction for real profiles | SAFE → RISK (run CI) |
| Add slot collision test case | SAFE |
| Change collision tie-break rule | RISK (determinism YES — document) |
| Add adapter call in compose_pipeline | **BLOCKED** |
| Add new `media_state` value | **BLOCKED** |

---

## 12. Output requirement

> **This map defines executable engineering priorities strictly within P1. No structural or architectural changes are introduced or implied.**

---

## References

| Document | Use when |
|----------|----------|
| [`SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md`](./SAFE_FEATURE_DEVELOPMENT_WORKFLOW.md) | Classifying and landing each item |
| [`PRODUCTION_SERVICE_BOUNDARY_MANIFEST.md`](./PRODUCTION_SERVICE_BOUNDARY_MANIFEST.md) | Confirm P1-only scope |
| [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md) | What “done” means for user-visible output |

**Next logical doc (optional):** `P1_EXECUTION_BACKLOG.md` — PR-sized work units derived from items P1-01–P1-17.

---

*End of P1 Feature Prioritization Map v1.0.*
