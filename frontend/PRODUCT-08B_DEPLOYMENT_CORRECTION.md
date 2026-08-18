# PRODUCT-08B — Deployment Correction Status

## Separation (locked)

| ID | Behavior | Status |
|----|----------|--------|
| **08B** | Sync amplification / apply→schedule loop | Patch **committed locally**; push/deploy blocked in this environment |
| **08C** | Stale `Backend reconnecting...` operation status | **Deferred** — do not touch UI while 08B is undeployed |

Seeing `Backend reconnecting...` on Netlify does **not** mean the 08B patch failed. It means either:
1. Old bundle is still live (current), and/or
2. 08C message path is independent of `studioSync.js`

---

## Commit (local)

| Field | Value |
|-------|-------|
| Commit | `ce2d276bd01a652bce8cfd95fd46cb178aa38c85` |
| Message | `PRODUCT-08B: contain sync feedback loop in studioSync` |
| Files | **Only** `frontend/src/lib/sync/studioSync.js` |
| Branch | `main` (ahead of `origin/main` by 1) |

### Not the earlier mistaken reference

`94c6667` = RA-02 stress evidence only — **no** containment.

---

## Push / Netlify (blocked here)

```text
git push → FAIL (no GitHub credentials)
netlify status → not logged in
gh auth → not logged in
```

**Manual next steps on a credentialed machine:**

```bash
git push -u origin main
# wait for Netlify production deploy of ce2d276
```

Then verify live bundle ≠ `index-DQeGd3cl.js` and contains:

- `SYNC_SCHEDULE_SUPPRESSED`
- `applyRemoteSyncPayload`

```bash
curl -sS https://strong-lolly-a9fcb4.netlify.app/ | rg -o 'assets/index-[^" ]+\.js'
# fetch that JS and:
rg -n 'SYNC_SCHEDULE_SUPPRESSED|applyRemoteSyncPayload' assets/index-….js
```

---

## Event 4 replay (after deploy confirmed)

```bash
cd frontend
EVENT_ID=4 WAIT_MS=300000 node scripts/mission-product-08b-reconnect-capture.mjs
```

### Compare to Event 2 / Event 3 (pre-patch)

| | Event 2 | Event 3 | Event 4 expected |
|--|---------|---------|-----------------|
| Pushes | 157 | 182 | near periodic (~15s), not ~1.6–1.8s burst |
| Pattern | B | B | not B |
| Bundle | `index-DQeGd3cl.js` | same | **new** hash + containment markers |

### Do not score in Event 4

- GlobalOperationStatus stale text (08C)
- WS UX
- Banner wording
- Upload/hero

---

## Excluded from this change (untouched)

- `GlobalOperationStatus.svelte`
- `BackendHealthBanner.svelte`
- `api.js`
- `wsReelEvents.js`
- upload/hero pipeline
