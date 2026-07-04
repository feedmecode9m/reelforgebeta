# System Semantic Authority Map

**Phase:** 1c.6 — Canonical system-wide ontology  
**Status:** Normative authority map (documentation only)  
**Version:** `1.0.0`  
**Project:** ReelForge / Smart Production Studio  
**Companion audit:** [`PHASE_1C6_CLOSURE_CONSISTENCY_REPORT.md`](./PHASE_1C6_CLOSURE_CONSISTENCY_REPORT.md)

**Purpose:** Define what each concept means, which layer owns it, how it may change, and how information may flow between layers without semantic drift.

**This document does not authorize code, schema, API, or pipeline changes.**

---

## Table of Contents

1. [Truth Hierarchy](#1-truth-hierarchy)
2. [Core Concept Ontology](#2-core-concept-ontology)
3. [Mutability Rules](#3-mutability-rules)
4. [Allowed Transformation Graph](#4-allowed-transformation-graph)
5. [Conflict Resolution Rules](#5-conflict-resolution-rules)
6. [No New Semantics Rule](#6-no-new-semantics-rule)
7. [Amendment Protocol](#7-amendment-protocol)
8. [Quick Reference Tables](#8-quick-reference-tables)

---

## 1. Truth Hierarchy

When two layers disagree, resolution follows this order (highest wins for its domain):

```text
 Priority 1 (highest) — SEMANTIC EXPERIENCE TRUTH (1b, frozen)
   Resolver → CSPP → Media semantic → Viewer sim
   Owns: RVE shape, campaigns/slots delivery, metadata media enums, CompositionPlan

 Priority 2 — ADAPTER BIND TRUTH (1c.3, read-time)
   AssetResolutionAdapter
   Owns: SemanticMediaBinding + MaterializedAssetBundle for a given catalog snapshot
   Does NOT override RVE during pipeline; reconciles catalog vs media_reference at bind

 Priority 3 — ASSET CATALOG TRUTH (1c.1, eventually consistent)
   Authoritative asset_state, asset_id, scopes
   Fed by ingestion projection (future)

 Priority 4 (lowest) — INGESTION JOB TRUTH (1c.5, async mutable)
   ingestion_state, ingest events
   Never visible in RVE or CompositionPlan

 EXCLUDED FROM PRODUCTION TRUTH — SCENARIO REPLAY (1c.4)
   Test-only catalog timelines; zero production authority
```

### 1.1 Hierarchy rules

| ID | Rule |
|----|------|
| AUTH-1 | **1b pipeline output** is authoritative for `GET /api/experience/resolve` (and harness `run_from_base_rve`) today. |
| AUTH-2 | **Adapter** is authoritative for bind-time display class **only when invoked** with a catalog snapshot; it must not retroactively edit RVE from a prior resolve. |
| AUTH-3 | **Catalog** is authoritative for whether bytes exist; semantic `inventory_state` in RVE is a **view**, not a store (1c.1 REC, 1c.0 SEM-MEDIA-2). |
| AUTH-4 | **Ingestion** is authoritative for job progress only; semantic layers must not await it (1c.5 §7). |
| AUTH-5 | **Scenario** has no rank in production truth; tests may feed adapter only. |

---

## 2. Core Concept Ontology

### 2.1 Experience and composition (Semantic Layer — 1b)

| Concept | Definition | Owner | Wire location |
|---------|------------|-------|---------------|
| **Base RVE** | Resolver output; structural experience without campaign injection | Resolver | Full RVE JSON |
| **Delivered RVE** | Base + CSPP `campaigns[]` / `slots[]` | CSPP | Full RVE JSON |
| **Delivered with media** | Delivered + `metadata.media_*` | Media semantic | `metadata.*` |
| **RVE `schema_version`** | Contract version gate | Resolver + validator | top-level |
| **`resolve_context`** | Episode/project/paywall context | Resolver | RVE |
| **`layout`, `visibility`, `theme`, `labels`** | Structural presentation | Resolver | RVE |
| **`campaigns[]`** | Active campaign records bound to resolve | CSPP | RVE (empty in Base) |
| **`slots[]`** | Slot bindings with collision resolution | CSPP | RVE |
| **`CompositionPlan`** | Viewer render tree | Viewer sim | Separate artifact |

### 2.2 Media semantics (Semantic Layer — 1b)

| Concept | Definition | Owner | Allowed values (frozen) |
|---------|------------|-------|---------------------------|
| **`media_state`** | Viewer-facing media tier claim | Media semantic (pipeline); adapter (bind) | `REAL_MEDIA`, `DERIVED_MEDIA`, `PLACEHOLDER_MEDIA`, `FALLBACK_MEDIA` |
| **`inventory_state`** | Semantic inventory view | Media semantic | `PENDING`, `READY`, `MISSING`, `FAILED` |
| **`media_intent`** | Content-format presentation class | Media semantic | `MICRO_DRAMA`, `MUSIC_VIDEO`, `CLIP`, `DOCUMENTARY`, `UNKNOWN` |
| **`media_placeholder_policy`** | Placeholder ladder policy | Media semantic | `CONTENT_ONLY`, `CONTENT_THEN_*`, `FULLY_SYNTHETIC_ALLOWED` |
| **`media_reference`** | Opaque bind token | Media semantic | `episode:{uuid}`, `asset:{uuid}`, `null` |
| **`media_failure_mode`** | Failure representation | Media semantic / adapter | `none`, `missing_reference`, `stale_reference`, `delayed_availability` |
| **`media_reference_validity`** | Reference quality | Media semantic / adapter | `valid`, `absent`, `stale`, `pending` |
| **`thumbnail_resolution`** | Thumbnail tier decision (not a file) | Media semantic | `SHOULD_EXIST`, `ALLOW_DERIVED`, `MUST_PLACEHOLDER` |

### 2.3 Asset catalog (Asset Layer — 1c.1)

| Concept | Definition | Owner | Allowed values (frozen) |
|---------|------------|-------|---------------------------|
| **`asset_id`** | Stable asset key | Asset catalog | UUID (opaque) |
| **`asset_type`** | Media class | Asset catalog | `video`, `image`, `audio`, `derived` |
| **`asset_state`** | Catalog readiness | Asset catalog | `PENDING`, `PROCESSING`, `READY`, `FAILED` |
| **`asset_source`** | Provenance | Asset catalog | `upload`, `ingest`, `generated`, `external` |
| **`scope_episode_id` / `scope_reel_id`** | Binding scope hints | Asset catalog | UUID optional |
| **`thumbnail_asset_id`** | Linked thumb asset | Asset catalog | UUID optional |
| **`AssetInventoryRecord`** | Catalog row snapshot | Asset catalog | Struct (not in RVE) |

### 2.4 Ingestion domain (1c.5 — not in RVE)

| Concept | Definition | Owner | Allowed values |
|---------|------------|-------|----------------|
| **`ingestion_state`** | Job lifecycle position | Ingestion | `UPLOADED`, `VALIDATING`, `TRANSCODING`, `READY`, `FAILED` |
| **`ingest_job_id`** | Single attempt correlation | Ingestion | Opaque |
| **`Asset*Event`** | Transition description | Ingestion | Five event types (1c.5 §4) |

### 2.5 Bridge and bind (1c.2–1c.3)

| Concept | Definition | Owner |
|---------|------------|-------|
| **`AssetResolutionAdapter`** | Pure catalog → bind mapper | Adapter |
| **`MetadataSnapshot`** | RVE metadata subset for adapter input | Adapter (read) |
| **`SemanticMediaBinding`** | Reconciled bind view | Adapter (output) |
| **`MaterializedAssetBundle`** | `media_reference` → opaque handle map | Adapter (output) |
| **`AdapterResult`** | Binding + bundle pair | Adapter (output) |

### 2.6 Test simulation (1c.4 — non-authoritative)

| Concept | Definition | Owner |
|---------|------------|-------|
| **`AssetScenarioFeed`** | Deterministic step timeline of catalog snapshots | Test (`#[cfg(test)]`) |
| **`ScenarioStep`** | One labeled inventory vector | Test |
| **`MockAssetRegistry`** | In-memory catalog view for a step | Test |

### 2.7 Campaign domain (CSPP — 1b)

| Concept | Definition | Owner |
|---------|------------|-------|
| **`CampaignInput` / active campaigns** | DB-fed campaign rows | CSPP loader |
| **Hero collision group** | `hero_promo` single winner | CSPP |
| **Slot binding** | `slot_key` + scope → `campaign_id` | CSPP |

---

## 3. Mutability Rules

| Layer / subsystem | May mutate | Must never mutate |
|-------------------|------------|-------------------|
| **Resolver** | Base RVE structural fields | `campaigns[]` content from DB campaigns; asset fields |
| **CSPP** | `campaigns[]`, `slots[]` | Structural snapshot sections; `metadata.media_*` |
| **Media semantic** | `metadata.media_*` | `campaigns[]`, layout, asset catalog |
| **Viewer sim** | `CompositionPlan` | RVE JSON |
| **Adapter** | Nothing persistent | RVE, catalog, pipeline artifacts |
| **Ingestion** | Catalog rows (future), emit events | RVE, CompositionPlan, semantic enums |
| **Scenario** | Test inventory vectors | Any production state |
| **Production pipeline** | Per-request artifacts only | Cross-request hidden state |

**MUT-1:** Only **ingestion** (future runtime) may initiate time-varying catalog mutations in production.

**MUT-2:** Semantic Layer modules are **immutable in contract** — behavior changes require amendment (§7).

**MUT-3:** Adapter and scenario are **derived/read-only** with respect to authority stores.

---

## 4. Allowed Transformation Graph

Only these transformations are permitted. All other edges are **forbidden** (see 1c.6 report §6).

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         SEMANTIC LAYER (sync)                            │
│                                                                          │
│  [DB profiles/layout] ──► Resolver ──► Base RVE                         │
│                              │                                           │
│                              ▼                                           │
│  [DB campaigns/slots] ──► CSPP ──► Delivered RVE                        │
│                              │                                           │
│                              ▼                                           │
│                    Media semantic ──► Delivered + metadata.media_*       │
│                              │                                           │
│                              ▼                                           │
│                    Viewer sim ──► CompositionPlan                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    ASSET LAYER (async, mutable)                          │
│                                                                          │
│  [Upload] ──► Ingestion events ──► (future) catalog projector           │
│                      │                      │                            │
│                      │                      ▼                            │
│                      │            AssetInventoryRecord[]                 │
│                      │                      │                            │
└──────────────────────┼──────────────────────┼────────────────────────────┘
                       │                      │
                       │    (read snapshot)   │
                       │                      ▼
                       │            AssetResolutionAdapter
                       │                      │
                       │                      ▼
                       │         SemanticMediaBinding + MaterializedAssetBundle
                       │                      │
                       └──────────(forbidden)─┴──► must NOT feed back to
                                                    Resolver/CSPP/Media/Viewer sim

┌─────────────────────────────────────────────────────────────────────────┐
│                    TEST ONLY (1c.4)                                      │
│  AssetScenarioFeed ──► MockAssetRegistry ──► Adapter (in tests only)   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Transformation legality table

| Transform | Allowed? | Deterministic? |
|-----------|----------|----------------|
| Resolver(Base inputs) → Base RVE | ✅ | ✅ |
| CSPP(Base) → Delivered | ✅ | ✅ |
| Media(Delivered) → Delivered+media | ✅ | ✅ |
| Viewer(Base, Delivered+media) → Plan | ✅ | ✅ |
| Ingestion → events | ✅ (future) | ❌ (async) |
| Events → catalog `asset_state` | ✅ (future) | ❌ (eventual) |
| Catalog snapshot + ref → Adapter → Binding | ✅ | ✅ per snapshot |
| Adapter → RVE rewrite | ❌ | — |
| Scenario → pipeline | ❌ | — |
| Ingestion → semantic pipeline | ❌ | — |

---

## 5. Conflict Resolution Rules

| Conflict | Resolution rule | Authority |
|----------|-----------------|-----------|
| Pipeline `media_state` vs adapter bind `media_state` | At resolve time: **pipeline RVE** wins for `CompositionPlan`. At display bind: **adapter** wins for pixels/handles. Do not merge into RVE without amendment. | AUTH-1, AUTH-2 |
| Semantic `inventory_state` vs catalog `asset_state` | Catalog wins for bytes; semantic wins for RVE text until bind; adapter maps catalog → binding fields | AUTH-3, 1c.1 §5 |
| `PROCESSING` (catalog) vs `PENDING` (semantic) | Adapter maps catalog `PROCESSING` → binding `inventory_state: PENDING` | 1c.2 step 3, CL-01 |
| Missing catalog row vs `MISSING` semantic | Adapter step 1/8 → `FALLBACK_MEDIA` | 1c.2 |
| Ingestion `FAILED` vs semantic `FAILED` | Catalog `FAILED` → adapter `FAILED` binding + `FALLBACK_MEDIA` | 1c.5 §5, 1c.2 step 2 |
| Scenario vs production catalog | Production catalog (or empty) wins; scenario never deployed | AUTH-5 |
| Campaign winner vs media readiness | CSPP **ignores** media; collision uses priority only | CSPP-6 |
| `DERIVED_MEDIA` vs trinary collapse | `DERIVED_MEDIA` allowed only as READY representation, not failure | ASCL §3.2 |

---

## 6. No New Semantics Rule

**SSAM-EXP-1:** No subsystem may introduce new wire values for frozen semantic enums (`media_state`, `inventory_state`, `media_intent`, `media_failure_mode`, `media_reference_validity`, `media_placeholder_policy`, `thumbnail_resolution`) without the amendment protocol (§7).

**SSAM-EXP-2:** No subsystem may introduce new **failure presentation classes** beyond the canonical bind collapse: `REAL_MEDIA`, `PLACEHOLDER_MEDIA`, `FALLBACK_MEDIA` (with `DERIVED_MEDIA` as existing representation-only wire per 1b.7).

**SSAM-EXP-3:** Asset and ingestion domains may add **implementation-internal** codes in event payloads (`failure_code`, `profile_key`) — **must not** surface in RVE JSON.

**SSAM-EXP-4:** `asset_state` and `ingestion_state` enums are frozen per 1c.1 and 1c.5; extensions require separate asset-schema versioning, not silent RVE metadata keys.

**SSAM-EXP-5:** Scenario feeds **must not** define new semantic concepts — only replay catalog snapshots.

**SSAM-EXP-6:** Adapter **must not** invent mapping rows beyond 1c.2 §5.1 without contract revision.

---

## 7. Amendment Protocol

### 7.1 When amendment is required

| Change type | Requires amendment? |
|-------------|---------------------|
| New `media_state` or failure enum in RVE | **Yes** |
| Insert adapter into `compose_pipeline` | **Yes** |
| Ingestion writes RVE metadata | **Yes** |
| New semantic pipeline stage | **Yes** |
| New asset-only event payload field (opaque) | No (if not in RVE) |
| New ingestion service implementation obeying 1c.5 | No (if gates satisfied) |
| Production Viewer bind using adapter | **Yes** (integration amendment; may not change §5.1 table without review) |

### 7.2 Amendment steps (ordered)

1. Publish revision to [`ASSET_SEMANTIC_CONTRACT_LOCK.md`](./ASSET_SEMANTIC_CONTRACT_LOCK.md) with incremented version and broken rule IDs.
2. Update affected phase docs (`PHASE_1B7`, `PHASE_1C*`, this map).
3. Update [`PHASE_1C6_CLOSURE_CONSISTENCY_REPORT.md`](./PHASE_1C6_CLOSURE_CONSISTENCY_REPORT.md) contradiction register if new CL-* entries appear.
4. Extend contract-lock / adapter / scenario tests in **existing** test modules.
5. If RVE wire enums change: bump `schema_version` via separate schema amendment (independent gate).

### 7.3 Emergency prohibition

Changes that violate §6 without amendment are **architecturally void** — must not merge to main regardless of test passage.

---

## 8. Quick Reference Tables

### 8.1 Layer → concept ownership

| Layer | Owns concepts |
|-------|---------------|
| Resolver | Base RVE structure, `resolve_context`, empty `campaigns[]` |
| CSPP | `campaigns[]`, `slots[]`, collision winners |
| Media semantic | All `metadata.media_*` in pipeline |
| Viewer | `CompositionPlan` |
| Catalog | `asset_*` fields, scopes, thumb links |
| Ingestion | `ingestion_state`, `Asset*Event` |
| Adapter | `SemanticMediaBinding`, `MaterializedAssetBundle` |
| Scenario | Test inventory timelines only |

### 8.2 State namespace cheat sheet

| Namespace | Example values | In RVE? |
|-----------|----------------|---------|
| `ingestion_state` | `TRANSCODING` | **No** |
| `asset_state` | `PROCESSING` | **No** |
| `inventory_state` | `MISSING` | **Yes** (`metadata`) |
| `media_state` | `FALLBACK_MEDIA` | **Yes** (`metadata`) |

### 8.3 Canonical documents by question

| Question | Read first |
|----------|------------|
| What is frozen in 1b? | `PHASE_1B7_CONTRACT_LOCK.md` |
| What can assets do? | `PHASE_1C1`, `PHASE_1C_BOUNDARY.md` |
| How does adapter map? | `PHASE_1C2`, `ASSET_SEMANTIC_CONTRACT_LOCK.md` |
| How does ingest work? | `PHASE_1C5` |
| Is architecture closed? | `PHASE_1C6_CLOSURE_CONSISTENCY_REPORT.md` |
| Who owns this term? | **This document** |

---

## Verdict

| Criterion | Status |
|-----------|--------|
| Ontology complete for 1b + 1c | ✅ |
| Truth hierarchy defined | ✅ |
| Transformation graph defined | ✅ |
| Conflict rules defined | ✅ |
| No new semantics rule stated | ✅ |
| Amendment protocol defined | ✅ |

**This map is the canonical semantic authority reference for ReelForge Phase 1c.6 onward.**

---

*End of System Semantic Authority Map.*
