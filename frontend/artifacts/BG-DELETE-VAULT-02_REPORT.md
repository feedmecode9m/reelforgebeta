# BG-DELETE-VAULT-02 — Why DELETE Does Not Permanently Remove MP4s

**Date:** 2026-07-27  
**Mode:** Evidence only. No code changes.

---

## Verdict (one paragraph)

Permanent removal fails because **the Postgres catalog row is usually never deleted**. The backend `DELETE` handler is sound when it runs, but the Vault path often **never reaches it** (no admin token, expired in-memory session, or HTTP 401), then **masks failure as success**, runs `syncFromVault()`, and **`reconcileTombstonesAgainstCatalog()` clears the client tombstone** while `GET /api/reels` still returns the UUID. Resurrection is a **symptom**; the **first failing boundary** is almost always **before `handlers::delete_reel` executes**.

---

## Live probe evidence (2026-07-27)

Sample catalog ID: `14a1e9a7-7a1c-4db2-9c31-7cca9706d216`

| Probe | URL | Status | Body |
|-------|-----|--------|------|
| DELETE no auth | Railway direct `/api/reels/{id}` | **401** | `{"error":"missing_authorization"}` |
| DELETE no auth | Netlify proxy `/api/reels/{id}` | **401** | proxied to Railway (`x-railway-edge`, `server: Netlify`) |
| DELETE invalid token | Railway + `Bearer invalid_token_123` | **401** | `{"error":"invalid_session"}` |
| GET catalog after failed DELETE | Railway `/api/reels` | **200** | `still_present: True` |

**Implication:** Without a valid server-side admin session, **zero SQL rows are deleted**. Catalog unchanged → sync resurrects.

When DELETE **does** succeed (validated in `VIDEO_DELETE_RESURRECTION_01.md`, 2026-07-24): catalog row gone, no resurrection after refresh.

---

## Full pipeline trace

```
Click 🗑️ Delete (VaultExperience.svelte:2218)
  ↓
handleVideoDelete(videoId)                         [VaultExperience.svelte:618]
  ↓
AI_CLEANUP_AGENT.deleteVaultVideo(videoId)         [aiCleanupAgent.js:576]
  ├─ confirm()
  ├─ token = getAdminToken()                       [adminSession.js:13 → localStorage reelforge_admin_session_token]
  ├─ diskName = filenameFromMediaRef(video) || video.name
  │
  ├─ GATE: if (token && diskName)                  [aiCleanupAgent.js:616]  ⚠️ BOUNDARY A
  │     else → skip backend entirely               [aiCleanupAgent.js:633]
  │
  ├─ deleteReelById(id, authHeaders())             [media.js:957]
  │     url = `${API_BASE_URL}/api/reels/${id}`    (same-origin '' on Netlify → /api/reels/…)
  │     fetch(DELETE, { headers: { Authorization: Bearer ${token} } })
  │     logs [VAULT-DELETE-TRACE] deleteReelById:request/response
  │
  ├─ catch (apiError) { console.warn only }        [aiCleanupAgent.js:632]  ⚠️ BOUNDARY B (silent)
  │
  ├─ if (!persistenceSuccess) local tombstone + purge
  ├─ uploadStatus.set('✅ Video deleted')          [aiCleanupAgent.js:648]  ⚠️ even when API failed
  └─ await syncFromVault(true)                     [aiCleanupAgent.js:649]
        ↓
      GET /api/reels                               [viewerContext.js:1077]
      reconcileTombstonesAgainstCatalog(catalog)   [viewerContext.js:1088 / deletionSync.js:79]  ⚠️ BOUNDARY C
      mergeVideoVaultEntries → personalVideos.set
```

### Netlify redirect layer

`frontend/netlify.toml` proxies `/api/*` → Railway (`status 200` rewrite).  
DELETE requests **do reach Railway** when Netlify is healthy (401 from Railway proves proxy path works).  
Earlier GET `/api/*` **503 `usage_exceeded`** on Netlify would block catalog fetch and DELETE alike — separate infra failure mode.

### Railway AdminAuth (before handler)

```
AdminAuthMiddleware.call                           [auth.rs:134-152]
  mutating_route_requires_admin(DELETE, /api/reels/{uuid}) → true
  require_admin()
    extract_bearer → missing → 401 missing_authorization     ⚠️ BOUNDARY D
    sessions.validate(token) → false → 401 invalid_session ⚠️ BOUNDARY E
  handlers::delete_reel NEVER RUNS
```

**Session store:** in-memory `HashMap` in `AdminSessionStore` ([auth.rs:14-36]). Tokens issued by `POST /admin/auth` as `rf_{uuid}` ([handlers.rs:178-179]). **Not persisted to Postgres.** Railway restart / new instance → all `rf_*` tokens invalid while `localStorage` still holds stale token.

### Railway handler (only if auth passes)

```
handlers::delete_reel                              [handlers.rs:279]
  get_reel_by_id → 404 if missing
  cancel ingestion jobs
  remove video file from disk (+ R2 if enabled)    [handlers.rs:355-373]
  remove thumb file
  db::reels::delete_reel → DELETE FROM reels WHERE id = $1  [db/reels.rs:131]
  verify row absent, publish ReelEvent::Deleted
  return 200 { success: true, id }
```

**No explicit transaction wrapper** — sqlx executes `DELETE` with autocommit. No rollback path after file delete.  
**No catalog cache** — `GET /api/reels` queries `list_ready_reels` live ([api/reels.rs:7-15], `status='ready' AND validated=true`).

### Startup re-import (secondary)

`reconcile_videos()` on startup ([health_state.rs:169-196]) can create **new** reel rows for orphan disk files ([reconcile.rs:148-169]). Same filename, **new UUID** — looks like “same video back” but is a different catalog id. Requires: DB row deleted, file still on disk, reconcile enabled.

---

## Answers to the 12 evidence questions

| # | Question | Finding |
|---|----------|---------|
| 1 | Was DELETE sent? | **Often no** — skipped if `!token \|\| !diskName`. **Sometimes yes** but rejected at auth. |
| 2 | Exact URL | `{origin}/api/reels/{uuid}` — on Netlify prod `API_BASE_URL=''` → same-origin relative URL. |
| 3 | Response code | **401** (missing/invalid session) when auth fails; **200** when handler completes; **404** if uuid not in DB; **503** possible via Netlify quota on `/api/*`. |
| 4 | Response body | `missing_authorization`, `invalid_session`, `{ success: true, id }`, or Netlify `usage_exceeded`. |
| 5 | Authorization present? | Only if `localStorage.reelforge_admin_session_token` set; logged as `hasAuth` in `[VAULT-DELETE-TRACE]`. |
| 6 | Handler executed? | **No** on 401 — middleware short-circuits. Logs `[VAULT-DELETE-TRACE] handlers::delete_reel:enter` only on success path. |
| 7 | SQL rows affected | **0** when auth fails. Handler uses `DELETE FROM reels WHERE id = $1`; logs `present=false` after ([db/reels.rs:136-139]). |
| 8 | Filesystem delete? | **No** when auth fails. Runs only inside handler after auth. |
| 9 | R2 delete? | **No** when auth fails. Same gate. |
| 10 | Transaction commit? | Single autocommit statement; N/A when DELETE never runs. |
| 11 | UUID still in GET /api/reels? | **Yes** in all failed-delete scenarios (proven by curl after 401). |
| 12 | If yes, why? | See ranked causes below. |

---

## Ranked root causes

### 1. Admin session invalid / missing (primary — ~60%)

| Mechanism | Evidence |
|-----------|----------|
| No Studio login | `deleteVaultVideo` skips API when `!getAdminToken()` ([aiCleanupAgent.js:633]). Upload **blocks** without token ([VaultExperience.svelte:1087]); delete **does not**. |
| Stale `rf_*` token after Railway restart | Sessions in RAM only ([auth.rs:14-36]); localStorage survives redeploy → **401 invalid_session**. |
| Silent failure | `catch (apiError) { console.warn }` — `persistenceSuccess` stays false ([aiCleanupAgent.js:632]). |
| False success UX | `uploadStatus.set('✅ Video deleted')` regardless ([aiCleanupAgent.js:648]). |

**First failing boundary:**  
- **No token:** `aiCleanupAgent.js:616-633` (DELETE never dispatched)  
- **Bad token:** `auth.rs:146-147` (AdminAuth rejects before handler)

### 2. syncFromVault tombstone reconciliation (symptom amplifier — ~30%)

After failed DELETE, local tombstone may be set ([aiCleanupAgent.js:635-641]).  
`syncFromVault` fetches catalog still containing UUID → **`reconcileTombstonesAgainstCatalog` removes tombstone** ([deletionSync.js:97-102]) → merge re-imports reel.

**First resurrection component:** `reconcileTombstonesAgainstCatalog` at `deletionSync.js:97-102` (called from `viewerContext.js:1088`).

This is **correct behavior if delete succeeded**; **incorrect when delete never succeeded**.

### 3. Proxy / infra (~5%)

Netlify **503 `usage_exceeded`** blocks `/api/*` — DELETE and GET both fail or behave inconsistently. Distinct from auth failure.

### 4. Startup disk reconcile (~5%)

Orphan file re-import with new UUID after successful DELETE left file on disk ([reconcile.rs:138-169]).

### Ruled out (when auth succeeds)

| Hypothesis | Evidence against |
|------------|------------------|
| Stale GET cache | Direct Postgres query every request ([api/reels.rs:8]) |
| SQL deletes 0 rows with valid auth + existing id | Handler loads row first; 404 if missing |
| Wrong handler | Single route `DELETE /api/reels/{id}` → `handlers::delete_reel` ([main.rs:333]) |
| Successful DELETE + ghost localStorage only | Fixed by `pruneGhostVideoVaultEntries` ([VIDEO_DELETE_RESURRECTION_01.md]) |

---

## Search index (requested symbols)

| Symbol | Location | Role in failure |
|--------|----------|-----------------|
| `deleteVaultVideo` | `aiCleanupAgent.js:576` | Gates API on token+diskName; silent catch; always syncs |
| `deleteReelById` | `media.js:957`, `VaultExperience.svelte:240` | fetch DELETE; throws on !ok |
| `DELETE /api/reels` | `main.rs:333`, `handlers.rs:279` | Authoritative removal |
| `AdminAuth` | `auth.rs:95-154` | 401 before handler |
| `DELETE FROM reels` | `db/reels.rs:131` | Row removal |
| `reconcile_videos` | `reconcile.rs:56`, `health_state.rs:169` | Re-import orphan files |
| `recordDeletedMediaIds` | `deletionSync.js:55` | Client tombstone |
| `reconcileTombstonesAgainstCatalog` | `deletionSync.js:79` | **Clears tombstone if UUID in catalog** |

---

## Timeline (typical failed delete)

```
T0  User confirms delete
T1  getAdminToken() → null OR stale rf_* token
T2  DELETE skipped OR fetch → 401
T3  persistenceSuccess = false (warn logged, no user error)
T4  Optional local tombstone + purge (UI looks deleted)
T5  "✅ Video deleted" shown
T6  syncFromVault(true)
T7  GET /api/reels → UUID still present
T8  reconcileTombstonesAgainstCatalog → removes UUID from tombstone list
T9  mergeVideoVaultEntries → UUID back in personal_video_vault
T10 User refreshes → same MP4 visible
```

---

## Exact first failing boundary (decision tree)

```
getAdminToken() present?
  NO  → FIRST FAIL: aiCleanupAgent.js:633 (backend skipped)
  YES → fetch DELETE sent
          Response 401?
            YES → FIRST FAIL: auth.rs:146-147 (AdminAuth)
            NO  → Response 503?
                    YES → FIRST FAIL: Netlify/Railway proxy
                    NO  → Response 404?
                            YES → wrong/stale UUID in vault entry
                            NO  → Response 200?
                                    YES → check GET /api/reels
                                      still present → reconcile/import bug
                                      absent → resurrection = frontend only (tombstone reconcile)
```

---

## Minimal surgical fix (recommendation only — NOT implemented)

**Goal:** Never run catalog sync that clears tombstones unless backend DELETE returned 200.

| Priority | Change | File | Risk |
|----------|--------|------|------|
| **P0** | Block delete when `!getAdminToken()` — mirror upload gate message | `aiCleanupAgent.js:616` | Low — UX parity with upload |
| **P0** | On DELETE failure: **do not** call `syncFromVault(true)`; surface error to user | `aiCleanupAgent.js:632-649` | Low — stops immediate resurrection |
| **P0** | Remove false success: only show ✅ when `persistenceSuccess === true` | `aiCleanupAgent.js:648` | Low |
| **P1** | `deleteReelById`: call `maybeHandleInvalidAdminSession` on 401 | `media.js:980` | Low — prompts re-login |
| **P1** | `reconcileTombstonesAgainstCatalog`: **do not** remove tombstones for IDs deleted in current session / or invert to “catalog wins only when DELETE confirmed” | `deletionSync.js:97-102` | Medium — needs clear invariant |
| **P2** | Persist admin sessions (Redis/DB) or re-auth on `invalid_session` before mutating ops | `auth.rs` | Medium — ops change |
| **P3** | Delete gate: require valid UUID format before DELETE | `media.js:957` | Low |

**Smallest single fix with highest impact:**  
**Skip `syncFromVault(true)` when `persistenceSuccess === false`** + **show error instead of ✅**. Stops resurrection even if tombstone logic unchanged.

---

## Risk assessment

| Fix | Regression risk | Notes |
|-----|-----------------|-------|
| Block delete without login | Very low | Upload already requires login |
| Skip sync on failed DELETE | Low | Offline users keep local tombstone until re-auth |
| Tombstone reconcile change | Medium | Must preserve “delete succeeded, stale tombstone” case |
| Persistent sessions | Medium | Security + deployment complexity |

---

## Verification protocol (for one MP4)

1. **Before delete** — note UUID from vault entry `id` field (must match `/api/reels` id, not display name).

2. **DevTools Network** — capture:
   - Request URL, method DELETE
   - Request headers: `Authorization: Bearer rf_…`
   - Status + response JSON

3. **Immediately after:**
   ```bash
   curl -sS "https://reelforge-deploy-production.up.railway.app/api/reels" \
     | jq '.[] | select(.id=="YOUR-UUID")'
   ```

4. **Console:**
   ```javascript
   localStorage.getItem('reelforge_admin_session_token')  // null → Boundary A
   JSON.parse(localStorage.getItem('reelforge_deleted_media_ids')||'[]')
   ```

5. **Railway logs** (if DELETE claimed 200):
   ```
   [VAULT-DELETE-TRACE] handlers::delete_reel:enter
   [VAULT-DELETE-TRACE] db::reels::delete_reel:after id=… present=false
   ```

---

## Related artifacts

- `BG-DELETE-VAULT-01_REPORT.md` — sync/resurrection trace
- `VIDEO_DELETE_RESURRECTION_01.md` — proof backend DELETE works when auth succeeds

---

**No implementation in BG-DELETE-VAULT-02.** Next action: one browser-captured DELETE row + post-delete curl to classify into the decision tree above.
