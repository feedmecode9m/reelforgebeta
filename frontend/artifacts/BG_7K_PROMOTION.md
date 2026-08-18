# BG-7K-PROMOTION — Release Record

**Mission:** Promote BG-7K auth hardening + shelf placeholder fix to production  
**Verdict:** **BG-7K RELEASE COMPLETE**  
**Generated:** 2026-07-24 (America/New_York)

---

## Git

| Item | Value |
|------|-------|
| Branch merged | `bg-7k-auth-hardening` → `main` |
| Merge type | Fast-forward |
| Commit | `b7608ce301568c9dc8fb44275d470b15e303a02a` |
| Message | BG-7K: canonical admin session auth and shelf placeholder fix |

---

## Pre-promotion verification (Steps 1–5)

| Check | Result |
|-------|--------|
| `frontend/src/lib/adminSession.js` canonical API | PASS |
| `api.js` backward-compatible re-exports | PASS |
| Accept path uses `getAdminAuthHeaders()` only | PASS |
| No scattered `Bearer ${token}` outside `adminSession.js` | PASS |
| `401 invalid_session` → clear once, emit `AUTH_SESSION_EXPIRED`, banner, no retry | PASS |
| Login → `setAdminSessionToken()` → `reelforge:admin-session-changed` | PASS |
| `fillShelfPresentation()` realCount>0 → no Coming Soon padding | PASS |
| `fillShelfPresentation()` realCount=0 → 5 onboarding placeholders | PASS |

---

## Build (Step 7)

| Target | Result |
|--------|--------|
| `npm install` (frontend) | PASS |
| `VITE_USE_SAME_ORIGIN_API=true npm run build` | PASS — bundle `index-Dv1Hvx_O.js` |
| `cargo build --release` (backend) | PASS (no backend code changes in BG-7K) |
| `mission-bg-7k-regression.mjs` | PASS — 14/14 |
| `mission-bg-7s-shelf-presentation-validate.mjs` | PASS |

---

## Deploy (Step 8)

| Surface | ID / Hash | URL |
|---------|-----------|-----|
| **Netlify** | `6a63fc2d0f70c2c343a9ce11` | https://strong-lolly-a9fcb4.netlify.app |
| **Bundle** | `index-Dv1Hvx_O.js` | Verified live in production HTML |
| **Railway** | `2f442416-ab37-444b-9c1b-060e52884868` | https://reelforge-deploy-production.up.railway.app |
| **Backend commit** | `b7608ce301568c9dc8fb44275d470b15e303a02a` | Frontend-only delta; backend unchanged at BG-7I deploy |

**Note:** BG-7K is a frontend-only release. Railway was not redeployed (no backend diff). Active production backend remains BG-7I deployment `2f442416-ab37-444b-9c1b-060e52884868`.

---

## Scope guardrails (honored)

- No upload architecture changes
- No R2 / signed upload / delete lifecycle / hero upload changes
- No `buildHomeFeed.js` changes
- No unrelated refactors

---

## Artifacts

| File | Purpose |
|------|---------|
| `BG_7K_PRODUCTION_VALIDATION.md` | Acceptance test matrix A–F |
| `bg7k-production-validation.json` | Machine-readable validation + HTTP/console traces |
| `BG_7K_IMPLEMENTATION.md` | Implementation record (pre-promotion) |
| `BG_7K_REGRESSION.md` | Local regression gate record |

---

## Rollback reference

| Item | Prior (pre-BG-7K) |
|------|-------------------|
| Netlify deploy | `6a63d1e9` |
| Bundle | `index-D5u9wEYU.js` |
| Railway deploy | `2f442416-ab37-444b-9c1b-060e52884868` (unchanged) |

---

**BG-7K RELEASE COMPLETE**
