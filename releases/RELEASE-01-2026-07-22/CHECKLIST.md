# RELEASE-01 checklist

## Pre-freeze baselines

- [x] PRODUCT-STUDIO-01…09 complete (HEAD `7aacae7`)
- [x] PRODUCT-STUDIO-10 scale audit — no blockers
- [x] PRODUCT-RC-FINAL acceptance — PASS (0 blockers)
- [x] PRODUCT-RC-DEPLOY-01 — Netlify synced to `index-CndLAw4Y.js`

## Record release state

- [x] Git commit baseline: `7aacae75342eb373a93fb71fe463f462fb5f3f95`
- [x] Frontend bundle hash: `index-CndLAw4Y.js` / SHA-256 `fb6245b5a65fde12fc3a74376ff77ecbdc59c829530092c2c70edfd110c3bed6`
- [x] Deployment URL: https://strong-lolly-a9fcb4.netlify.app
- [x] Acceptance evidence referenced (RC-FINAL, RC-DEPLOY-01, Studio RA-01)

## Clean release tree

- [x] Release Studio sources match HEAD (no uncommitted Studio delta)
- [x] `frontend/dist/` not tracked in release commit
- [x] Unrelated local WIP documented and excluded from freeze
- [x] Release notes identify final state (`RELEASE_FREEZE.json`)

## Release marker

- [x] Annotated git tag `RELEASE-01` on `7aacae7`
- [x] Documented checkpoint under `releases/RELEASE-01-2026-07-22/`

## Final smoke

- [x] Frontend live (HTTP 200, expected bundle)
- [x] Backend healthy (Netlify proxy + Railway; DB connected; storage ready)
- [x] Studio operational (Control Center → Content inventory controls)
- [x] Viewer operational (catalog unique ids; sample media reachable)

## Sign-off

| Item | Value |
|------|--------|
| Verdict | **RELEASE APPROVED / FROZEN** |
| Release id | `RELEASE-01-2026-07-22` |
| Tag | `RELEASE-01` |
| Commit | `7aacae7` |
