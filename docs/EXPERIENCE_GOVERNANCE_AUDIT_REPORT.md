# Experience Governance Audit Report — Phase 1a.6

**Date:** 2026-06-03  
**Status:** Normative audit (read-only validation)  
**Authority baseline:** [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md) (frozen, authoritative)  
**Compared against:**

- [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md)
- [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md)
- [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md)
- [`RESOLVER_BOUNDARY_AUDIT.md`](./RESOLVER_BOUNDARY_AUDIT.md)
- [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md)

**Observational references (not modified):** `backend/src/experience/profiles.rs`, `backend/src/experience/experience_resolve.rs`, `schemas/resolved_viewer_experience.schema.json`

**Scope:** Cross-document contradiction analysis and Phase 1b readiness verdict. No code, schema, API, migration, or governance contract changes were made.

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Findings total | 12 |
| Critical contradiction | 1 |
| Governance drift | 3 |
| Resolver drift | 2 |
| Future implementation risk | 4 |
| Informational | 2 |

**Phase 1b readiness verdict:** **PASS WITH CONDITIONS**

The governance contract is a usable authoritative baseline. One **critical contradiction cluster** (pinned ARCHIVED in production resolve) spans RVE contract, schema, RDR, boundary audit, and running code. Campaign Engine **architecture** may proceed; **implementation merge** for 1b must not proceed until remediation inventory items **REM-001 through REM-004** are accepted and scheduled.

---

## Methodology

1. Each governance rule family (G*, LC-*, PW-*, PI-*, RB-*, VL-*, AG-*, OS-*) was checked against the five upstream normative documents.
2. Where upstream docs conflict with governance, governance is treated as **authoritative** for operational policy (per Phase 1a.6 charter).
3. Rust implementation was reviewed **observationally** for resolver drift only; no files were edited.
4. Findings are classified into five categories and assigned stable IDs **F-001** through **F-012**.

---

## Alignment Matrix

Legend: **ALIGNED** | **DRIFT** (upstream looser/conflicting) | **N/A** (not addressed upstream)

| Governance rule / topic | RVE Contract | Schema Doc | RDR | Boundary Audit | Media Contract | Implementation (obs.) |
|-------------------------|--------------|------------|-----|----------------|----------------|-------------------------|
| **G1** Resolver sole composer | ALIGNED §5, S3 | ALIGNED | ALIGNED RDR-000 | ALIGNED §1 | ALIGNED §4 | ALIGNED |
| **G2** Studio writes only | ALIGNED §1, S2 | N/A | N/A | ALIGNED write-only | N/A | ALIGNED |
| **G3** Viewer consumes RVE only | ALIGNED §1, S1, §12.1 | N/A | N/A | ALIGNED | ALIGNED §4.2 | N/A (Viewer out of scope) |
| **G4** No ad-hoc DB edits | N/A | N/A | N/A | N/A | N/A | N/A (ops policy) |
| **G5** Traceability | N/A | N/A | N/A | N/A | N/A | DRIFT — no audit store |
| **LC-01** Single ACTIVE per family | ALIGNED §10.3 | N/A | N/A | N/A | N/A | ALIGNED `publish_version` |
| **LC-02** DRAFT not in production resolve | ALIGNED §5.2, §10.3 | ALIGNED NC-103 | ALIGNED RDR-031 | ALIGNED §2.1 | N/A | ALIGNED |
| **LC-03** ARCHIVED never production-resolved | **DRIFT** §5.2, §8.2 | **DRIFT** enum | **DRIFT** RDR-034 | **DRIFT** §live events | N/A | **DRIFT** |
| **LC-04** DRAFT→ACTIVE via publish only | ALIGNED §10.3 | N/A | N/A | N/A | N/A | ALIGNED |
| **LC-05** ACTIVE→ARCHIVED via publish | ALIGNED §10.3 | N/A | N/A | N/A | N/A | ALIGNED |
| **LC-06** Pin must target ACTIVE | **DRIFT** §5.2 | N/A | **DRIFT** RDR-034 | **DRIFT** | N/A | **DRIFT** |
| **PW-01–03** Validate before publish | ALIGNED §10 | ALIGNED | ALIGNED RDR-150 (resolve) | N/A | N/A | Partial — publish path not fully audited |
| **PI-01–05** Preview isolation | **DRIFT** §12.2 | N/A | N/A | N/A | ALIGNED preview channel | **DRIFT** — single prod API |
| **RB-01–04** Clone rollback only | ALIGNED (architecture) | N/A | N/A | N/A | N/A | ALIGNED clone/publish APIs exist |
| **VL-01–05** Lineage | ALIGNED (architecture) | N/A | N/A | N/A | N/A | ALIGNED |
| **AG-01–03** Attachments Studio-only | ALIGNED §5.2 | N/A | ALIGNED RDR-012 | ALIGNED | N/A | ALIGNED |
| **§10.1** campaigns[] deferral | ALIGNED §8.8 (1b) | ALIGNED | ALIGNED RDR-130 | ALIGNED 1b | N/A | ALIGNED RDR-130 impl |
| **Media** resolver semantic only | N/A (future §) | N/A | N/A | N/A | ALIGNED | ALIGNED — no media block yet |

---

## Contradiction Register

### F-001 — Pinned ARCHIVED allowed in production resolve

| Field | Value |
|-------|-------|
| **Classification** | Critical contradiction |
| **Severity** | Critical |
| **Source documents** | Governance: LC-03, LC-06, AG-02, §12.1 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RVE: §5.2, §8.2 — [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md). Schema doc: §5 enum — [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md). JSON Schema: `profileStatus` — [`schemas/resolved_viewer_experience.schema.json`](../schemas/resolved_viewer_experience.schema.json). RDR: RDR-034 — [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md). Boundary: live events row — [`RESOLVER_BOUNDARY_AUDIT.md`](./RESOLVER_BOUNDARY_AUDIT.md). Code: `get_pinned_version`, `build_experience_profile` — `profiles.rs`, `experience_resolve.rs` |
| **Description** | Governance states ARCHIVED versions are **never** production-resolved and pins **must** reference ACTIVE rows only. RVE contract §5.2 permits `pin_version = true` with `experience_profile_version_id` that **may be ARCHIVED** (Studio warning). Schema allows `experience_profile.status` = `ARCHIVED`. RDR-034 requires output status to reflect pinned row including ARCHIVED. Boundary audit explicitly allows “Pinned ARCHIVED allowed with warning.” Implementation `get_pinned_version` rejects DRAFT only and returns ARCHIVED rows; resolver emits `status: "ARCHIVED"` when pinned. Two normative doc families cannot both be followed for the same pin configuration. |
| **Recommended remediation** | See REM-001, REM-002, REM-003, REM-004. Governance baseline is authoritative; upstream docs and code should converge on reject ARCHIVED pins in production resolve. |
| **Blocks Phase 1b?** | **Yes** (for 1b **implementation** that binds campaigns to profile version epochs without ambiguous ACTIVE/ARCHIVED semantics) |

---

### F-002 — RDR-034 contradicts LC-03

| Field | Value |
|-------|-------|
| **Classification** | Governance drift |
| **Severity** | High |
| **Source documents** | Governance: LC-03 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RDR: RDR-034 — [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md) |
| **Description** | RDR-034 normatively permits `experience_profile.status` = `ARCHIVED` when pinned. Governance LC-03 forbids resolving ARCHIVED in production. RDR is implementation-normative for Phase 1a.4 and directly conflicts with governance. |
| **Recommended remediation** | REM-002: Amend RDR-034 to “status reflects resolved row; must be ACTIVE for production; reject ARCHIVED pin with NC-106.” |
| **Blocks Phase 1b?** | **Yes** (dependency of F-001) |

---

### F-003 — RVE contract §8.2 permits ARCHIVED in RVE output

| Field | Value |
|-------|-------|
| **Classification** | Governance drift |
| **Severity** | High |
| **Source documents** | Governance: LC-03, §2.1 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RVE: §8.2 `experience_profile.status` — [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md) |
| **Description** | RVE wire contract documents `status` enum as `ACTIVE` or `ARCHIVED` (pinned only for ARCHIVED). Governance resolver visibility table marks ARCHIVED as **never** resolved. Production RVE payloads must not carry ARCHIVED status under governance. |
| **Recommended remediation** | REM-001: Amend RVE §5.2 and §8.2 — production resolve emits `ACTIVE` only; ARCHIVED pins are invalid attachment configuration. |
| **Blocks Phase 1b?** | **Yes** (dependency of F-001) |

---

### F-004 — Boundary audit allows pinned ARCHIVED

| Field | Value |
|-------|-------|
| **Classification** | Governance drift |
| **Severity** | Medium |
| **Source documents** | Governance: LC-03, §12.1 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). Boundary: §1.3 live events — [`RESOLVER_BOUNDARY_AUDIT.md`](./RESOLVER_BOUNDARY_AUDIT.md) |
| **Description** | Boundary audit documents pinned ARCHIVED as allowed with Studio warning. Governance §12.1 explicitly tightens policy and defers implementation alignment. |
| **Recommended remediation** | REM-003: Update boundary audit live-events row to match governance; reference NC-106. |
| **Blocks Phase 1b?** | **No** (documentation alignment; subordinate to F-001) |

---

### F-005 — Resolver accepts pinned ARCHIVED rows

| Field | Value |
|-------|-------|
| **Classification** | Resolver drift |
| **Severity** | Critical |
| **Source documents** | Governance: LC-03, LC-06, AG-02 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). Code: `profiles.rs` `get_pinned_version`, `experience_resolve.rs` `build_experience_profile` |
| **Description** | Loader pin path returns any non-DRAFT version including ARCHIVED. Resolver builds `experience_profile` with `status` ACTIVE or ARCHIVED. No 422 equivalent to NC-103 exists for ARCHIVED pins. |
| **Recommended remediation** | REM-004: Reject pinned ARCHIVED in loader/resolver; return 422 with code NC-106 (proposed). |
| **Blocks Phase 1b?** | **Yes** |

---

### F-006 — No NC code for ARCHIVED pin

| Field | Value |
|-------|-------|
| **Classification** | Resolver drift |
| **Severity** | Medium |
| **Source documents** | Governance: LC-06, §3.4 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). Schema doc: NC-103 — [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md) |
| **Description** | NC-103 covers pinned DRAFT only. Governance treats pinned ARCHIVED as configuration error with resolve failure expectation (§3.4 “resolve may fail attachment rules”). No registered NC code exists. |
| **Recommended remediation** | REM-005: Add NC-106 to schema doc and API error mapping (doc + future code). |
| **Blocks Phase 1b?** | **No** (if F-005 scheduled; otherwise **Yes** as part of F-001 cluster) |

---

### F-007 — Studio preview via production resolve endpoint

| Field | Value |
|-------|-------|
| **Classification** | Future implementation risk |
| **Severity** | Medium |
| **Source documents** | Governance: PI-01–PI-05, §4 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RVE: §12.2 — [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md) |
| **Description** | Governance requires isolated Preview Resolve (no Viewer/cache impact, DRAFT-capable, non-authoritative labeling). RVE §12.2 states Studio may preview “only via cached `GET /api/experience/resolve`” — the current production path, which cannot resolve DRAFT per LC-02. Risk: Studio uses production resolve for draft preview, violating PI-03/PI-04 when DRAFT preview is needed. |
| **Recommended remediation** | REM-006: Future `GET /api/experience/preview` or `X-Reelforge-Preview: true` path per governance §4.3; amend RVE §12.2 when shipped. |
| **Blocks Phase 1b?** | **No** |

---

### F-008 — Campaign injector must preserve G1–G3

| Field | Value |
|-------|-------|
| **Classification** | Future implementation risk |
| **Severity** | High |
| **Source documents** | Governance: G1–G3, §10.1, §11 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RDR: RDR-130, RDR-004 — [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md). Boundary: Phase 1b injector — [`RESOLVER_BOUNDARY_AUDIT.md`](./RESOLVER_BOUNDARY_AUDIT.md) |
| **Description** | Phase 1b will add `campaign_injector` inside resolver. Governance requires injector to remain metadata-only, no writes, no layout mutation. RDR-130 currently forces `campaigns[]` empty. Risk of campaign URLs or layout keys leaking into RVE (NC-105 territory). |
| **Recommended remediation** | REM-007: 1b design review checklist against G1, S4 (RVE), NC-105; extend RDR with campaign merge rules. |
| **Blocks Phase 1b?** | **No** for architecture; **Yes** for merge without checklist |

---

### F-009 — Audit requirements not implemented

| Field | Value |
|-------|-------|
| **Classification** | Future implementation risk |
| **Severity** | Medium |
| **Source documents** | Governance: §8, G5 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md) |
| **Description** | Governance defines mandatory audit fields and critical events (publish, clone, pin). No audit storage or emitters exist. Phase 1b campaign and attachment changes will lack traceability until audit service ships. |
| **Recommended remediation** | REM-008: Schedule audit subsystem post-1a.6; interim structured application logs for publish/pin. |
| **Blocks Phase 1b?** | **No** (explicit non-goal §8.3) |

---

### F-010 — Media block not in RVE; governance alignment pending

| Field | Value |
|-------|-------|
| **Classification** | Future implementation risk |
| **Severity** | Low |
| **Source documents** | Governance: G1 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). Media: §4 — [`MEDIA_REPRESENTATION_CONTRACT.md`](./MEDIA_REPRESENTATION_CONTRACT.md) |
| **Description** | Media contract reserves semantic fields and forbids resolver URL/thumbnail selection. No `media` section in current RVE schema. Future addition must not violate G1 or AP-M01–M08 from media contract. |
| **Recommended remediation** | REM-009: When adding media to RVE, amend RVE + RDR together; loader provides opaque handles only. |
| **Blocks Phase 1b?** | **No** |

---

### F-011 — Provenance completeness vs RDR-140

| Field | Value |
|-------|-------|
| **Classification** | Informational |
| **Severity** | Low |
| **Source documents** | Governance: G5 (traceability) — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md). RDR: RDR-140, NC-101 — [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md), [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md) |
| **Description** | RDR-140 requires provenance for every leaf field. Schema enforces minimum six provenance keys. Resolver implements partial provenance map. Not a governance contradiction; schema minimum is satisfied. |
| **Recommended remediation** | REM-010: Optional hardening — expand provenance in resolver or relax RDR-140 to “minimum + emitted leaves.” |
| **Blocks Phase 1b?** | **No** |

---

### F-012 — Governance exit criteria self-assessment in contract

| Field | Value |
|-------|-------|
| **Classification** | Informational |
| **Severity** | Low |
| **Source documents** | Governance: §10 — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md) |
| **Description** | Governance §10 marks documentation criteria ✅ before this audit. Phase 1a.6 adds cross-doc validation as the gate artifact. Audit report now satisfies “governance validated against upstream.” |
| **Recommended remediation** | None required. Reference this report from Phase 1b kickoff. |
| **Blocks Phase 1b?** | **No** |

---

## Findings by Classification

| Classification | IDs |
|----------------|-----|
| **Critical contradiction** | F-001 |
| **Governance drift** | F-002, F-003, F-004 |
| **Resolver drift** | F-005, F-006 |
| **Future implementation risk** | F-007, F-008, F-009, F-010 |
| **Informational** | F-011, F-012 |

---

## Remediation Inventory

No items below are implemented in Phase 1a.6. Owner phases are recommendations.

| Rem-ID | Type | Description | Related findings | Owner phase | Blocks 1b implementation? |
|--------|------|-------------|------------------|-------------|----------------------------|
| **REM-001** | Documentation | Amend RVE contract §5.2 and §8.2: production resolve uses ACTIVE only; remove “ARCHIVED when pinned” from normative resolve path | F-001, F-003 | Pre-1b doc PR | **Yes** |
| **REM-002** | Documentation | Amend RDR-034; add RDR pin rule rejecting ARCHIVED; reference NC-106 | F-001, F-002 | Pre-1b doc PR | **Yes** |
| **REM-003** | Documentation | Update RESOLVER_BOUNDARY_AUDIT §live events — pinned ARCHIVED not allowed | F-004 | Pre-1b doc PR | No |
| **REM-004** | Code | `get_pinned_version` / loader: reject ARCHIVED pins; resolver 422 | F-001, F-005 | Hardening sprint | **Yes** |
| **REM-005** | Documentation + code | Register NC-106 “Pinned profile version cannot be ARCHIVED” in schema doc and API | F-006 | Pre-1b doc + hardening | **Yes** (with REM-004) |
| **REM-006** | API + documentation | Isolated preview resolve per PI-01–PI-05; amend RVE §12.2 | F-007 | Studio preview phase | No |
| **REM-007** | Process | 1b campaign injector review checklist (G1, NC-105, RDR-130 replacement) | F-008 | Phase 1b kickoff | **Yes** without checklist |
| **REM-008** | Implementation | Audit event store per governance §8 | F-009 | Post-1b | No |
| **REM-009** | Documentation + schema | Media block schema amendment per MEDIA_REPRESENTATION_CONTRACT | F-010 | Future 1a.x | No |
| **REM-010** | Code (optional) | Full leaf provenance vs RDR-140 | F-011 | Optional | No |

### Blocking cluster (must be accepted before 1b code merge)

```
REM-001 + REM-002 + REM-004 + REM-005  (ARCHIVED pin semantics)
REM-007                                 (campaign injector governance review)
```

---

## Phase 1b Readiness Verdict

### **PASS WITH CONDITIONS**

| Criterion | Assessment |
|-----------|------------|
| Governance baseline authoritative and complete | **Pass** — [`EXPERIENCE_GOVERNANCE_CONTRACT.md`](./EXPERIENCE_GOVERNANCE_CONTRACT.md) unchanged; all 11 sections present |
| Cross-doc validation performed | **Pass** — this report |
| Critical contradictions documented | **Pass** — F-001 cluster |
| Remediation path defined without implementation | **Pass** — REM-001+ |
| Campaign architecture can begin | **Pass with conditions** — design/docs may start; **implementation** blocked on REM-001/002/004/005 acceptance |

**Not BLOCKED because:** Governance is internally consistent and sufficient to guide 1b design. Contradictions are **documented and bounded** (primarily ARCHIVED pin semantics), with explicit remediation owners.

**Conditions for 1b implementation merge:**

1. Accept remediation inventory blocking cluster (REM-001, REM-002, REM-004, REM-005).
2. Complete REM-007 checklist before merging campaign injector code.
3. Do not treat RVE §5.2 / RDR-034 / boundary audit live-events row as authoritative over governance until REM-001–003 land.

---

## Document Change Log (Phase 1a.6)

| File | Action |
|------|--------|
| `docs/EXPERIENCE_GOVERNANCE_CONTRACT.md` | **No change** (frozen) |
| `docs/EXPERIENCE_GOVERNANCE_AUDIT_REPORT.md` | **Created** (this file) |
| Rust, migrations, APIs, Viewer, schema JSON | **No change** |

---

**Report path:** `docs/EXPERIENCE_GOVERNANCE_AUDIT_REPORT.md`
