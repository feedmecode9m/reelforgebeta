# BG-DELETE-VAULT-03 — Authenticated Delete Flow

**Date:** 2026-07-27  
**Scope:** Minimal frontend patch. Backend API unchanged. Reconciliation/merge/viewer/theater/upload untouched.

---

## Summary

Vault MP4 delete now mirrors upload auth rules: no session → login prompt; DELETE failure → error + no sync; success → local purge + `syncFromVault(true)` + ✅ message.

---

## Files changed

| File | Change |
|------|--------|
| `frontend/src/lib/api/media.js` | `deleteReelById`: call `maybeHandleInvalidAdminSession()` on non-OK response (401 invalidation) |
| `frontend/src/lib/viewer/aiCleanupAgent.js` | `deleteVaultVideo`: require token; success-only sync/purge; remove silent fallback tombstone |
| `frontend/src/components/experiences/VaultExperience.svelte` | `requireAdminSessionForDelete()`; batch deletes gate auth + sync only after confirmed deletes |

---

## Behavior change

### Before

```
DELETE fails (401 / no token)
  → console.warn or skip
  → optional local tombstone + purge
  → "✅ Video deleted"
  → syncFromVault(true)
  → reel reappears
```

### After

```
No token
  → "🔐 Studio login required — open Studio, sign in, then retry delete"
  → stop (no DELETE, no sync)

DELETE 401
  → maybeHandleInvalidAdminSession (session cleared + AUTH_SESSION_EXPIRED)
  → "🔐 Studio session expired — sign in via Studio and retry delete"
  → stop (no sync, item stays visible)

DELETE 200
  → applyCanonicalDeleteClientEffects
  → "✅ Video deleted"
  → syncFromVault(true)
```

---

## Regression notes

| Scenario | Expected |
|----------|----------|
| Logged-in user, valid session, DELETE 200 | Video removed from vault + catalog; no resurrection |
| No admin token | Login message; video remains |
| Expired `rf_*` after Railway restart | 401 → session cleared; login message; video remains |
| Partial batch delete (some 401) | Only successful IDs tombstoned/synced; failed items remain |
| Successful DELETE absent from GET /api/reels | Existing tombstone + merge logic unchanged (VIDEO-SYNC-01) |
| Upload pipeline | Untouched |
| `reconcileTombstonesAgainstCatalog` | Untouched |

**Manual verify:**

1. Without Studio login → delete MP4 → login prompt, item stays.
2. After Studio login → delete → Network shows DELETE 200 → item gone after refresh.
3. Clear session / stale token → delete → session expired message, item stays.
4. `curl GET /api/reels` after failed delete → UUID still present.

**Automated:** Re-run `node scripts/video-delete-resurrection-01.mjs` when frontend preview + admin session available.

---

## Risk

| Area | Risk |
|------|------|
| Offline-only blob uploads mid-flight | No local-delete fallback; user must auth to delete (correct for persistent catalog) |
| Batch partial failure | Items that failed DELETE remain; message shows `removed/attempted` |

---

## Not in scope (per mission)

- Persistent admin sessions on Railway
- Tombstone reconciliation logic
- Catalog merge / viewer / theater
