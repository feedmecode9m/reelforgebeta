# Phase 1a.4 Test Report

**Command:** `cargo test experience::`  
**Date:** 2026-06-03  
**Result:** **22 passed**, 0 failed

---

## Test inventory

### Schema / contract (`integration_tests.rs`)

| Test | Purpose |
|------|---------|
| `schema_validates_documentary_shape` | Embedded schema accepts minimal valid RVE |
| `schema_rejects_missing_episode_label` | NC null-critical `labels.episode_label` |
| `schema_rejects_reserved_metadata_key` | Reserved namespace guard |
| `provenance_entry_serializes_contract_shape` | Provenance entry wire shape |
| `hierarchy_label_inheritance_merge` | `merge_optional_string` child-wins |
| `active_version_selection_and_single_active` | Publish demotes prior ACTIVE |
| `pinned_version_rejects_draft` | NC-103 loader path |
| `hierarchy_attachment_load` | `load_hierarchy_context` |
| `profile_labels_override_at_draft_level` | Draft label writes |

### Resolver merge rules (`resolve_tests.rs`)

| Test | RDR rule(s) |
|------|-------------|
| `rdr_001_resolver_no_direct_sql` | RDR-001 — no `sqlx::query` in resolver |
| `rdr_020_episode_not_found` | RDR-020 |
| `rdr_024_enforce_paywall_false` | RDR-023 / RDR-024 |
| `rdr_030_omit_experience_profile` | RDR-030 |
| `rdr_031_pinned_draft_rejected` | RDR-031 / NC-103 |
| `rdr_032_active_version_unpinned` | RDR-032 |
| `rdr_041_episode_label_from_profile` | RDR-040 / RDR-041 |
| `rdr_062_panel_intersection` | RDR-060–063 |
| `rdr_090_unknown_layout_fallback` | RDR-090 |
| `rdr_111_metadata_later_scope_wins` | RDR-110 / RDR-111 |
| `rdr_130_campaigns_empty` | RDR-130 / RDR-004 |
| `rdr_150_validate_on_resolve` | RDR-150 / RDR-005 |
| `rdr_200_query_count_bounded` | RDR-200 / RDR-201 |

---

## Prerequisites

DB-backed tests require:

- `DATABASE_URL` set to a Postgres instance with migrations through **289**
- Seeded `studio_episodes` row (existing ReelForge seed data)

Without `DATABASE_URL`, DB tests skip gracefully via early return (integration tests from 1a.3 behave the same).

---

## Coverage gaps (acceptable for 1a.4)

Rules documented in [`RESOLVER_DECISION_RECORD.md`](./RESOLVER_DECISION_RECORD.md) without dedicated tests yet:

- RDR-011 platform-only baseline (implicit in `rdr_150`)
- RDR-051–055 hero enum variants (platform seed uses v2 enums)
- RDR-120–122 slot deduplication edge cases (no slot seed data)
- RDR-140 full leaf provenance map (minimum keys only enforced by schema)

These are covered by code review and schema validation on every resolve; add targeted tests when seed fixtures expand.

---

## CI recommendation

```bash
cd backend
export DATABASE_URL=postgres://...
cargo test experience::
```

Static guard `rdr_001_resolver_no_direct_sql` runs without database.
