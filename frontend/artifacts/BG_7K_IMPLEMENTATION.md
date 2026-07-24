# BG-7K-HARDEN — Implementation Report

**Branch:** `bg-7k-auth-hardening`  
**Mission:** Surgical fixes proven by BG-7K root cause analysis  
**Date:** 2026-07-24

---

## Summary

Two root causes addressed:

| ID | Issue | Fix |
|----|-------|-----|
| A | Thumbnail Accept failed at `require_admin()` (`missing_authorization` / `invalid_session`) | Canonical admin session module + preflight gate + 401 handler |
| B | One real MP4 produced four “Coming Soon” shelf cards | Skip presentation padding when `realCount > 0` |

Upload transport, signed upload, R2, multipart, delete lifecycle, and hero upload paths were **not** refactored beyond auth header centralization.

---

## Implementation A — Canonical authentication

**New file:** `frontend/src/lib/adminSession.js`

Single token provider exporting:

- `getAdminToken()`
- `getAdminAuthHeaders()` (= `getAdminAuthorizationHeader(getAdminToken())`)
- `setAdminSessionToken(token)`
- `clearAdminSession()`
- `handleAdminSessionExpired(source)`
- `maybeHandleInvalidAdminSession(response, errBody, source)`
- `isInvalidSessionError(error)`
- `ADMIN_SESSION_TOKEN_KEY`

**Re-exported from:** `frontend/src/lib/api.js` (public API unchanged for consumers importing from `api.js`).

**Replaced inline lookups in:**

| File | Change |
|------|--------|
| `VaultExperience.svelte` | `getAdminAuthHeaders()`, session preflight, disabled Accept |
| `StudioExperience.svelte` | `setAdminSessionToken`, `getAdminAuthHeaders`, `getAdminToken` |
| `HeroExperience.svelte` | `getAdminAuthHeaders()` |
| `HeroManagerPanel.svelte` | `getAdminAuthHeaders()` |
| `aiCleanupAgent.js` | `authHeaders()` → `getAdminAuthHeaders()` |
| `contentAgents.js` | `getAdminAuthHeaders()` |
| `viewerContext.js` | `getAdminAuthHeaders()`, `clearAdminSession()` on logout |
| `mediaBootstrap.js` | `getAdminAuthHeaders()` |
| `securityAuditEngine.js` | `getAdminToken()` for runtime probe |

No component manually builds `Bearer ${token}` except `adminSession.js`.

---

## Implementation B — Accept preflight

`acceptPendingThumbnail()` (`VaultExperience.svelte`):

1. Returns immediately if `!getAdminToken()` with status **"Studio login required."**
2. Accept button `disabled={!adminSessionReady}` when pending thumbnail shown
3. Hint text when logged out

No upload/network call when logged out.

---

## Implementation C — `401 invalid_session`

`createReel()` / signed upload paths (`media.js`) call `maybeHandleInvalidAdminSession()` which:

1. Clears token via `clearAdminSession({ emitExpired: true })`
2. Dispatches **`AUTH_SESSION_EXPIRED`** exactly once per expiry
3. Does **not** retry upload

`viewerContext.js` listens for `AUTH_SESSION_EXPIRED`:

- Clears admin mode
- Shows **"Studio session expired. Please sign in again."**

`acceptPendingThumbnail` catch:

- Shows same message for `invalid_session`
- Does **not** clear `pendingThumbnail` (user can re-login and Accept again)
- Does **not** write vault entries on failure

---

## Implementation D — Post-login Accept

`setAdminSessionToken()` dispatches `reelforge:admin-session-changed`.

`VaultExperience` listens and sets `adminSessionReady = true` immediately — Accept enables without page refresh after Studio login.

---

## Implementation E — Presentation padding

`fillShelfPresentation.js`:

- When `realCount > 0` → return real cards only (no fillers)
- When `realCount === 0` → retain `MIN_SHELF_PRESENTATION_COUNT` (5) onboarding slots
- Fillers marked: `layoutOnly: true`, `isPlaceholder: true`, `isPresentationOnly: true`

---

## Implementation F — Consumer audit

| Consumer | Excludes layout-only? |
|----------|----------------------|
| `isRealShelfCard` | Yes (`layoutOnly`, `isPresentationOnly`, `isPlaceholder`, `isBlackStoriesPlaceholder`) |
| `getAllFeedReels()` | Yes — filters `isPresentationOnly` / `layoutOnly` |
| `flattenFeedReels()` (hero) | Yes — same filters |
| Feed store (`reelforge_feed`) | Never receives presentation fillers (render-layer only) |
| Workflow / episode pipeline | Uses `seriesStore` + feed reels — not presentation slots |
| Analytics / search | Operate on feed store, not shelf display padding |

Presentation fillers exist **only** in `ReelshortExperience.getShelfDisplayItems()` → `fillShelfPresentation()`.

---

## Files changed (mission scope)

```
frontend/src/lib/adminSession.js                          (new)
frontend/src/lib/api.js
frontend/src/lib/api/media.js
frontend/src/lib/feed/fillShelfPresentation.js
frontend/src/lib/hero/heroIntelligence.js
frontend/src/lib/mediaBootstrap.js
frontend/src/lib/security/securityAuditEngine.js
frontend/src/lib/viewer/aiCleanupAgent.js
frontend/src/lib/viewer/contentAgents.js
frontend/src/viewer/viewerContext.js
frontend/src/components/experiences/VaultExperience.svelte
frontend/src/components/experiences/StudioExperience.svelte
frontend/src/components/experiences/HeroExperience.svelte
frontend/src/components/studio/HeroManagerPanel.svelte
frontend/scripts/mission-bg-7k-regression.mjs               (new)
frontend/scripts/mission-bg-7s-shelf-presentation-validate.mjs
```

**Unified diff:** `frontend/artifacts/bg7k-unified.diff` (mission files only; add `adminSession.js` as new file)

---

## Recommended manual verification

1. Log out → drop thumbnail → Accept disabled, no POST
2. Log in → Accept enabled → POST returns 202
3. One video in feed → shelf shows one card (no Coming Soon padding)
4. Empty vault → shelves still show 5 onboarding slots on empty categories
