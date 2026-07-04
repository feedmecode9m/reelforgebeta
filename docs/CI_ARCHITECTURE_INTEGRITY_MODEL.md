# CI Architecture Integrity Model (Fusion Layer)

**Status:** Background reference (subordinate to operational model)  
**Version:** `1.0.1`  
**Project:** ReelForge / Smart Production Studio

**Authoritative for CI execution:** [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md)

---

## Purpose

This document records **why** DGEL and System Hardening were composed into one failure surface. **How** CI runs is defined exclusively in the operational model.

| Topic | Authoritative document |
|-------|------------------------|
| CI command, stage order, failure taxonomy | [`CI_OPERATIONAL_MODEL.md`](./CI_OPERATIONAL_MODEL.md) |
| System freeze and governance | [`REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`](./REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md) |
| DGEL policy detail | [`DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md`](./DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md) |

---

## Single entrypoint

```bash
./scripts/ci-architecture-integrity.sh
```

Do **not** invoke `ci-depgraph-check.sh` or `cargo test system_hardening` as separate CI steps.

---

## Historical composition rationale

Structural correctness (imports) and semantic correctness (pipeline outputs) are complementary. Running only one layer allows regressions to hide:

- DGEL pass + semantic fail → caught as `SEMANTIC_BLOCK`
- Semantic pass + DGEL fail → caught as `STRUCTURAL_BLOCK` or `CROSS_LAYER_DRIFT_BLOCK`

The fusion script unifies these into one exit code and one of three classifications.

---

*Subordinate to CI Operational Model v1.0.*
