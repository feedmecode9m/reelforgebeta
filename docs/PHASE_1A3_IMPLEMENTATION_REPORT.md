# Phase 1a.3 — Implementation Report

**Status:** Complete (migrations + model layer)  
**Stopped before:** `experience_resolve.rs`, `/api/experience/*`, Viewer wiring, `VITE_*` flags

**Contract references:**

- [`RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md`](./RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md)
- [`RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md`](./RESOLVED_VIEWER_EXPERIENCE_SCHEMA.md)
- [`MIGRATION_288_289_REVIEW.md`](./MIGRATION_288_289_REVIEW.md)

---

## 1. Deliverables

| Deliverable | Path | Status |
|-------------|------|--------|
| Migration 288 | `backend/migrations/202512288_viewer_experience_layer.sql` | Created |
| Migration 289 | `backend/migrations/202512289_experience_extensions.sql` | Created |
| Migration review | `docs/MIGRATION_288_289_REVIEW.md` | Created |
| Rust experience module | `backend/src/experience/` | Created |
| Schema validation | `backend/src/experience/contract.rs` | Created |
| Integration tests | `backend/src/experience/integration_tests.rs` | 9/9 pass |
| Env gate helper | `backend/src/db/mod.rs` → `experience_profiles_enabled()` | Created |

**Not created (by design):**

- `experience_resolve.rs`
- `api/experience.rs`
- Studio panels / Viewer consumption
- `VITE_REELFORGE_*` flags

---

## 2. Migration apply status

| Step | Result |
|------|--------|
| Review report | Complete |
| `sqlx migrate run` in CI/dev | Runs on startup via `db::run_migrations` when `DATABASE_URL` set |
| Local apply without `DATABASE_URL` | Skipped in this environment; tests that need DB run when URL present |

On next backend start with Postgres, migrations 288 and 289 apply automatically after 287.

---

## 3. Rust module map

| Module | Role | Resolver access |
|--------|------|---------------|
| `contract.rs` | RVE validation, reserved metadata keys, null-critical path constants | Public validate only |
| `profiles.rs` | Families, versions, publish, ACTIVE/pin reads | `loader` + future resolver |
| `platform_defaults.rs` | Platform baseline row | `loader` + future resolver |
| `layout_presets.rs` | Blueprint rows | `loader` + future resolver |
| `theme_tokens.rs` | Token sets | `loader` + future resolver |
| `metadata_registry.rs` | Definitions + values (write + scope read) | `loader` + future resolver |
| `slots.rs` | Slot assignments | `loader` + future resolver |
| `hierarchy.rs` | Episode chain + attachment + merge helpers | `loader` + future resolver |
| `provenance.rs` | Provenance entry builders | Future resolver |
| `loader.rs` | `pub(crate)` loaders only | Phase 1a.4 resolver |

---

## 4. Architecture compliance

| Rule | Status |
|------|--------|
| Contract-first columns only | Pass — see migration review §5 |
| Resolver sole composer | Pass — no resolve module yet; loaders are `pub(crate)` |
| No client-side merge in backend | Pass |
| No alternate bundle endpoints | Pass — none added |
| No Viewer / VITE / theater changes | Pass |
| No `experience_resolve.rs` yet | Pass — stopped per scope |

---

## 5. Integration test results

```
cargo test experience::   → 9 passed
```

| Test | Coverage |
|------|----------|
| `schema_validates_documentary_shape` | JSON Schema validation |
| `schema_rejects_missing_episode_label` | Null-critical |
| `schema_rejects_reserved_metadata_key` | `ai.*` namespace |
| `provenance_entry_serializes_contract_shape` | Provenance contract shape |
| `hierarchy_label_inheritance_merge` | Hierarchy merge helper |
| `active_version_selection_and_single_active` | ACTIVE + publish demotion |
| `pinned_version_rejects_draft` | Pin guard NC-103 |
| `hierarchy_attachment_load` | DB hierarchy walk |
| `profile_labels_override_at_draft_level` | Write path labels |

**Pending until Phase 1a.4 (resolver):**

- Full provenance map for all leaf fields
- Visibility intersection enforcement
- End-to-end RVE JSON from `resolve(episode_id)`

---

## 6. Platform config adjustment

`FeatureFlagsRow` extended with `experience_profiles` (migration 288). Queries in `platform_config.rs` updated. **No** experience composition added to `get_full_config`.

---

## 7. Phase 1a.4 readiness checklist

Before implementing `experience_resolve.rs`:

1. Confirm migrations 288/289 applied in target DB (`SELECT * FROM viewer_layout_presets` → 7 rows).
2. Implement `experience_resolve.rs` using only `experience::loader` and `provenance` helpers.
3. Validate every resolve output with `contract::validate_rve`.
4. Add `api/experience.rs` with write routes + `GET /resolve` only (no bundle/defaults routes).
5. Expand integration tests with golden RVE fixtures from contract §11.

---

## 8. Known gaps

| Gap | Phase |
|-----|-------|
| Campaign engine injector | 1b |
| Full provenance coverage test | 1a.4 |
| Hero PUT → `platform_experience_defaults` dual-write | 1a.4 |
| CI fixture JSON files under `tests/fixtures/rve/` | 1a.4 |

---

**Report path:** `docs/PHASE_1A3_IMPLEMENTATION_REPORT.md`
