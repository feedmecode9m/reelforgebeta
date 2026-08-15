# PHASE-HERO-REPLACE-3 — Late commit guard

**Implementation:** COMPLETE  
**Release:** NOT STARTED (no deploy)  
**Local validation:** PHASE-HERO-REPLACE-3 LOCAL PASS

## Root cause

`acceptHeroFile` already minted `heroAcceptOperationToken` and the 45s watchdog already incremented it, clearing loading and showing retry. After `await uploadMedia`, there was **no** `isOperationActive()` check before `commitHeroVideoIdentity`. A late 200 still applied Hero.

## Fix

Only `HeroExperience.svelte` Replace Hero lifecycle:

- After video/image upload await: `discardStaleResult` → return (no commit, no store writes, pending file kept for retry).
- Catch path ignores all inactive operations (not only timeout).
- `rejectHeroFile` increments the token so cancel also drops in-flight accepts.

## Validation

| Check | Result |
|-------|--------|
| Normal Replace → new Hero | PASS `581c87b7-…` |
| Refresh keeps replacement | PASS |
| Timeout keeps old Hero | PASS `preview_pending` |
| Late 200 ignored (`HERO_ACCEPT_STALE_DISCARD`) | PASS |
| Retry after timeout | PASS `dad00529-…` |
| Vault MP4 does not change Hero | PASS |

Artifact JSON: `frontend/artifacts/PHASE-HERO-REPLACE-3-VALIDATION.json`

## Untouched

ViewerSemanticCard, feed identity, Phase 6.6.2/6.6.3, Hero Lock, Vault upload path, categories/metadata.
