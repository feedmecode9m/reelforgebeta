# Phase 1a.4 Query Budget Report

**Instrumentation:** `loader::QueryCounter` — incremented on each SQL round-trip in loader functions.  
**Debug logging:** `experience_resolve::resolve` prints `query_count` via `eprintln!` when built with debug assertions.

---

## Budget target

| Rule | Target |
|------|--------|
| RDR-200 | Log total after resolve (debug builds) |
| RDR-201 | ≤ 10 queries typical; hard assert ≤ 15 in tests |

---

## Query map (`load_resolve_bundle`)

| # | Function | Query |
|---|----------|-------|
| 1 | `load_hierarchy` | Episode → project chain + attachments |
| 2 | `load_platform_defaults` | `platform_experience_defaults` id=1 |
| 3–6 | `load_profile_layers` | Up to 4× ACTIVE or pinned version per level |
| 7 | `load_profile_for_attachment` | Winning attachment version (may overlap layer 6) |
| 8 | `load_family` | Family name for `experience_profile` |
| 9 | `load_layout_by_id` | Preset by winning/platform id |
| 10 | `load_layout_by_key` | `MINIMAL` fallback (only if id miss/inactive) |
| 11 | `load_theme_set` | Token set row |
| 12 | `load_theme_tokens` | Token key/value map |
| 13 | `load_metadata_chain` | **Batched** metadata for 4 scopes |
| 14 | `load_slots_chain` | **Batched** slots for platform + 4 scopes |

---

## Observed counts

| Scenario | Approx. queries |
|----------|-----------------|
| No profile attachment | 8–10 |
| Episode profile only | 11–13 |
| Full hierarchy attachments (4 families) | 13–14 |
| Unknown layout id (MINIMAL fallback) | +1 → 14–15 |

Test `rdr_200_query_count_bounded` asserts `0 < query_count ≤ 15` against a seeded episode.

---

## Optimizations applied (1a.4)

1. **Batched metadata** — single `SELECT` with OR across project/series/season/episode scopes (was 4 queries in 1a.3 loader stub).
2. **Batched slots** — single `SELECT` including `platform` scope (`scope_id IS NULL`).
3. **No resolver SQL** — composition is pure in-memory after bundle load.

---

## Not counted

- `contract::validate_rve` (in-memory JSON Schema)
- Migration runs in test setup

---

## Future reductions (post-1a.4)

| Opportunity | Phase |
|-------------|-------|
| Batch profile version lookups (`WHERE family_id = ANY(...)`) | 1a.5 perf |
| Cache `platform_experience_defaults` row | 1c+ (explicitly out of 1a.4 scope) |
| Combine layout + theme fetch | Optional |

---

## Debug sample

When running debug build:

```text
[experience_resolve] episode_id=... query_count=12
```

Use this line in staging to regression-test query growth as hierarchy attachments increase.
