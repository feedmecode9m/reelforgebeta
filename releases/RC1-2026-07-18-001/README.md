# Release evidence package — RC1-2026-07-18-001

Self-contained audit trail for Release Candidate 1.

**Status:** Gate 7 complete — ready for `RC1-STABLE` tag (Gate 8)

## Contents

| File | Gate | Status |
|------|------|--------|
| `gate-0-environment-snapshot.json` | 0 | ✅ |
| `gate-3-deployment-record.json` | 3 | ✅ |
| `gate-4-production-smoke.json` | 4 | ✅ |
| `gate-5-ra01-shared-state.json` | 5 | ✅ |
| `gate-7-ra02-stress.json` | 7 | ✅ |
| `README.md` | — | This file |

## Reports (see `frontend/`)

| Report | Gate |
|--------|------|
| `frontend/RA-01_SHARED_STATE_REPORT.md` | 5 |
| `frontend/RA-02_STRESS_REPORT.md` | 7 |
| `frontend/BG-7W_HERO_RESTORE_FIX.md` | — |
| `frontend/RC1_RELEASE_CHECKLIST.md` | 8 |

## Archive on RC1-STABLE sign-off

```bash
RELEASE=RC1-2026-07-18-001
cp frontend/artifacts/release-manifest-${RELEASE}.json releases/${RELEASE}/release-manifest.json
cp frontend/RA-01_SHARED_STATE_REPORT.md releases/${RELEASE}/
cp frontend/RA-02_STRESS_REPORT.md releases/${RELEASE}/
cp frontend/BG-7W_HERO_RESTORE_FIX.md releases/${RELEASE}/
cp frontend/RC1_RELEASE_CHECKLIST.md releases/${RELEASE}/
git add releases/${RELEASE}/
git commit -m "${RELEASE}: archive release evidence package"
```

## Traceability statement

Release `RC1-2026-07-18-001` is traceable from source commit → deployed bundle `assets/index-DQeGd3cl.js` → production verification (Gates 4–5) → stress acceptance (Gate 7) → regression suite (hero + shared state green; attachment Playwright non-blocker documented).
