# Thumbnail Vault Runtime Invariants (Mission 5.8)

Generated: 2026-07-12

**Module:** `frontend/src/lib/viewer/thumbnailInvariants.js`

**Enabled when:** `import.meta.env.DEV === true` OR `VITE_THUMBNAIL_INVARIANTS=true`

**Strict mode (throws):** `VITE_THUMBNAIL_INVARIANT_STRICT=true`

## Invariant catalog

| ID | Assertion | When checked |
|----|-----------|--------------|
| `HAS_STATE` | Every persisted entry has `vaultState` | `assertThumbnailVaultInvariants` |
| `CANONICAL_HAS_ID` | `vaultState === CANONICAL` implies non-empty `id` | After reconcile, append |
| `NO_GHOST_CANONICAL` | When backend reachable, canonical id must exist in backend reel set | After reconcile |
| `BACKEND_EMPTY_CANONICAL` | Backend has 0 thumb reels → no non-upload canonical entries | After reconcile |
| `TRANSIENT_NOT_ORPHAN` | blob/data URLs must not have `orphaned: true` | After reconcile |
| `NO_STALE_CANONICAL` | `classifyThumbnailEntry` stale cannot be CANONICAL | After reconcile |
| `NO_DUPLICATE_KEYS` | No duplicate `thumbnailEntryFileKey` in vault | After reconcile |
| `ORPHAN_NO_ID` | `orphaned: true` entries must not have synthetic `id` | After reconcile |
| `DELETE_MUST_REDUCE` | Successful delete must reduce collection length | After tombstone |

## Locked rules (architecture)

1. **No thumbnail without state** — `writeThumbnailVault` assigns `vaultState` if missing.
2. **No canonical thumbnail without id** — enforced in reconcile + invariants.
3. **Placeholder may never persist** — blob/data entries are `UPLOAD_PENDING`; not written as CANONICAL without id.
4. **Backend empty ⇒ canonical collection empty** (unless offline) — `syncFromVault` clears vault when `rawData.length === 0` and reachable.
5. **Index may never fabricate entries** — mirror written only by `writeThumbnailVault`; collection derived via `syncCollectionStore`.
6. **404 reel may never remain canonical** — `purgeGhostCanonical` + `failedIds`/`ghostIds` in tombstone.
7. **Delete success must reduce collection** — `assertDeleteReducedCount`.
8. **Delete failure must restore previous state** — non-404 API errors excluded from `failedIds`.
9. **No phantom catalog import** — `hydrateVaultFromReels` never seeds empty local vault from full backend catalog.
10. **Legacy strings must survive ingest** — `dedupeThumbEntries` preserves string entries; ingest upgrades them.

## Reconcile invariant matrix

| Entry class | Startup reconcile | Post-delete purge (`purgeMarkedOrphans`) |
|-------------|-------------------|----------------------------------------|
| `canonical` | Keep | Keep |
| `recoverable` | Keep → upgrade id | Keep |
| `active_upload` | Keep | Keep |
| `orphaned` | Keep (UI disabled) | **Purge** |
| `stale` | Purge | Purge |
| `ghost_canonical_404` | Purge | Purge |

## Call sites

| Location | Function | Invariants invoked |
|----------|----------|-------------------|
| `thumbnailVault.reconcileThumbnailVault` | post-purge | `assertThumbnailVaultInvariants` |
| `thumbnailVault.appendThumbnailVaultEntry` | post-append | `assertThumbnailVaultInvariants` (offline) |
| `VaultExperience.applyThumbnailDeleteTombstone` | post-delete | `assertDeleteReducedCount` |

## Dev verification

```bash
cd frontend
VITE_THUMBNAIL_INVARIANTS=true node scripts/mission-5.8-validate.mjs
MISSION_58_STRESS=100 MISSION_58_DELETE_STRESS=100 node scripts/mission-5.8-validate.mjs
```

## Violation log format

```
[THUMBNAIL_INVARIANT_VIOLATION] { name, message, ...detail }
```
