# Safe Feature Development Workflow (Frozen Architecture Mode)

**Status:** Operational guidance (documentation only)  
**Version:** `1.0.0`  
**Effective:** 2026-06-03  
**Project:** ReelForge / Smart Production Studio

**References (unchanged):** [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md), [`PRODUCTION_SERVICE_BOUNDARY_MANIFEST.md`](./PRODUCTION_SERVICE_BOUNDARY_MANIFEST.md), [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md), [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md)

**This document does not:** introduce layers, redefine pipeline stages, modify CI, define new semantics, define new boundaries, or propose runtime abstractions.

---

## 1. Purpose

Define how developers safely add features **inside the existing frozen ReelForge architecture** without violating:

| Process | Boundary |
|---------|----------|
| **P1 — Semantic Runtime** | Deterministic pipeline; authoritative `CompositionPlan` / RVE |
| **P2 — Governance (CI only)** | DGEL + hardening + fusion; non-runtime |
| **P3 — Asset Adapter Bridge** | Read-only post-compose enrichment |
| **P4 — External Asset Systems** | Async; eventually consistent; non-authoritative over semantics |

Use this workflow before every feature branch, PR, and deploy candidate.

---

## 2. Core principle

> **All production changes MUST occur inside existing boundaries.**  
> **No new layer definitions are allowed.**

If a change does not fit P1, P3, or P4 (or P2 test extensions per canonical amendment rules), it is out of scope for normal feature work.

---

## 3. Allowed modification zones

Edit **only** within these areas. Refine behavior; do not invent new systems.

### P1 — Semantic Runtime

| Module area | Allowed |
|-------------|---------|
| Resolver | Logic improvements within existing RVE contracts |
| CSPP | Enrichment adjustments; **no** structural Base RVE mutation |
| Media semantic resolver | `metadata.media_*` refinements only (frozen enums) |
| Viewer sim | Render behavior / `CompositionPlan` construction only |

**Orchestrator rule:** Changes stay inside:

```text
resolve_base_rve → cspp::enrich → apply_media_semantic_stub → simulate_viewer
```

### P3 — Adapter (optional, read-only)

| Allowed |
|---------|
| Mapping improvements (existing 1c.2 table) |
| Validation tightening on snapshot + metadata |
| Deterministic enrichment fixes |
| Post-compose bind path only |

### P4 — External systems (out of band)

| Allowed |
|---------|
| Ingestion improvements |
| CDN / encoding / thumbnail pipeline changes |
| Catalog persistence and projection evolution |

P4 work **must not** call P1 during compose or mutate RVE / `CompositionPlan`.

### P2 — Governance (restricted)

| Allowed (narrow) |
|------------------|
| Extend **existing** `system_hardening` tests when outputs intentionally change under formal amendment |
| Update golden snapshots **with** contract amendment |

| Not allowed in normal feature work |
|-----------------------------------|
| New CI entrypoints |
| DGEL / fusion script changes |
| New enforcement crates or checkers |

---

## 4. Forbidden modification zones

The following are **blocked** for routine feature development:

| Forbidden | Reason |
|-----------|--------|
| Pipeline order change | Frozen: resolver → CSPP → media → viewer_sim |
| Adapter inside `compose_pipeline` | ASCL §2 |
| New `media_state`, `asset_state`, or failure models | Canonical §9 |
| New CI systems or enforcement layers | Canonical §6.4 |
| New runtime partitions or “truth layers” | PRODUCTION_SERVICE_BOUNDARY_MANIFEST |
| Cross-layer coupling (ingest → resolver, asset → CSPP, etc.) | DGEL forbidden edges |
| Modifying DGEL policy without amendment | Structural contract |
| Modifying hardening / fusion orchestration | CI operational model frozen |
| `scenario_feed` in production paths | Test-only forever |
| Standalone `ci-depgraph-check.sh` as merge gate | Use `ci-architecture-integrity.sh` only |

---

## 5. Change classification model

Classify every change **before** implementation. This is operational triage, not architecture design.

### SAFE CHANGE

| Criteria |
|----------|
| Operates within P1, P3, or P4 rules in §3 |
| Does not alter pipeline order |
| Does not add enums, fields, or partitions |
| Preserves determinism (§7) |

**Examples:** CSPP collision tie-break fix (deterministic); adapter mapping correction for existing snapshot; ingest worker retry policy.

**Gate:** Existing unit/integration tests + `cargo test -p backend --lib` as needed.

### RISK CHANGE

| Criteria |
|----------|
| Affects adapter behavior or metadata interpretation |
| Touches golden harness or snapshot hashes |
| Touches media semantic stub behavior |
| Spans P1 and P3 coordination (still no compose-time adapter) |

**Examples:** New harness documentary vector; adapter table edge case; `metadata` key population change.

**Gate:** Full CI operational model **required**:

```bash
./scripts/ci-architecture-integrity.sh
```

### BLOCKED CHANGE

| Criteria |
|----------|
| Introduces new semantic concepts or wire enums |
| Modifies pipeline order or adds a fifth stage |
| Attempts cross-layer coupling |
| Requires new CI validator or partition |
| Unblocks ingest/CSPP/resolver circular dependency |

**Action:** Stop. Redesign within P1/P3/P4 or initiate formal contract amendment ([`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) §10) — not normal feature work.

---

## 6. Development workflow (step-by-step)

Minimal workflow for every feature:

| Step | Action |
|------|--------|
| **1** | Identify target layer: **P1**, **P3**, or **P4** (not P2 unless amending tests/goldens under contract) |
| **2** | Classify change: **SAFE**, **RISK**, or **BLOCKED** (§5) |
| **3** | Confirm change does **not** introduce new concepts, partitions, or CI surfaces |
| **4** | Implement only in allowed modules for that layer (§3) |
| **5** | Run existing local tests relevant to touched modules (`cargo test -p backend --lib …`) |
| **6** | If **RISK** or any P1 semantic touch: run CI operational model: `./scripts/ci-architecture-integrity.sh` |
| **7** | Verify deterministic output unchanged unless explicitly intended and documented (§7) |
| **8** | PR description states: layer, classification, CI command run, determinism impact |

**Merge rule:** [`PRODUCTION_READINESS_BOUNDARY.md`](./PRODUCTION_READINESS_BOUNDARY.md) — deploy only when step 6 PASS on merge SHA.

---

## 7. Determinism rule

> **Any change in P1 must preserve deterministic output unless explicitly added as a controlled feature test with contract/amendment tracking.**

| Requirement | Verification |
|-------------|--------------|
| Same inputs → same `CompositionPlan` | `test_pipeline_deterministic_repeatability` / harness replay |
| Same inputs → same `RenderTree` | Composition plan equality / golden hash |
| Same inputs → same delivered-with-media `metadata` (frozen keys) | Hardening snapshots |

If output **must** change:

1. Classify as **RISK** or **BLOCKED** (likely amendment).
2. Update goldens only via documented bootstrap (`WRITE_HARDENING_SNAPSHOTS=1`) with audit.
3. CI operational model must PASS before merge.

**P3 rule:** Fixed snapshot + metadata → same adapter result (statelessness tests).

**P4 rule:** Never a determinism requirement for compose; eventual consistency only.

---

## 8. Debugging principle

When behavior regresses:

| Order | Action |
|-------|--------|
| **1** | Trace **P1** first: resolver → CSPP → media → viewer_sim |
| **2** | Validate **P3** assumptions: snapshot version, metadata snapshot, adapter mapping |
| **3** | Validate **P4** last: ingest lag, catalog projection, missing assets |

**Do not:**

* Add new layers or modules to “fix” coupling
* Introduce new contracts or enums
* Expand CI rules or add checkers
* Wire adapter or ingest into orchestrator

**Do:**

* Re-run `./scripts/ci-architecture-integrity.sh` and read classification (`STRUCTURAL_BLOCK`, `SEMANTIC_BLOCK`, `CROSS_LAYER_DRIFT_BLOCK`)
* Compare harness output to golden snapshots
* Check DGEL violation message for forbidden import

---

## 9. Feature addition philosophy

Add features by:

| Do | Don't |
|----|-------|
| Refining existing modules | Creating new “systems” or platforms |
| Extending tests in existing test modules | New enforcement binaries |
| Improving deterministic logic in P1 | New abstraction layers over pipeline |
| Hardening P3 mapping tables | New bind authority over `CompositionPlan` |
| Shipping P4 infra independently | Coupling P4 completion to semantic release gates |

**Minimal production slice reminder:** LEVEL 0 = P1 only; LEVEL 1 = P1 + optional P3; LEVEL 2 = P4 infra — see [`MINIMAL_PRODUCTION_SLICE.md`](./MINIMAL_PRODUCTION_SLICE.md).

---

## 10. Final rule

> **If a change requires a new architectural concept, it is NOT allowed.**  
> **It must be redesigned within existing P1 / P3 / P4 boundaries,**  
> **or deferred to formal contract amendment.**

Questions that mean **stop**:

* “Should we add a stage after viewer?”
* “Can ingest update RVE on completion?”
* “Should we add a new CI checker for X?”
* “Can we merge asset_state into media_state for convenience?”

---

## 11. Quick reference card

```text
 Layer │ Feature work? │ CI required?
───────┼───────────────┼──────────────────────────────────
  P1   │ Yes (main)    │ RISK: ci-architecture-integrity.sh
  P3   │ Yes (bind)    │ RISK: ci-architecture-integrity.sh
  P4   │ Yes (async)   │ SAFE locally; no semantic CI skip
  P2   │ Tests only    │ Always on merge (operational model)
```

```text
 Classify → Implement in zone → Test → CI (if RISK) → PR notes → Merge if PASS
```

---

## 12. Closing statement

> **This workflow enforces safe evolution strictly within the frozen ReelForge architecture without introducing new system boundaries, semantics, or enforcement layers.**

---

*End of Safe Feature Development Workflow v1.0.*
