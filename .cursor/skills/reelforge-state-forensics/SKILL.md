---
name: reelforge-state-forensics
description: Investigates and repairs impossible ReelForge frontend state (thumbnail vault, personalThumbnailCollection, localStorage vs backend divergence). Use when backend and UI disagree, phantom cards appear, DELETE 404s leave ghosts, validation passes but browser fails, or Mission 5.x thumbnail/vault work is requested.
---

# ReelForge State Forensics

## When to Use

- Backend reel count ≠ vault card count
- `personalThumbnailCollection` shows cards without `id` or with 404 ids
- Validation scripts pass but live browser fails
- Mission 5.5–5.8 thumbnail vault repair or investigation
- Suspected dual authority (index vs metadata vs collection store)

## Golden Rules

1. **Single source of truth**: `personal_thumbnails` (localStorage) — owned by `thumbnailVault.js`
2. **Collection is derived only**: `personalThumbnailCollection` via `syncCollectionStore` — never `createPersistentStore` on index
3. **Index is a mirror**: `personal_thumbnail_index` written only by `writeThumbnailVault`
4. **No phantom import**: never bootstrap empty local vault from full `GET /api/reels` catalog
5. **One reconcile path**: `reconcileThumbnailVault` — startup vs post-delete differ by `purgeMarkedOrphans`

## Investigation Workflow

Copy this checklist:

```
- [ ] Phase 1: Map state machine (vaultState on each entry)
- [ ] Phase 2: Ownership table (who creates/mutates/persists/renders/removes)
- [ ] Phase 3: Storage audit (canonical? may create? may delete?)
- [ ] Phase 4: Grep all create paths (personal_thumbnails writers)
- [ ] Phase 5: Grep all delete paths
- [ ] Phase 6: Find ownership violations
- [ ] Phase 7: Design single repair (remove code > add code)
- [ ] Phase 8: Implement via thumbnailVault.js only
- [ ] Phase 9: Lock invariants (thumbnailInvariants.js)
- [ ] Phase 10: Run mission validation suite
```

### Step 1 — Snapshot live divergence

```bash
# Backend thumb count
curl -s http://127.0.0.1:8080/api/reels | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('reels',len(d),'thumbs',sum(1 for r in d if '/thumbs/' in str(r.get('url',''))))
"

# In browser console
JSON.parse(localStorage.getItem('personal_thumbnails')||'[]').length
JSON.parse(localStorage.getItem('personal_thumbnail_index')||'[]').length
document.querySelectorAll('.vault-grid--images .vault-card').length
```

### Step 2 — Trace the pipeline

Read in order:

1. `frontend/src/lib/viewer/thumbnailVault.js` — owner
2. `frontend/src/viewer/viewerContext.js` — `syncFromVault`, `reloadVaultStoresFromStorage`
3. `frontend/src/components/experiences/VaultExperience.svelte` — upload/delete/reconcile UI
4. `frontend/src/lib/viewer/thumbnailCanonicalization.js` — classify/canonicalize
5. `frontend/src/lib/mediaBootstrap.js` — `ingestThumbReelsToVault` (update existing only)

### Step 3 — Grep create/delete violators

```bash
cd frontend/src
rg "personalThumbnailCollection\.(set|update)|localStorage\.setItem\([^)]*personal_thumbnails|storeThumbnailMetadata\(" -n
rg "deleteThumbnailVaultEntries|removeThumbnailVaultByIndex|writeThumbnailVault\(\[\]" -n
```

Any write outside `thumbnailVault.js` is a violation candidate.

## State Machine (summary)

| State | Persisted? | Notes |
|-------|------------|-------|
| `UPLOAD_PENDING` | No | `pendingThumbnail` blob only |
| `INGESTING` | Yes | Awaiting backend id |
| `CANONICAL` | Yes | Has `reel.id` |
| `ORPHANED` | Yes | `orphaned: true`, disabled checkbox; kept on startup, purged post-delete |
| `SELECTED` / `DELETING` | Never | UI-only |
| `PURGED` | No | Removed by reconcile |

Full diagram: [references/thumbnail-vault.md](references/thumbnail-vault.md)

## Reconcile Modes

| Context | `purgeMarkedOrphans` | `purgeGhostCanonical` |
|---------|---------------------|----------------------|
| Startup (`ensureThumbnailCanonicalization`, `reconcileStaleThumbnailsOnStartup`) | `false` | `true` |
| Post-delete (`purgeStaleOrphanThumbnails`) | `true` | `true` |
| Offline | skip reconcile | skip |

## Permanent Repair Pattern

| Concern | Owner |
|---------|-------|
| Source of truth | `personal_thumbnails` |
| Write | `writeThumbnailVault` / `appendThumbnailVaultEntry` |
| Delete | `deleteThumbnailVaultEntries` |
| Reconcile | `reconcileThumbnailVault` |
| Render keys | `syncCollectionStore` |

**Remove, don't add:**
- Stale snapshot re-write in `ensureThumbnailCanonicalization`
- `hydrateVaultFromReels` bootstrap-empty-local
- `createPersistentStore(THUMBNAIL_INDEX_KEY)` as render authority
- Direct `personalThumbnailCollection.update` for lifecycle

## Common Root Causes

| Symptom | Mechanism |
|---------|-----------|
| Backend 0, UI 20 cards | Index authoritative OR stale snapshot re-write OR catalog bootstrap |
| DELETE 404, count unchanged | Tombstone skipped; ghost id not in `failedIds`/`ghostIds` |
| Legacy string not selectable | `dedupeThumbEntries` dropped strings; ingest didn't match strings |
| Orphan flag lost on reload | `canonicalizeThumbnailEntries` upgraded orphaned entry via backend match |
| Validation pass, browser fail | Scripts count backend; UI reads stale index |

## Validation

```bash
cd frontend
# Full regression + 5.8 checks (default 10 stress; use 100 for full mission)
MISSION_58_STRESS=100 MISSION_58_DELETE_STRESS=100 node scripts/mission-5.8-validate.mjs

# Individual missions
node scripts/mission-5.5-validate.mjs
node scripts/mission-5.7.1-validate.mjs
node scripts/mission-5.7.2-validate.mjs
node scripts/mission-5.7.4-validate.mjs
```

Mission index: [references/validation.md](references/validation.md)

**Test harness pitfall**: `addInitScript` that clears `personal_thumbnails` on every navigation breaks reload tests. Guard with `sessionStorage` boot flag (see `mission-5.5-validate.mjs`).

## Invariants (dev)

Enable: `VITE_THUMBNAIL_INVARIANTS=true`  
Strict: `VITE_THUMBNAIL_INVARIANT_STRICT=true`

Watch console for `[THUMBNAIL_INVARIANT_VIOLATION]`. Module: `frontend/src/lib/viewer/thumbnailInvariants.js`.

## Output Artifacts (investigation missions)

When asked for full forensic output, produce:

- `frontend/THUMBNAIL_STATE_MACHINE.md`
- `frontend/THUMBNAIL_OWNERSHIP.md`
- `frontend/THUMBNAIL_INVARIANTS.md`
- `frontend/PERMANENT_REPAIR_REPORT.md`

## Additional Resources

- Ownership, storage matrix, create/delete paths: [references/thumbnail-vault.md](references/thumbnail-vault.md)
- Mission scripts and pass criteria: [references/validation.md](references/validation.md)
