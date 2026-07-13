# Mission Validation Reference

Run from `frontend/` with dev servers on `5173` (Vite) and `8080` (backend).

## Orchestrated Suite

```bash
node scripts/mission-5.8-validate.mjs
MISSION_58_STRESS=100 MISSION_58_DELETE_STRESS=100 node scripts/mission-5.8-validate.mjs
```

Runs prior missions first (stops on first failure), then 5.8 checks A–F.

## Mission Index

| Mission | Script | Focus |
|---------|--------|-------|
| 5.5 | `mission-5.5-validate.mjs` | Canonical id/fileName/url; reload survival |
| 5.6 | `mission-5.6-validate.mjs` | Upload pipeline |
| 5.6.5 | `mission-5.6.5-validate.mjs` | Extended upload |
| 5.7 | `mission-5.7-validate.mjs` | Batch delete by reel.id |
| 5.7.1 | `mission-5.7.1-validate.mjs` | Legacy string canonicalization |
| 5.7.2 | `mission-5.7.2-validate.mjs` | No phantom catalog import |
| 5.7.4 | `mission-5.7.4-validate.mjs` | Orphan lifecycle post-delete |
| 5.7.5 | `mission-5.7.5-render-audit.mjs` | Render source audit |
| 5.7.6 | `mission-5.7.6-validate.mjs` | Startup reconciliation |
| 5.7.7 | `mission-5.7.7-live-delete-audit.mjs` | Live delete events |
| 5.8 | `mission-5.8-validate.mjs` | Ghost purge, stress, invariants |

Note: `mission-5.7.3-validate.mjs` is referenced but may be missing — orchestrator SKIPs it.

## 5.8 Checks

| Check | Validates |
|-------|-----------|
| 5.8-A | 20 ghost canonicals purged when backend returns `[]` |
| 5.8-B | `thumbs === index === cards` after upload |
| 5.8-C | Hard refresh preserves consistency |
| 5.8-D | Stress upload cycles |
| 5.8-E | Offline retains local canonical (no ghost purge) |
| 5.8-F | Batch delete all clears vault to 0 |

## Test Harness Rules

1. `addInitScript` must not clear `personal_thumbnails` on every navigation — use `sessionStorage` boot guard
2. Wait for `window.__thumbCanonicalizationReady === true` before vault assertions
3. Admin token: `localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test')`

## Output Reports

Scripts write `MISSION_5_X_*.md` in `frontend/` root on completion or failure.
