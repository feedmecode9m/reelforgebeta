# MISSION_5_8_PROFILE

Generated: 2026-07-13T01:44:52.960Z

## Executive findings (Mission 5.8.9)

**Total wall time:** 36.8 minutes (2208084ms)

### Where time is spent (top-level phases only)

| Phase | elapsed_ms | % of total | Notes |
|-------|------------|------------|-------|
| prior-missions:all | 928537 | 42.1% | spawnSync_regression_suite |
| 5.8-A:ghost-purge | 16175 | 0.7% |  |
| 5.8-B:index-sync | 18511 | 0.8% |  |
| 5.8-C:hard-refresh | 32769 | 1.5% |  |
| 5.8-D:stress-uploads | 561950 | 25.4% |  |
| 5.8-E:offline | 13447 | 0.6% |  |

### Dominant cost drivers

1. **Prior mission regression (`spawnSync`)** — 928532ms across 10 child scripts. Slowest: mission-5.7.6-validate.mjs (158292ms). Internal upload/wait/poll loops inside child scripts are **not** separately timed; their cost is embedded in spawn totals.
2. **5.8-D stress uploads (100×)** — 561950ms phase total. Per-upload avg ~5453ms.
3. **Fixed post-accept sleep (`dropThumb` 5000ms)** — 1010012ms across 202 upload sleeps. This is **intentional validator idle**, not backend polling.
4. **`openStudio` navigation** — 171825ms aggregate across 63 instrumented sub-steps; includes 63001ms fixed sleeps (2000ms + 5000ms + 2000ms per call).
5. **5.8-F delete stress** — 100 upload attempts timed (avg ~5489ms). Batch delete wait (15000ms) did not run.

### Counters

| Counter | Count |
|---------|-------|
| Retries (HTTP wait loops) | 0 |
| Poll iterations | 2 |
| Backend HTTP requests (instrumented) | 3 |
| Browser reloads | 3 |
| Browser goto | 13 |
| Browser fixed sleeps | 223 |
| Upload operations | 202 |
| Delete batch trigger | 0 |

### Unbounded / risky waits

- No exhausted retry loops detected.
- `waitHttp` maxAttempts=60 × 1000ms delay = up to **60s per endpoint** (bounded).
- `openStudio` selector timeout 60000ms, function timeout 45000ms (bounded).
- `dropThumb` accept-btn timeout 15000ms (bounded).
- Prior mission `spawnSync` timeout 600000ms per script (bounded).

### Pauses > 2000ms

0 pauses logged. Largest: prior-missions:all (928537ms).

**Run stopped at:** 5.8-F delete setup — Expected >=100 thumbs before delete, got 20 (vault MAX_THUMBNAILS=20 cap)

---

## Summary

| Metric | Value |
|--------|-------|
| Total elapsed | 2208.1s (2208084ms) |
| Stress uploads (5.8-D) | 100 |
| Delete stress uploads (5.8-F) | 100 |
| Prior mission spawns | 10 |
| Upload operations timed | 202 |
| Delete operations timed | 0 |
| Backend HTTP requests | 3 |
| Poll iterations | 2 |
| Retry iterations | 0 |
| Browser reloads | 3 |
| Browser goto | 13 |
| Browser fixed waits | 223 |
| Browser launches | 1 |
| Pauses > 2000ms | 0 |

## Slowest operations (top 25)

| Rank | Phase | elapsed_ms | start | end |
|------|-------|------------|-------|-----|
| 1 | prior-missions:all | 928537 | 2026-07-13T01:08:04.905Z | 2026-07-13T01:23:33.442Z |
| 2 | 5.8-D:stress-uploads | 561950 | 2026-07-13T01:24:40.898Z | 2026-07-13T01:34:02.848Z |
| 3 | prior:mission-5.7.6-validate.mjs | 158292 | 2026-07-13T01:19:34.511Z | 2026-07-13T01:22:12.803Z |
| 4 | prior:mission-5.7.1-validate.mjs | 124758 | 2026-07-13T01:14:06.710Z | 2026-07-13T01:16:11.468Z |
| 5 | prior:mission-5.5-validate.mjs | 124520 | 2026-07-13T01:08:04.905Z | 2026-07-13T01:10:09.425Z |
| 6 | prior:mission-5.7.4-validate.mjs | 123373 | 2026-07-13T01:17:10.723Z | 2026-07-13T01:19:14.096Z |
| 7 | prior:mission-5.6-validate.mjs | 100457 | 2026-07-13T01:10:09.425Z | 2026-07-13T01:11:49.882Z |
| 8 | prior:mission-5.7.7-live-delete-audit.mjs | 80638 | 2026-07-13T01:22:12.804Z | 2026-07-13T01:23:33.442Z |
| 9 | prior:mission-5.6.5-validate.mjs | 75857 | 2026-07-13T01:11:49.883Z | 2026-07-13T01:13:05.740Z |
| 10 | prior:mission-5.7-validate.mjs | 60969 | 2026-07-13T01:13:05.740Z | 2026-07-13T01:14:06.709Z |
| 11 | prior:mission-5.7.2-validate.mjs | 59254 | 2026-07-13T01:16:11.469Z | 2026-07-13T01:17:10.723Z |
| 12 | 5.8-C:hard-refresh | 32769 | 2026-07-13T01:24:08.129Z | 2026-07-13T01:24:40.898Z |
| 13 | prior:mission-5.7.5-render-audit.mjs | 20414 | 2026-07-13T01:19:14.097Z | 2026-07-13T01:19:34.511Z |
| 14 | 5.8-B:index-sync | 18511 | 2026-07-13T01:23:49.617Z | 2026-07-13T01:24:08.128Z |
| 15 | 5.8-A:ghost-purge | 16175 | 2026-07-13T01:23:33.442Z | 2026-07-13T01:23:49.617Z |
| 16 | 5.8-E:offline | 13447 | 2026-07-13T01:34:02.848Z | 2026-07-13T01:34:16.295Z |
| 17 | openStudio | 13165 | 2026-07-13T01:24:27.654Z | 2026-07-13T01:24:40.819Z |
| 18 | openStudio | 12671 | 2026-07-13T01:23:36.861Z | 2026-07-13T01:23:49.532Z |
| 19 | openStudio | 12517 | 2026-07-13T01:24:41.946Z | 2026-07-13T01:24:54.463Z |
| 20 | openStudio | 12280 | 2026-07-13T01:24:09.202Z | 2026-07-13T01:24:21.482Z |
| 21 | openStudio | 12013 | 2026-07-13T01:23:50.601Z | 2026-07-13T01:24:02.614Z |
| 22 | openStudio | 11850 | 2026-07-13T01:34:17.368Z | 2026-07-13T01:34:29.218Z |
| 23 | openStudio | 11422 | 2026-07-13T01:34:04.795Z | 2026-07-13T01:34:16.217Z |
| 24 | upload:m58-del-mriiwqkn-34.png | 5754 | 2026-07-13T01:37:35.305Z | 2026-07-13T01:37:41.059Z |
| 25 | upload:m58-del-mriiwqkn-46.png | 5712 | 2026-07-13T01:38:41.582Z | 2026-07-13T01:38:47.294Z |

## Prior mission spawn times

| Mission | elapsed_ms | start | end |
|---------|------------|-------|-----|
| mission-5.7.6-validate.mjs | 158292 | 2026-07-13T01:19:34.511Z | 2026-07-13T01:22:12.803Z |
| mission-5.7.1-validate.mjs | 124758 | 2026-07-13T01:14:06.710Z | 2026-07-13T01:16:11.468Z |
| mission-5.5-validate.mjs | 124520 | 2026-07-13T01:08:04.905Z | 2026-07-13T01:10:09.425Z |
| mission-5.7.4-validate.mjs | 123373 | 2026-07-13T01:17:10.723Z | 2026-07-13T01:19:14.096Z |
| mission-5.6-validate.mjs | 100457 | 2026-07-13T01:10:09.425Z | 2026-07-13T01:11:49.882Z |
| mission-5.7.7-live-delete-audit.mjs | 80638 | 2026-07-13T01:22:12.804Z | 2026-07-13T01:23:33.442Z |
| mission-5.6.5-validate.mjs | 75857 | 2026-07-13T01:11:49.883Z | 2026-07-13T01:13:05.740Z |
| mission-5.7-validate.mjs | 60969 | 2026-07-13T01:13:05.740Z | 2026-07-13T01:14:06.709Z |
| mission-5.7.2-validate.mjs | 59254 | 2026-07-13T01:16:11.469Z | 2026-07-13T01:17:10.723Z |
| mission-5.7.5-render-audit.mjs | 20414 | 2026-07-13T01:19:14.097Z | 2026-07-13T01:19:34.511Z |

## Upload timings

| Upload | elapsed_ms |
|--------|------------|
| upload:m58-sync-mriiwqkn.png:drop | 9 |
| upload:m58-sync-mriiwqkn.png:accept-btn | 133 |
| upload:m58-sync-mriiwqkn.png:accept-click | 248 |
| upload:m58-sync-mriiwqkn.png:sleep | 5001 |
| upload:m58-sync-mriiwqkn.png | 5391 |
| upload:m58-refresh-mriiwqkn.png:drop | 25 |
| upload:m58-refresh-mriiwqkn.png:accept-btn | 148 |
| upload:m58-refresh-mriiwqkn.png:accept-click | 335 |
| upload:m58-refresh-mriiwqkn.png:sleep | 5001 |
| upload:m58-refresh-mriiwqkn.png | 5510 |
| upload:m58-stress-mriiwqkn-0.png:drop | 22 |
| upload:m58-stress-mriiwqkn-0.png:accept-btn | 129 |
| upload:m58-stress-mriiwqkn-0.png:accept-click | 207 |
| upload:m58-stress-mriiwqkn-0.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-0.png | 5358 |
| upload:m58-stress-mriiwqkn-1.png:drop | 21 |
| upload:m58-stress-mriiwqkn-1.png:accept-btn | 128 |
| upload:m58-stress-mriiwqkn-1.png:accept-click | 281 |
| upload:m58-stress-mriiwqkn-1.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-1.png | 5432 |
| upload:m58-stress-mriiwqkn-2.png:drop | 14 |
| upload:m58-stress-mriiwqkn-2.png:accept-btn | 162 |
| upload:m58-stress-mriiwqkn-2.png:accept-click | 247 |
| upload:m58-stress-mriiwqkn-2.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-2.png | 5424 |
| upload:m58-stress-mriiwqkn-3.png:drop | 12 |
| upload:m58-stress-mriiwqkn-3.png:accept-btn | 94 |
| upload:m58-stress-mriiwqkn-3.png:accept-click | 235 |
| upload:m58-stress-mriiwqkn-3.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-3.png | 5342 |
| upload:m58-stress-mriiwqkn-4.png:drop | 6 |
| upload:m58-stress-mriiwqkn-4.png:accept-btn | 118 |
| upload:m58-stress-mriiwqkn-4.png:accept-click | 155 |
| upload:m58-stress-mriiwqkn-4.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-4.png | 5279 |
| upload:m58-stress-mriiwqkn-5.png:drop | 6 |
| upload:m58-stress-mriiwqkn-5.png:accept-btn | 205 |
| upload:m58-stress-mriiwqkn-5.png:accept-click | 202 |
| upload:m58-stress-mriiwqkn-5.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-5.png | 5415 |
| upload:m58-stress-mriiwqkn-6.png:drop | 48 |
| upload:m58-stress-mriiwqkn-6.png:accept-btn | 105 |
| upload:m58-stress-mriiwqkn-6.png:accept-click | 275 |
| upload:m58-stress-mriiwqkn-6.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-6.png | 5428 |
| upload:m58-stress-mriiwqkn-7.png:drop | 18 |
| upload:m58-stress-mriiwqkn-7.png:accept-btn | 104 |
| upload:m58-stress-mriiwqkn-7.png:accept-click | 361 |
| upload:m58-stress-mriiwqkn-7.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-7.png | 5483 |
| upload:m58-stress-mriiwqkn-8.png:drop | 5 |
| upload:m58-stress-mriiwqkn-8.png:accept-btn | 91 |
| upload:m58-stress-mriiwqkn-8.png:accept-click | 289 |
| upload:m58-stress-mriiwqkn-8.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-8.png | 5385 |
| upload:m58-stress-mriiwqkn-9.png:drop | 25 |
| upload:m58-stress-mriiwqkn-9.png:accept-btn | 148 |
| upload:m58-stress-mriiwqkn-9.png:accept-click | 188 |
| upload:m58-stress-mriiwqkn-9.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-9.png | 5362 |
| upload:m58-stress-mriiwqkn-10.png:drop | 22 |
| upload:m58-stress-mriiwqkn-10.png:accept-btn | 134 |
| upload:m58-stress-mriiwqkn-10.png:accept-click | 231 |
| upload:m58-stress-mriiwqkn-10.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-10.png | 5388 |
| upload:m58-stress-mriiwqkn-11.png:drop | 25 |
| upload:m58-stress-mriiwqkn-11.png:accept-btn | 102 |
| upload:m58-stress-mriiwqkn-11.png:accept-click | 337 |
| upload:m58-stress-mriiwqkn-11.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-11.png | 5464 |
| upload:m58-stress-mriiwqkn-12.png:drop | 17 |
| upload:m58-stress-mriiwqkn-12.png:accept-btn | 77 |
| upload:m58-stress-mriiwqkn-12.png:accept-click | 287 |
| upload:m58-stress-mriiwqkn-12.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-12.png | 5382 |
| upload:m58-stress-mriiwqkn-13.png:drop | 6 |
| upload:m58-stress-mriiwqkn-13.png:accept-btn | 134 |
| upload:m58-stress-mriiwqkn-13.png:accept-click | 303 |
| upload:m58-stress-mriiwqkn-13.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-13.png | 5444 |
| upload:m58-stress-mriiwqkn-14.png:drop | 6 |
| upload:m58-stress-mriiwqkn-14.png:accept-btn | 130 |
| upload:m58-stress-mriiwqkn-14.png:accept-click | 269 |
| upload:m58-stress-mriiwqkn-14.png:sleep | 5002 |
| upload:m58-stress-mriiwqkn-14.png | 5407 |
| upload:m58-stress-mriiwqkn-15.png:drop | 6 |
| upload:m58-stress-mriiwqkn-15.png:accept-btn | 136 |
| upload:m58-stress-mriiwqkn-15.png:accept-click | 248 |
| upload:m58-stress-mriiwqkn-15.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-15.png | 5390 |
| upload:m58-stress-mriiwqkn-16.png:drop | 21 |
| upload:m58-stress-mriiwqkn-16.png:accept-btn | 116 |
| upload:m58-stress-mriiwqkn-16.png:accept-click | 299 |
| upload:m58-stress-mriiwqkn-16.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-16.png | 5436 |
| upload:m58-stress-mriiwqkn-17.png:drop | 6 |
| upload:m58-stress-mriiwqkn-17.png:accept-btn | 121 |
| upload:m58-stress-mriiwqkn-17.png:accept-click | 292 |
| upload:m58-stress-mriiwqkn-17.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-17.png | 5419 |
| upload:m58-stress-mriiwqkn-18.png:drop | 6 |
| upload:m58-stress-mriiwqkn-18.png:accept-btn | 125 |
| upload:m58-stress-mriiwqkn-18.png:accept-click | 280 |
| upload:m58-stress-mriiwqkn-18.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-18.png | 5412 |
| upload:m58-stress-mriiwqkn-19.png:drop | 6 |
| upload:m58-stress-mriiwqkn-19.png:accept-btn | 140 |
| upload:m58-stress-mriiwqkn-19.png:accept-click | 275 |
| upload:m58-stress-mriiwqkn-19.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-19.png | 5421 |
| upload:m58-stress-mriiwqkn-20.png:drop | 24 |
| upload:m58-stress-mriiwqkn-20.png:accept-btn | 171 |
| upload:m58-stress-mriiwqkn-20.png:accept-click | 280 |
| upload:m58-stress-mriiwqkn-20.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-20.png | 5475 |
| upload:m58-stress-mriiwqkn-21.png:drop | 6 |
| upload:m58-stress-mriiwqkn-21.png:accept-btn | 184 |
| upload:m58-stress-mriiwqkn-21.png:accept-click | 365 |
| upload:m58-stress-mriiwqkn-21.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-21.png | 5555 |
| upload:m58-stress-mriiwqkn-22.png:drop | 9 |
| upload:m58-stress-mriiwqkn-22.png:accept-btn | 98 |
| upload:m58-stress-mriiwqkn-22.png:accept-click | 288 |
| upload:m58-stress-mriiwqkn-22.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-22.png | 5395 |
| upload:m58-stress-mriiwqkn-23.png:drop | 42 |
| upload:m58-stress-mriiwqkn-23.png:accept-btn | 162 |
| upload:m58-stress-mriiwqkn-23.png:accept-click | 247 |
| upload:m58-stress-mriiwqkn-23.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-23.png | 5453 |
| upload:m58-stress-mriiwqkn-24.png:drop | 22 |
| upload:m58-stress-mriiwqkn-24.png:accept-btn | 145 |
| upload:m58-stress-mriiwqkn-24.png:accept-click | 307 |
| upload:m58-stress-mriiwqkn-24.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-24.png | 5475 |
| upload:m58-stress-mriiwqkn-25.png:drop | 24 |
| upload:m58-stress-mriiwqkn-25.png:accept-btn | 115 |
| upload:m58-stress-mriiwqkn-25.png:accept-click | 323 |
| upload:m58-stress-mriiwqkn-25.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-25.png | 5461 |
| upload:m58-stress-mriiwqkn-26.png:drop | 10 |
| upload:m58-stress-mriiwqkn-26.png:accept-btn | 152 |
| upload:m58-stress-mriiwqkn-26.png:accept-click | 303 |
| upload:m58-stress-mriiwqkn-26.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-26.png | 5465 |
| upload:m58-stress-mriiwqkn-27.png:drop | 21 |
| upload:m58-stress-mriiwqkn-27.png:accept-btn | 141 |
| upload:m58-stress-mriiwqkn-27.png:accept-click | 298 |
| upload:m58-stress-mriiwqkn-27.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-27.png | 5460 |
| upload:m58-stress-mriiwqkn-28.png:drop | 8 |
| upload:m58-stress-mriiwqkn-28.png:accept-btn | 92 |
| upload:m58-stress-mriiwqkn-28.png:accept-click | 324 |
| upload:m58-stress-mriiwqkn-28.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-28.png | 5425 |
| upload:m58-stress-mriiwqkn-29.png:drop | 7 |
| upload:m58-stress-mriiwqkn-29.png:accept-btn | 144 |
| upload:m58-stress-mriiwqkn-29.png:accept-click | 285 |
| upload:m58-stress-mriiwqkn-29.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-29.png | 5436 |
| upload:m58-stress-mriiwqkn-30.png:drop | 63 |
| upload:m58-stress-mriiwqkn-30.png:accept-btn | 151 |
| upload:m58-stress-mriiwqkn-30.png:accept-click | 233 |
| upload:m58-stress-mriiwqkn-30.png:sleep | 5003 |
| upload:m58-stress-mriiwqkn-30.png | 5450 |
| upload:m58-stress-mriiwqkn-31.png:drop | 90 |
| upload:m58-stress-mriiwqkn-31.png:accept-btn | 189 |
| upload:m58-stress-mriiwqkn-31.png:accept-click | 346 |
| upload:m58-stress-mriiwqkn-31.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-31.png | 5625 |
| upload:m58-stress-mriiwqkn-32.png:drop | 9 |
| upload:m58-stress-mriiwqkn-32.png:accept-btn | 129 |
| upload:m58-stress-mriiwqkn-32.png:accept-click | 353 |
| upload:m58-stress-mriiwqkn-32.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-32.png | 5492 |
| upload:m58-stress-mriiwqkn-33.png:drop | 9 |
| upload:m58-stress-mriiwqkn-33.png:accept-btn | 100 |
| upload:m58-stress-mriiwqkn-33.png:accept-click | 235 |
| upload:m58-stress-mriiwqkn-33.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-33.png | 5344 |
| upload:m58-stress-mriiwqkn-34.png:drop | 22 |
| upload:m58-stress-mriiwqkn-34.png:accept-btn | 132 |
| upload:m58-stress-mriiwqkn-34.png:accept-click | 303 |
| upload:m58-stress-mriiwqkn-34.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-34.png | 5457 |
| upload:m58-stress-mriiwqkn-35.png:drop | 49 |
| upload:m58-stress-mriiwqkn-35.png:accept-btn | 211 |
| upload:m58-stress-mriiwqkn-35.png:accept-click | 235 |
| upload:m58-stress-mriiwqkn-35.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-35.png | 5496 |
| upload:m58-stress-mriiwqkn-36.png:drop | 23 |
| upload:m58-stress-mriiwqkn-36.png:accept-btn | 116 |
| upload:m58-stress-mriiwqkn-36.png:accept-click | 292 |
| upload:m58-stress-mriiwqkn-36.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-36.png | 5431 |
| upload:m58-stress-mriiwqkn-37.png:drop | 24 |
| upload:m58-stress-mriiwqkn-37.png:accept-btn | 92 |
| upload:m58-stress-mriiwqkn-37.png:accept-click | 277 |
| upload:m58-stress-mriiwqkn-37.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-37.png | 5394 |
| upload:m58-stress-mriiwqkn-38.png:drop | 41 |
| upload:m58-stress-mriiwqkn-38.png:accept-btn | 152 |
| upload:m58-stress-mriiwqkn-38.png:accept-click | 260 |
| upload:m58-stress-mriiwqkn-38.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-38.png | 5454 |
| upload:m58-stress-mriiwqkn-39.png:drop | 5 |
| upload:m58-stress-mriiwqkn-39.png:accept-btn | 123 |
| upload:m58-stress-mriiwqkn-39.png:accept-click | 279 |
| upload:m58-stress-mriiwqkn-39.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-39.png | 5407 |
| upload:m58-stress-mriiwqkn-40.png:drop | 5 |
| upload:m58-stress-mriiwqkn-40.png:accept-btn | 131 |
| upload:m58-stress-mriiwqkn-40.png:accept-click | 315 |
| upload:m58-stress-mriiwqkn-40.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-40.png | 5452 |
| upload:m58-stress-mriiwqkn-41.png:drop | 26 |
| upload:m58-stress-mriiwqkn-41.png:accept-btn | 174 |
| upload:m58-stress-mriiwqkn-41.png:accept-click | 333 |
| upload:m58-stress-mriiwqkn-41.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-41.png | 5533 |
| upload:m58-stress-mriiwqkn-42.png:drop | 5 |
| upload:m58-stress-mriiwqkn-42.png:accept-btn | 141 |
| upload:m58-stress-mriiwqkn-42.png:accept-click | 259 |
| upload:m58-stress-mriiwqkn-42.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-42.png | 5407 |
| upload:m58-stress-mriiwqkn-43.png:drop | 24 |
| upload:m58-stress-mriiwqkn-43.png:accept-btn | 110 |
| upload:m58-stress-mriiwqkn-43.png:accept-click | 307 |
| upload:m58-stress-mriiwqkn-43.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-43.png | 5442 |
| upload:m58-stress-mriiwqkn-44.png:drop | 5 |
| upload:m58-stress-mriiwqkn-44.png:accept-btn | 145 |
| upload:m58-stress-mriiwqkn-44.png:accept-click | 225 |
| upload:m58-stress-mriiwqkn-44.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-44.png | 5377 |
| upload:m58-stress-mriiwqkn-45.png:drop | 6 |
| upload:m58-stress-mriiwqkn-45.png:accept-btn | 160 |
| upload:m58-stress-mriiwqkn-45.png:accept-click | 310 |
| upload:m58-stress-mriiwqkn-45.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-45.png | 5477 |
| upload:m58-stress-mriiwqkn-46.png:drop | 10 |
| upload:m58-stress-mriiwqkn-46.png:accept-btn | 152 |
| upload:m58-stress-mriiwqkn-46.png:accept-click | 306 |
| upload:m58-stress-mriiwqkn-46.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-46.png | 5470 |
| upload:m58-stress-mriiwqkn-47.png:drop | 8 |
| upload:m58-stress-mriiwqkn-47.png:accept-btn | 91 |
| upload:m58-stress-mriiwqkn-47.png:accept-click | 458 |
| upload:m58-stress-mriiwqkn-47.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-47.png | 5557 |
| upload:m58-stress-mriiwqkn-48.png:drop | 10 |
| upload:m58-stress-mriiwqkn-48.png:accept-btn | 110 |
| upload:m58-stress-mriiwqkn-48.png:accept-click | 236 |
| upload:m58-stress-mriiwqkn-48.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-48.png | 5356 |
| upload:m58-stress-mriiwqkn-49.png:drop | 23 |
| upload:m58-stress-mriiwqkn-49.png:accept-btn | 151 |
| upload:m58-stress-mriiwqkn-49.png:accept-click | 384 |
| upload:m58-stress-mriiwqkn-49.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-49.png | 5558 |
| upload:m58-stress-mriiwqkn-50.png:drop | 6 |
| upload:m58-stress-mriiwqkn-50.png:accept-btn | 170 |
| upload:m58-stress-mriiwqkn-50.png:accept-click | 315 |
| upload:m58-stress-mriiwqkn-50.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-50.png | 5491 |
| upload:m58-stress-mriiwqkn-51.png:drop | 8 |
| upload:m58-stress-mriiwqkn-51.png:accept-btn | 109 |
| upload:m58-stress-mriiwqkn-51.png:accept-click | 334 |
| upload:m58-stress-mriiwqkn-51.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-51.png | 5451 |
| upload:m58-stress-mriiwqkn-52.png:drop | 25 |
| upload:m58-stress-mriiwqkn-52.png:accept-btn | 134 |
| upload:m58-stress-mriiwqkn-52.png:accept-click | 279 |
| upload:m58-stress-mriiwqkn-52.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-52.png | 5438 |
| upload:m58-stress-mriiwqkn-53.png:drop | 118 |
| upload:m58-stress-mriiwqkn-53.png:accept-btn | 143 |
| upload:m58-stress-mriiwqkn-53.png:accept-click | 335 |
| upload:m58-stress-mriiwqkn-53.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-53.png | 5596 |
| upload:m58-stress-mriiwqkn-54.png:drop | 70 |
| upload:m58-stress-mriiwqkn-54.png:accept-btn | 166 |
| upload:m58-stress-mriiwqkn-54.png:accept-click | 306 |
| upload:m58-stress-mriiwqkn-54.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-54.png | 5542 |
| upload:m58-stress-mriiwqkn-55.png:drop | 6 |
| upload:m58-stress-mriiwqkn-55.png:accept-btn | 139 |
| upload:m58-stress-mriiwqkn-55.png:accept-click | 297 |
| upload:m58-stress-mriiwqkn-55.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-55.png | 5443 |
| upload:m58-stress-mriiwqkn-56.png:drop | 6 |
| upload:m58-stress-mriiwqkn-56.png:accept-btn | 134 |
| upload:m58-stress-mriiwqkn-56.png:accept-click | 331 |
| upload:m58-stress-mriiwqkn-56.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-56.png | 5471 |
| upload:m58-stress-mriiwqkn-57.png:drop | 6 |
| upload:m58-stress-mriiwqkn-57.png:accept-btn | 182 |
| upload:m58-stress-mriiwqkn-57.png:accept-click | 322 |
| upload:m58-stress-mriiwqkn-57.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-57.png | 5511 |
| upload:m58-stress-mriiwqkn-58.png:drop | 23 |
| upload:m58-stress-mriiwqkn-58.png:accept-btn | 121 |
| upload:m58-stress-mriiwqkn-58.png:accept-click | 298 |
| upload:m58-stress-mriiwqkn-58.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-58.png | 5442 |
| upload:m58-stress-mriiwqkn-59.png:drop | 6 |
| upload:m58-stress-mriiwqkn-59.png:accept-btn | 130 |
| upload:m58-stress-mriiwqkn-59.png:accept-click | 339 |
| upload:m58-stress-mriiwqkn-59.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-59.png | 5475 |
| upload:m58-stress-mriiwqkn-60.png:drop | 20 |
| upload:m58-stress-mriiwqkn-60.png:accept-btn | 106 |
| upload:m58-stress-mriiwqkn-60.png:accept-click | 300 |
| upload:m58-stress-mriiwqkn-60.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-60.png | 5427 |
| upload:m58-stress-mriiwqkn-61.png:drop | 25 |
| upload:m58-stress-mriiwqkn-61.png:accept-btn | 177 |
| upload:m58-stress-mriiwqkn-61.png:accept-click | 265 |
| upload:m58-stress-mriiwqkn-61.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-61.png | 5468 |
| upload:m58-stress-mriiwqkn-62.png:drop | 28 |
| upload:m58-stress-mriiwqkn-62.png:accept-btn | 68 |
| upload:m58-stress-mriiwqkn-62.png:accept-click | 458 |
| upload:m58-stress-mriiwqkn-62.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-62.png | 5554 |
| upload:m58-stress-mriiwqkn-63.png:drop | 9 |
| upload:m58-stress-mriiwqkn-63.png:accept-btn | 157 |
| upload:m58-stress-mriiwqkn-63.png:accept-click | 224 |
| upload:m58-stress-mriiwqkn-63.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-63.png | 5390 |
| upload:m58-stress-mriiwqkn-64.png:drop | 19 |
| upload:m58-stress-mriiwqkn-64.png:accept-btn | 96 |
| upload:m58-stress-mriiwqkn-64.png:accept-click | 310 |
| upload:m58-stress-mriiwqkn-64.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-64.png | 5425 |
| upload:m58-stress-mriiwqkn-65.png:drop | 32 |
| upload:m58-stress-mriiwqkn-65.png:accept-btn | 107 |
| upload:m58-stress-mriiwqkn-65.png:accept-click | 321 |
| upload:m58-stress-mriiwqkn-65.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-65.png | 5460 |
| upload:m58-stress-mriiwqkn-66.png:drop | 23 |
| upload:m58-stress-mriiwqkn-66.png:accept-btn | 130 |
| upload:m58-stress-mriiwqkn-66.png:accept-click | 281 |
| upload:m58-stress-mriiwqkn-66.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-66.png | 5435 |
| upload:m58-stress-mriiwqkn-67.png:drop | 24 |
| upload:m58-stress-mriiwqkn-67.png:accept-btn | 161 |
| upload:m58-stress-mriiwqkn-67.png:accept-click | 312 |
| upload:m58-stress-mriiwqkn-67.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-67.png | 5497 |
| upload:m58-stress-mriiwqkn-68.png:drop | 5 |
| upload:m58-stress-mriiwqkn-68.png:accept-btn | 156 |
| upload:m58-stress-mriiwqkn-68.png:accept-click | 271 |
| upload:m58-stress-mriiwqkn-68.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-68.png | 5432 |
| upload:m58-stress-mriiwqkn-69.png:drop | 31 |
| upload:m58-stress-mriiwqkn-69.png:accept-btn | 171 |
| upload:m58-stress-mriiwqkn-69.png:accept-click | 385 |
| upload:m58-stress-mriiwqkn-69.png:sleep | 5004 |
| upload:m58-stress-mriiwqkn-69.png | 5591 |
| upload:m58-stress-mriiwqkn-70.png:drop | 22 |
| upload:m58-stress-mriiwqkn-70.png:accept-btn | 136 |
| upload:m58-stress-mriiwqkn-70.png:accept-click | 292 |
| upload:m58-stress-mriiwqkn-70.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-70.png | 5451 |
| upload:m58-stress-mriiwqkn-71.png:drop | 33 |
| upload:m58-stress-mriiwqkn-71.png:accept-btn | 322 |
| upload:m58-stress-mriiwqkn-71.png:accept-click | 284 |
| upload:m58-stress-mriiwqkn-71.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-71.png | 5640 |
| upload:m58-stress-mriiwqkn-72.png:drop | 9 |
| upload:m58-stress-mriiwqkn-72.png:accept-btn | 112 |
| upload:m58-stress-mriiwqkn-72.png:accept-click | 341 |
| upload:m58-stress-mriiwqkn-72.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-72.png | 5462 |
| upload:m58-stress-mriiwqkn-73.png:drop | 5 |
| upload:m58-stress-mriiwqkn-73.png:accept-btn | 127 |
| upload:m58-stress-mriiwqkn-73.png:accept-click | 228 |
| upload:m58-stress-mriiwqkn-73.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-73.png | 5360 |
| upload:m58-stress-mriiwqkn-74.png:drop | 39 |
| upload:m58-stress-mriiwqkn-74.png:accept-btn | 116 |
| upload:m58-stress-mriiwqkn-74.png:accept-click | 298 |
| upload:m58-stress-mriiwqkn-74.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-74.png | 5454 |
| upload:m58-stress-mriiwqkn-75.png:drop | 21 |
| upload:m58-stress-mriiwqkn-75.png:accept-btn | 132 |
| upload:m58-stress-mriiwqkn-75.png:accept-click | 301 |
| upload:m58-stress-mriiwqkn-75.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-75.png | 5454 |
| upload:m58-stress-mriiwqkn-76.png:drop | 27 |
| upload:m58-stress-mriiwqkn-76.png:accept-btn | 155 |
| upload:m58-stress-mriiwqkn-76.png:accept-click | 334 |
| upload:m58-stress-mriiwqkn-76.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-76.png | 5517 |
| upload:m58-stress-mriiwqkn-77.png:drop | 6 |
| upload:m58-stress-mriiwqkn-77.png:accept-btn | 124 |
| upload:m58-stress-mriiwqkn-77.png:accept-click | 337 |
| upload:m58-stress-mriiwqkn-77.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-77.png | 5467 |
| upload:m58-stress-mriiwqkn-78.png:drop | 6 |
| upload:m58-stress-mriiwqkn-78.png:accept-btn | 151 |
| upload:m58-stress-mriiwqkn-78.png:accept-click | 371 |
| upload:m58-stress-mriiwqkn-78.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-78.png | 5528 |
| upload:m58-stress-mriiwqkn-79.png:drop | 30 |
| upload:m58-stress-mriiwqkn-79.png:accept-btn | 87 |
| upload:m58-stress-mriiwqkn-79.png:accept-click | 402 |
| upload:m58-stress-mriiwqkn-79.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-79.png | 5519 |
| upload:m58-stress-mriiwqkn-80.png:drop | 23 |
| upload:m58-stress-mriiwqkn-80.png:accept-btn | 113 |
| upload:m58-stress-mriiwqkn-80.png:accept-click | 338 |
| upload:m58-stress-mriiwqkn-80.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-80.png | 5475 |
| upload:m58-stress-mriiwqkn-81.png:drop | 6 |
| upload:m58-stress-mriiwqkn-81.png:accept-btn | 108 |
| upload:m58-stress-mriiwqkn-81.png:accept-click | 355 |
| upload:m58-stress-mriiwqkn-81.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-81.png | 5469 |
| upload:m58-stress-mriiwqkn-82.png:drop | 6 |
| upload:m58-stress-mriiwqkn-82.png:accept-btn | 184 |
| upload:m58-stress-mriiwqkn-82.png:accept-click | 202 |
| upload:m58-stress-mriiwqkn-82.png:sleep | 5001 |
| upload:m58-stress-mriiwqkn-82.png | 5393 |
| upload:m58-stress-mriiwqkn-83.png:drop | 22 |
| upload:m58-stress-mriiwqkn-83.png:accept-btn | 140 |
| upload:m58-stress-mriiwqkn-83.png:accept-click | 238 |
| upload:m58-stress-mriiwqkn-83.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-83.png | 5401 |
| upload:m58-stress-mriiwqkn-84.png:drop | 24 |
| upload:m58-stress-mriiwqkn-84.png:accept-btn | 167 |
| upload:m58-stress-mriiwqkn-84.png:accept-click | 467 |
| upload:m58-stress-mriiwqkn-84.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-84.png | 5659 |
| upload:m58-stress-mriiwqkn-85.png:drop | 5 |
| upload:m58-stress-mriiwqkn-85.png:accept-btn | 161 |
| upload:m58-stress-mriiwqkn-85.png:accept-click | 248 |
| upload:m58-stress-mriiwqkn-85.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-85.png | 5416 |
| upload:m58-stress-mriiwqkn-86.png:drop | 15 |
| upload:m58-stress-mriiwqkn-86.png:accept-btn | 154 |
| upload:m58-stress-mriiwqkn-86.png:accept-click | 350 |
| upload:m58-stress-mriiwqkn-86.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-86.png | 5520 |
| upload:m58-stress-mriiwqkn-87.png:drop | 22 |
| upload:m58-stress-mriiwqkn-87.png:accept-btn | 122 |
| upload:m58-stress-mriiwqkn-87.png:accept-click | 285 |
| upload:m58-stress-mriiwqkn-87.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-87.png | 5429 |
| upload:m58-stress-mriiwqkn-88.png:drop | 23 |
| upload:m58-stress-mriiwqkn-88.png:accept-btn | 151 |
| upload:m58-stress-mriiwqkn-88.png:accept-click | 316 |
| upload:m58-stress-mriiwqkn-88.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-88.png | 5491 |
| upload:m58-stress-mriiwqkn-89.png:drop | 24 |
| upload:m58-stress-mriiwqkn-89.png:accept-btn | 140 |
| upload:m58-stress-mriiwqkn-89.png:accept-click | 274 |
| upload:m58-stress-mriiwqkn-89.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-89.png | 5438 |
| upload:m58-stress-mriiwqkn-90.png:drop | 24 |
| upload:m58-stress-mriiwqkn-90.png:accept-btn | 80 |
| upload:m58-stress-mriiwqkn-90.png:accept-click | 241 |
| upload:m58-stress-mriiwqkn-90.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-90.png | 5346 |
| upload:m58-stress-mriiwqkn-91.png:drop | 9 |
| upload:m58-stress-mriiwqkn-91.png:accept-btn | 110 |
| upload:m58-stress-mriiwqkn-91.png:accept-click | 378 |
| upload:m58-stress-mriiwqkn-91.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-91.png | 5496 |
| upload:m58-stress-mriiwqkn-92.png:drop | 25 |
| upload:m58-stress-mriiwqkn-92.png:accept-btn | 160 |
| upload:m58-stress-mriiwqkn-92.png:accept-click | 259 |
| upload:m58-stress-mriiwqkn-92.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-92.png | 5445 |
| upload:m58-stress-mriiwqkn-93.png:drop | 38 |
| upload:m58-stress-mriiwqkn-93.png:accept-btn | 126 |
| upload:m58-stress-mriiwqkn-93.png:accept-click | 272 |
| upload:m58-stress-mriiwqkn-93.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-93.png | 5436 |
| upload:m58-stress-mriiwqkn-94.png:drop | 24 |
| upload:m58-stress-mriiwqkn-94.png:accept-btn | 112 |
| upload:m58-stress-mriiwqkn-94.png:accept-click | 298 |
| upload:m58-stress-mriiwqkn-94.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-94.png | 5434 |
| upload:m58-stress-mriiwqkn-95.png:drop | 53 |
| upload:m58-stress-mriiwqkn-95.png:accept-btn | 178 |
| upload:m58-stress-mriiwqkn-95.png:accept-click | 316 |
| upload:m58-stress-mriiwqkn-95.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-95.png | 5547 |
| upload:m58-stress-mriiwqkn-96.png:drop | 21 |
| upload:m58-stress-mriiwqkn-96.png:accept-btn | 140 |
| upload:m58-stress-mriiwqkn-96.png:accept-click | 189 |
| upload:m58-stress-mriiwqkn-96.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-96.png | 5350 |
| upload:m58-stress-mriiwqkn-97.png:drop | 21 |
| upload:m58-stress-mriiwqkn-97.png:accept-btn | 109 |
| upload:m58-stress-mriiwqkn-97.png:accept-click | 346 |
| upload:m58-stress-mriiwqkn-97.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-97.png | 5476 |
| upload:m58-stress-mriiwqkn-98.png:drop | 47 |
| upload:m58-stress-mriiwqkn-98.png:accept-btn | 129 |
| upload:m58-stress-mriiwqkn-98.png:accept-click | 253 |
| upload:m58-stress-mriiwqkn-98.png:sleep | 4999 |
| upload:m58-stress-mriiwqkn-98.png | 5428 |
| upload:m58-stress-mriiwqkn-99.png:drop | 9 |
| upload:m58-stress-mriiwqkn-99.png:accept-btn | 100 |
| upload:m58-stress-mriiwqkn-99.png:accept-click | 313 |
| upload:m58-stress-mriiwqkn-99.png:sleep | 5000 |
| upload:m58-stress-mriiwqkn-99.png | 5423 |
| upload:m58-del-mriiwqkn-0.png:drop | 13 |
| upload:m58-del-mriiwqkn-0.png:accept-btn | 95 |
| upload:m58-del-mriiwqkn-0.png:accept-click | 254 |
| upload:m58-del-mriiwqkn-0.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-0.png | 5362 |
| upload:m58-del-mriiwqkn-1.png:drop | 10 |
| upload:m58-del-mriiwqkn-1.png:accept-btn | 115 |
| upload:m58-del-mriiwqkn-1.png:accept-click | 328 |
| upload:m58-del-mriiwqkn-1.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-1.png | 5454 |
| upload:m58-del-mriiwqkn-2.png:drop | 21 |
| upload:m58-del-mriiwqkn-2.png:accept-btn | 147 |
| upload:m58-del-mriiwqkn-2.png:accept-click | 283 |
| upload:m58-del-mriiwqkn-2.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-2.png | 5452 |
| upload:m58-del-mriiwqkn-3.png:drop | 7 |
| upload:m58-del-mriiwqkn-3.png:accept-btn | 124 |
| upload:m58-del-mriiwqkn-3.png:accept-click | 266 |
| upload:m58-del-mriiwqkn-3.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-3.png | 5397 |
| upload:m58-del-mriiwqkn-4.png:drop | 17 |
| upload:m58-del-mriiwqkn-4.png:accept-btn | 127 |
| upload:m58-del-mriiwqkn-4.png:accept-click | 163 |
| upload:m58-del-mriiwqkn-4.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-4.png | 5309 |
| upload:m58-del-mriiwqkn-5.png:drop | 8 |
| upload:m58-del-mriiwqkn-5.png:accept-btn | 84 |
| upload:m58-del-mriiwqkn-5.png:accept-click | 493 |
| upload:m58-del-mriiwqkn-5.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-5.png | 5586 |
| upload:m58-del-mriiwqkn-6.png:drop | 27 |
| upload:m58-del-mriiwqkn-6.png:accept-btn | 133 |
| upload:m58-del-mriiwqkn-6.png:accept-click | 332 |
| upload:m58-del-mriiwqkn-6.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-6.png | 5494 |
| upload:m58-del-mriiwqkn-7.png:drop | 15 |
| upload:m58-del-mriiwqkn-7.png:accept-btn | 119 |
| upload:m58-del-mriiwqkn-7.png:accept-click | 300 |
| upload:m58-del-mriiwqkn-7.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-7.png | 5436 |
| upload:m58-del-mriiwqkn-8.png:drop | 36 |
| upload:m58-del-mriiwqkn-8.png:accept-btn | 108 |
| upload:m58-del-mriiwqkn-8.png:accept-click | 304 |
| upload:m58-del-mriiwqkn-8.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-8.png | 5448 |
| upload:m58-del-mriiwqkn-9.png:drop | 11 |
| upload:m58-del-mriiwqkn-9.png:accept-btn | 130 |
| upload:m58-del-mriiwqkn-9.png:accept-click | 394 |
| upload:m58-del-mriiwqkn-9.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-9.png | 5535 |
| upload:m58-del-mriiwqkn-10.png:drop | 32 |
| upload:m58-del-mriiwqkn-10.png:accept-btn | 122 |
| upload:m58-del-mriiwqkn-10.png:accept-click | 297 |
| upload:m58-del-mriiwqkn-10.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-10.png | 5452 |
| upload:m58-del-mriiwqkn-11.png:drop | 13 |
| upload:m58-del-mriiwqkn-11.png:accept-btn | 193 |
| upload:m58-del-mriiwqkn-11.png:accept-click | 278 |
| upload:m58-del-mriiwqkn-11.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-11.png | 5484 |
| upload:m58-del-mriiwqkn-12.png:drop | 35 |
| upload:m58-del-mriiwqkn-12.png:accept-btn | 218 |
| upload:m58-del-mriiwqkn-12.png:accept-click | 295 |
| upload:m58-del-mriiwqkn-12.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-12.png | 5548 |
| upload:m58-del-mriiwqkn-13.png:drop | 35 |
| upload:m58-del-mriiwqkn-13.png:accept-btn | 83 |
| upload:m58-del-mriiwqkn-13.png:accept-click | 271 |
| upload:m58-del-mriiwqkn-13.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-13.png | 5390 |
| upload:m58-del-mriiwqkn-14.png:drop | 65 |
| upload:m58-del-mriiwqkn-14.png:accept-btn | 180 |
| upload:m58-del-mriiwqkn-14.png:accept-click | 206 |
| upload:m58-del-mriiwqkn-14.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-14.png | 5451 |
| upload:m58-del-mriiwqkn-15.png:drop | 29 |
| upload:m58-del-mriiwqkn-15.png:accept-btn | 189 |
| upload:m58-del-mriiwqkn-15.png:accept-click | 263 |
| upload:m58-del-mriiwqkn-15.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-15.png | 5482 |
| upload:m58-del-mriiwqkn-16.png:drop | 69 |
| upload:m58-del-mriiwqkn-16.png:accept-btn | 131 |
| upload:m58-del-mriiwqkn-16.png:accept-click | 263 |
| upload:m58-del-mriiwqkn-16.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-16.png | 5464 |
| upload:m58-del-mriiwqkn-17.png:drop | 16 |
| upload:m58-del-mriiwqkn-17.png:accept-btn | 167 |
| upload:m58-del-mriiwqkn-17.png:accept-click | 295 |
| upload:m58-del-mriiwqkn-17.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-17.png | 5479 |
| upload:m58-del-mriiwqkn-18.png:drop | 17 |
| upload:m58-del-mriiwqkn-18.png:accept-btn | 127 |
| upload:m58-del-mriiwqkn-18.png:accept-click | 258 |
| upload:m58-del-mriiwqkn-18.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-18.png | 5402 |
| upload:m58-del-mriiwqkn-19.png:drop | 37 |
| upload:m58-del-mriiwqkn-19.png:accept-btn | 136 |
| upload:m58-del-mriiwqkn-19.png:accept-click | 257 |
| upload:m58-del-mriiwqkn-19.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-19.png | 5432 |
| upload:m58-del-mriiwqkn-20.png:drop | 19 |
| upload:m58-del-mriiwqkn-20.png:accept-btn | 162 |
| upload:m58-del-mriiwqkn-20.png:accept-click | 312 |
| upload:m58-del-mriiwqkn-20.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-20.png | 5494 |
| upload:m58-del-mriiwqkn-21.png:drop | 50 |
| upload:m58-del-mriiwqkn-21.png:accept-btn | 95 |
| upload:m58-del-mriiwqkn-21.png:accept-click | 335 |
| upload:m58-del-mriiwqkn-21.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-21.png | 5481 |
| upload:m58-del-mriiwqkn-22.png:drop | 56 |
| upload:m58-del-mriiwqkn-22.png:accept-btn | 151 |
| upload:m58-del-mriiwqkn-22.png:accept-click | 303 |
| upload:m58-del-mriiwqkn-22.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-22.png | 5511 |
| upload:m58-del-mriiwqkn-23.png:drop | 14 |
| upload:m58-del-mriiwqkn-23.png:accept-btn | 152 |
| upload:m58-del-mriiwqkn-23.png:accept-click | 223 |
| upload:m58-del-mriiwqkn-23.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-23.png | 5390 |
| upload:m58-del-mriiwqkn-24.png:drop | 34 |
| upload:m58-del-mriiwqkn-24.png:accept-btn | 129 |
| upload:m58-del-mriiwqkn-24.png:accept-click | 305 |
| upload:m58-del-mriiwqkn-24.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-24.png | 5469 |
| upload:m58-del-mriiwqkn-25.png:drop | 13 |
| upload:m58-del-mriiwqkn-25.png:accept-btn | 189 |
| upload:m58-del-mriiwqkn-25.png:accept-click | 305 |
| upload:m58-del-mriiwqkn-25.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-25.png | 5509 |
| upload:m58-del-mriiwqkn-26.png:drop | 16 |
| upload:m58-del-mriiwqkn-26.png:accept-btn | 125 |
| upload:m58-del-mriiwqkn-26.png:accept-click | 376 |
| upload:m58-del-mriiwqkn-26.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-26.png | 5516 |
| upload:m58-del-mriiwqkn-27.png:drop | 31 |
| upload:m58-del-mriiwqkn-27.png:accept-btn | 152 |
| upload:m58-del-mriiwqkn-27.png:accept-click | 305 |
| upload:m58-del-mriiwqkn-27.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-27.png | 5489 |
| upload:m58-del-mriiwqkn-28.png:drop | 30 |
| upload:m58-del-mriiwqkn-28.png:accept-btn | 200 |
| upload:m58-del-mriiwqkn-28.png:accept-click | 314 |
| upload:m58-del-mriiwqkn-28.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-28.png | 5545 |
| upload:m58-del-mriiwqkn-29.png:drop | 32 |
| upload:m58-del-mriiwqkn-29.png:accept-btn | 162 |
| upload:m58-del-mriiwqkn-29.png:accept-click | 404 |
| upload:m58-del-mriiwqkn-29.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-29.png | 5599 |
| upload:m58-del-mriiwqkn-30.png:drop | 9 |
| upload:m58-del-mriiwqkn-30.png:accept-btn | 162 |
| upload:m58-del-mriiwqkn-30.png:accept-click | 356 |
| upload:m58-del-mriiwqkn-30.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-30.png | 5527 |
| upload:m58-del-mriiwqkn-31.png:drop | 14 |
| upload:m58-del-mriiwqkn-31.png:accept-btn | 152 |
| upload:m58-del-mriiwqkn-31.png:accept-click | 374 |
| upload:m58-del-mriiwqkn-31.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-31.png | 5540 |
| upload:m58-del-mriiwqkn-32.png:drop | 19 |
| upload:m58-del-mriiwqkn-32.png:accept-btn | 154 |
| upload:m58-del-mriiwqkn-32.png:accept-click | 283 |
| upload:m58-del-mriiwqkn-32.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-32.png | 5457 |
| upload:m58-del-mriiwqkn-33.png:drop | 27 |
| upload:m58-del-mriiwqkn-33.png:accept-btn | 115 |
| upload:m58-del-mriiwqkn-33.png:accept-click | 360 |
| upload:m58-del-mriiwqkn-33.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-33.png | 5502 |
| upload:m58-del-mriiwqkn-34.png:drop | 24 |
| upload:m58-del-mriiwqkn-34.png:accept-btn | 169 |
| upload:m58-del-mriiwqkn-34.png:accept-click | 560 |
| upload:m58-del-mriiwqkn-34.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-34.png | 5754 |
| upload:m58-del-mriiwqkn-35.png:drop | 22 |
| upload:m58-del-mriiwqkn-35.png:accept-btn | 167 |
| upload:m58-del-mriiwqkn-35.png:accept-click | 263 |
| upload:m58-del-mriiwqkn-35.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-35.png | 5455 |
| upload:m58-del-mriiwqkn-36.png:drop | 31 |
| upload:m58-del-mriiwqkn-36.png:accept-btn | 212 |
| upload:m58-del-mriiwqkn-36.png:accept-click | 348 |
| upload:m58-del-mriiwqkn-36.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-36.png | 5592 |
| upload:m58-del-mriiwqkn-37.png:drop | 16 |
| upload:m58-del-mriiwqkn-37.png:accept-btn | 174 |
| upload:m58-del-mriiwqkn-37.png:accept-click | 290 |
| upload:m58-del-mriiwqkn-37.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-37.png | 5482 |
| upload:m58-del-mriiwqkn-38.png:drop | 8 |
| upload:m58-del-mriiwqkn-38.png:accept-btn | 147 |
| upload:m58-del-mriiwqkn-38.png:accept-click | 277 |
| upload:m58-del-mriiwqkn-38.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-38.png | 5432 |
| upload:m58-del-mriiwqkn-39.png:drop | 32 |
| upload:m58-del-mriiwqkn-39.png:accept-btn | 108 |
| upload:m58-del-mriiwqkn-39.png:accept-click | 344 |
| upload:m58-del-mriiwqkn-39.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-39.png | 5485 |
| upload:m58-del-mriiwqkn-40.png:drop | 95 |
| upload:m58-del-mriiwqkn-40.png:accept-btn | 231 |
| upload:m58-del-mriiwqkn-40.png:accept-click | 331 |
| upload:m58-del-mriiwqkn-40.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-40.png | 5657 |
| upload:m58-del-mriiwqkn-41.png:drop | 19 |
| upload:m58-del-mriiwqkn-41.png:accept-btn | 111 |
| upload:m58-del-mriiwqkn-41.png:accept-click | 337 |
| upload:m58-del-mriiwqkn-41.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-41.png | 5468 |
| upload:m58-del-mriiwqkn-42.png:drop | 24 |
| upload:m58-del-mriiwqkn-42.png:accept-btn | 58 |
| upload:m58-del-mriiwqkn-42.png:accept-click | 272 |
| upload:m58-del-mriiwqkn-42.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-42.png | 5354 |
| upload:m58-del-mriiwqkn-43.png:drop | 16 |
| upload:m58-del-mriiwqkn-43.png:accept-btn | 226 |
| upload:m58-del-mriiwqkn-43.png:accept-click | 403 |
| upload:m58-del-mriiwqkn-43.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-43.png | 5646 |
| upload:m58-del-mriiwqkn-44.png:drop | 31 |
| upload:m58-del-mriiwqkn-44.png:accept-btn | 142 |
| upload:m58-del-mriiwqkn-44.png:accept-click | 296 |
| upload:m58-del-mriiwqkn-44.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-44.png | 5471 |
| upload:m58-del-mriiwqkn-45.png:drop | 23 |
| upload:m58-del-mriiwqkn-45.png:accept-btn | 140 |
| upload:m58-del-mriiwqkn-45.png:accept-click | 317 |
| upload:m58-del-mriiwqkn-45.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-45.png | 5481 |
| upload:m58-del-mriiwqkn-46.png:drop | 67 |
| upload:m58-del-mriiwqkn-46.png:accept-btn | 181 |
| upload:m58-del-mriiwqkn-46.png:accept-click | 464 |
| upload:m58-del-mriiwqkn-46.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-46.png | 5712 |
| upload:m58-del-mriiwqkn-47.png:drop | 17 |
| upload:m58-del-mriiwqkn-47.png:accept-btn | 105 |
| upload:m58-del-mriiwqkn-47.png:accept-click | 366 |
| upload:m58-del-mriiwqkn-47.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-47.png | 5489 |
| upload:m58-del-mriiwqkn-48.png:drop | 12 |
| upload:m58-del-mriiwqkn-48.png:accept-btn | 80 |
| upload:m58-del-mriiwqkn-48.png:accept-click | 291 |
| upload:m58-del-mriiwqkn-48.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-48.png | 5384 |
| upload:m58-del-mriiwqkn-49.png:drop | 43 |
| upload:m58-del-mriiwqkn-49.png:accept-btn | 140 |
| upload:m58-del-mriiwqkn-49.png:accept-click | 345 |
| upload:m58-del-mriiwqkn-49.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-49.png | 5528 |
| upload:m58-del-mriiwqkn-50.png:drop | 29 |
| upload:m58-del-mriiwqkn-50.png:accept-btn | 164 |
| upload:m58-del-mriiwqkn-50.png:accept-click | 302 |
| upload:m58-del-mriiwqkn-50.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-50.png | 5495 |
| upload:m58-del-mriiwqkn-51.png:drop | 16 |
| upload:m58-del-mriiwqkn-51.png:accept-btn | 145 |
| upload:m58-del-mriiwqkn-51.png:accept-click | 323 |
| upload:m58-del-mriiwqkn-51.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-51.png | 5485 |
| upload:m58-del-mriiwqkn-52.png:drop | 13 |
| upload:m58-del-mriiwqkn-52.png:accept-btn | 123 |
| upload:m58-del-mriiwqkn-52.png:accept-click | 287 |
| upload:m58-del-mriiwqkn-52.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-52.png | 5423 |
| upload:m58-del-mriiwqkn-53.png:drop | 20 |
| upload:m58-del-mriiwqkn-53.png:accept-btn | 124 |
| upload:m58-del-mriiwqkn-53.png:accept-click | 298 |
| upload:m58-del-mriiwqkn-53.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-53.png | 5444 |
| upload:m58-del-mriiwqkn-54.png:drop | 22 |
| upload:m58-del-mriiwqkn-54.png:accept-btn | 231 |
| upload:m58-del-mriiwqkn-54.png:accept-click | 358 |
| upload:m58-del-mriiwqkn-54.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-54.png | 5611 |
| upload:m58-del-mriiwqkn-55.png:drop | 14 |
| upload:m58-del-mriiwqkn-55.png:accept-btn | 98 |
| upload:m58-del-mriiwqkn-55.png:accept-click | 332 |
| upload:m58-del-mriiwqkn-55.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-55.png | 5444 |
| upload:m58-del-mriiwqkn-56.png:drop | 22 |
| upload:m58-del-mriiwqkn-56.png:accept-btn | 173 |
| upload:m58-del-mriiwqkn-56.png:accept-click | 346 |
| upload:m58-del-mriiwqkn-56.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-56.png | 5542 |
| upload:m58-del-mriiwqkn-57.png:drop | 114 |
| upload:m58-del-mriiwqkn-57.png:accept-btn | 251 |
| upload:m58-del-mriiwqkn-57.png:accept-click | 307 |
| upload:m58-del-mriiwqkn-57.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-57.png | 5673 |
| upload:m58-del-mriiwqkn-58.png:drop | 19 |
| upload:m58-del-mriiwqkn-58.png:accept-btn | 219 |
| upload:m58-del-mriiwqkn-58.png:accept-click | 410 |
| upload:m58-del-mriiwqkn-58.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-58.png | 5648 |
| upload:m58-del-mriiwqkn-59.png:drop | 8 |
| upload:m58-del-mriiwqkn-59.png:accept-btn | 201 |
| upload:m58-del-mriiwqkn-59.png:accept-click | 329 |
| upload:m58-del-mriiwqkn-59.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-59.png | 5539 |
| upload:m58-del-mriiwqkn-60.png:drop | 35 |
| upload:m58-del-mriiwqkn-60.png:accept-btn | 114 |
| upload:m58-del-mriiwqkn-60.png:accept-click | 342 |
| upload:m58-del-mriiwqkn-60.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-60.png | 5492 |
| upload:m58-del-mriiwqkn-61.png:drop | 9 |
| upload:m58-del-mriiwqkn-61.png:accept-btn | 159 |
| upload:m58-del-mriiwqkn-61.png:accept-click | 291 |
| upload:m58-del-mriiwqkn-61.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-61.png | 5459 |
| upload:m58-del-mriiwqkn-62.png:drop | 18 |
| upload:m58-del-mriiwqkn-62.png:accept-btn | 157 |
| upload:m58-del-mriiwqkn-62.png:accept-click | 263 |
| upload:m58-del-mriiwqkn-62.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-62.png | 5438 |
| upload:m58-del-mriiwqkn-63.png:drop | 54 |
| upload:m58-del-mriiwqkn-63.png:accept-btn | 158 |
| upload:m58-del-mriiwqkn-63.png:accept-click | 311 |
| upload:m58-del-mriiwqkn-63.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-63.png | 5524 |
| upload:m58-del-mriiwqkn-64.png:drop | 15 |
| upload:m58-del-mriiwqkn-64.png:accept-btn | 151 |
| upload:m58-del-mriiwqkn-64.png:accept-click | 323 |
| upload:m58-del-mriiwqkn-64.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-64.png | 5489 |
| upload:m58-del-mriiwqkn-65.png:drop | 66 |
| upload:m58-del-mriiwqkn-65.png:accept-btn | 165 |
| upload:m58-del-mriiwqkn-65.png:accept-click | 322 |
| upload:m58-del-mriiwqkn-65.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-65.png | 5553 |
| upload:m58-del-mriiwqkn-66.png:drop | 6 |
| upload:m58-del-mriiwqkn-66.png:accept-btn | 127 |
| upload:m58-del-mriiwqkn-66.png:accept-click | 292 |
| upload:m58-del-mriiwqkn-66.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-66.png | 5425 |
| upload:m58-del-mriiwqkn-67.png:drop | 35 |
| upload:m58-del-mriiwqkn-67.png:accept-btn | 125 |
| upload:m58-del-mriiwqkn-67.png:accept-click | 345 |
| upload:m58-del-mriiwqkn-67.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-67.png | 5507 |
| upload:m58-del-mriiwqkn-68.png:drop | 21 |
| upload:m58-del-mriiwqkn-68.png:accept-btn | 130 |
| upload:m58-del-mriiwqkn-68.png:accept-click | 265 |
| upload:m58-del-mriiwqkn-68.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-68.png | 5416 |
| upload:m58-del-mriiwqkn-69.png:drop | 23 |
| upload:m58-del-mriiwqkn-69.png:accept-btn | 160 |
| upload:m58-del-mriiwqkn-69.png:accept-click | 332 |
| upload:m58-del-mriiwqkn-69.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-69.png | 5516 |
| upload:m58-del-mriiwqkn-70.png:drop | 23 |
| upload:m58-del-mriiwqkn-70.png:accept-btn | 133 |
| upload:m58-del-mriiwqkn-70.png:accept-click | 360 |
| upload:m58-del-mriiwqkn-70.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-70.png | 5516 |
| upload:m58-del-mriiwqkn-71.png:drop | 22 |
| upload:m58-del-mriiwqkn-71.png:accept-btn | 149 |
| upload:m58-del-mriiwqkn-71.png:accept-click | 272 |
| upload:m58-del-mriiwqkn-71.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-71.png | 5445 |
| upload:m58-del-mriiwqkn-72.png:drop | 13 |
| upload:m58-del-mriiwqkn-72.png:accept-btn | 138 |
| upload:m58-del-mriiwqkn-72.png:accept-click | 306 |
| upload:m58-del-mriiwqkn-72.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-72.png | 5458 |
| upload:m58-del-mriiwqkn-73.png:drop | 27 |
| upload:m58-del-mriiwqkn-73.png:accept-btn | 164 |
| upload:m58-del-mriiwqkn-73.png:accept-click | 266 |
| upload:m58-del-mriiwqkn-73.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-73.png | 5457 |
| upload:m58-del-mriiwqkn-74.png:drop | 44 |
| upload:m58-del-mriiwqkn-74.png:accept-btn | 196 |
| upload:m58-del-mriiwqkn-74.png:accept-click | 294 |
| upload:m58-del-mriiwqkn-74.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-74.png | 5535 |
| upload:m58-del-mriiwqkn-75.png:drop | 17 |
| upload:m58-del-mriiwqkn-75.png:accept-btn | 157 |
| upload:m58-del-mriiwqkn-75.png:accept-click | 202 |
| upload:m58-del-mriiwqkn-75.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-75.png | 5377 |
| upload:m58-del-mriiwqkn-76.png:drop | 18 |
| upload:m58-del-mriiwqkn-76.png:accept-btn | 194 |
| upload:m58-del-mriiwqkn-76.png:accept-click | 295 |
| upload:m58-del-mriiwqkn-76.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-76.png | 5508 |
| upload:m58-del-mriiwqkn-77.png:drop | 35 |
| upload:m58-del-mriiwqkn-77.png:accept-btn | 144 |
| upload:m58-del-mriiwqkn-77.png:accept-click | 367 |
| upload:m58-del-mriiwqkn-77.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-77.png | 5547 |
| upload:m58-del-mriiwqkn-78.png:drop | 19 |
| upload:m58-del-mriiwqkn-78.png:accept-btn | 222 |
| upload:m58-del-mriiwqkn-78.png:accept-click | 306 |
| upload:m58-del-mriiwqkn-78.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-78.png | 5547 |
| upload:m58-del-mriiwqkn-79.png:drop | 21 |
| upload:m58-del-mriiwqkn-79.png:accept-btn | 134 |
| upload:m58-del-mriiwqkn-79.png:accept-click | 323 |
| upload:m58-del-mriiwqkn-79.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-79.png | 5478 |
| upload:m58-del-mriiwqkn-80.png:drop | 8 |
| upload:m58-del-mriiwqkn-80.png:accept-btn | 57 |
| upload:m58-del-mriiwqkn-80.png:accept-click | 308 |
| upload:m58-del-mriiwqkn-80.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-80.png | 5375 |
| upload:m58-del-mriiwqkn-81.png:drop | 18 |
| upload:m58-del-mriiwqkn-81.png:accept-btn | 129 |
| upload:m58-del-mriiwqkn-81.png:accept-click | 358 |
| upload:m58-del-mriiwqkn-81.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-81.png | 5505 |
| upload:m58-del-mriiwqkn-82.png:drop | 27 |
| upload:m58-del-mriiwqkn-82.png:accept-btn | 153 |
| upload:m58-del-mriiwqkn-82.png:accept-click | 252 |
| upload:m58-del-mriiwqkn-82.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-82.png | 5432 |
| upload:m58-del-mriiwqkn-83.png:drop | 24 |
| upload:m58-del-mriiwqkn-83.png:accept-btn | 122 |
| upload:m58-del-mriiwqkn-83.png:accept-click | 327 |
| upload:m58-del-mriiwqkn-83.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-83.png | 5474 |
| upload:m58-del-mriiwqkn-84.png:drop | 8 |
| upload:m58-del-mriiwqkn-84.png:accept-btn | 100 |
| upload:m58-del-mriiwqkn-84.png:accept-click | 312 |
| upload:m58-del-mriiwqkn-84.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-84.png | 5420 |
| upload:m58-del-mriiwqkn-85.png:drop | 12 |
| upload:m58-del-mriiwqkn-85.png:accept-btn | 112 |
| upload:m58-del-mriiwqkn-85.png:accept-click | 382 |
| upload:m58-del-mriiwqkn-85.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-85.png | 5506 |
| upload:m58-del-mriiwqkn-86.png:drop | 34 |
| upload:m58-del-mriiwqkn-86.png:accept-btn | 178 |
| upload:m58-del-mriiwqkn-86.png:accept-click | 282 |
| upload:m58-del-mriiwqkn-86.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-86.png | 5494 |
| upload:m58-del-mriiwqkn-87.png:drop | 20 |
| upload:m58-del-mriiwqkn-87.png:accept-btn | 131 |
| upload:m58-del-mriiwqkn-87.png:accept-click | 338 |
| upload:m58-del-mriiwqkn-87.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-87.png | 5491 |
| upload:m58-del-mriiwqkn-88.png:drop | 34 |
| upload:m58-del-mriiwqkn-88.png:accept-btn | 124 |
| upload:m58-del-mriiwqkn-88.png:accept-click | 282 |
| upload:m58-del-mriiwqkn-88.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-88.png | 5441 |
| upload:m58-del-mriiwqkn-89.png:drop | 20 |
| upload:m58-del-mriiwqkn-89.png:accept-btn | 155 |
| upload:m58-del-mriiwqkn-89.png:accept-click | 337 |
| upload:m58-del-mriiwqkn-89.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-89.png | 5512 |
| upload:m58-del-mriiwqkn-90.png:drop | 12 |
| upload:m58-del-mriiwqkn-90.png:accept-btn | 153 |
| upload:m58-del-mriiwqkn-90.png:accept-click | 249 |
| upload:m58-del-mriiwqkn-90.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-90.png | 5415 |
| upload:m58-del-mriiwqkn-91.png:drop | 44 |
| upload:m58-del-mriiwqkn-91.png:accept-btn | 140 |
| upload:m58-del-mriiwqkn-91.png:accept-click | 307 |
| upload:m58-del-mriiwqkn-91.png:sleep | 5001 |
| upload:m58-del-mriiwqkn-91.png | 5492 |
| upload:m58-del-mriiwqkn-92.png:drop | 27 |
| upload:m58-del-mriiwqkn-92.png:accept-btn | 156 |
| upload:m58-del-mriiwqkn-92.png:accept-click | 289 |
| upload:m58-del-mriiwqkn-92.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-92.png | 5473 |
| upload:m58-del-mriiwqkn-93.png:drop | 43 |
| upload:m58-del-mriiwqkn-93.png:accept-btn | 137 |
| upload:m58-del-mriiwqkn-93.png:accept-click | 319 |
| upload:m58-del-mriiwqkn-93.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-93.png | 5499 |
| upload:m58-del-mriiwqkn-94.png:drop | 15 |
| upload:m58-del-mriiwqkn-94.png:accept-btn | 216 |
| upload:m58-del-mriiwqkn-94.png:accept-click | 259 |
| upload:m58-del-mriiwqkn-94.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-94.png | 5490 |
| upload:m58-del-mriiwqkn-95.png:drop | 24 |
| upload:m58-del-mriiwqkn-95.png:accept-btn | 130 |
| upload:m58-del-mriiwqkn-95.png:accept-click | 377 |
| upload:m58-del-mriiwqkn-95.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-95.png | 5532 |
| upload:m58-del-mriiwqkn-96.png:drop | 13 |
| upload:m58-del-mriiwqkn-96.png:accept-btn | 132 |
| upload:m58-del-mriiwqkn-96.png:accept-click | 332 |
| upload:m58-del-mriiwqkn-96.png:sleep | 4999 |
| upload:m58-del-mriiwqkn-96.png | 5478 |
| upload:m58-del-mriiwqkn-97.png:drop | 25 |
| upload:m58-del-mriiwqkn-97.png:accept-btn | 104 |
| upload:m58-del-mriiwqkn-97.png:accept-click | 403 |
| upload:m58-del-mriiwqkn-97.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-97.png | 5532 |
| upload:m58-del-mriiwqkn-98.png:drop | 30 |
| upload:m58-del-mriiwqkn-98.png:accept-btn | 118 |
| upload:m58-del-mriiwqkn-98.png:accept-click | 309 |
| upload:m58-del-mriiwqkn-98.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-98.png | 5458 |
| upload:m58-del-mriiwqkn-99.png:drop | 11 |
| upload:m58-del-mriiwqkn-99.png:accept-btn | 77 |
| upload:m58-del-mriiwqkn-99.png:accept-click | 339 |
| upload:m58-del-mriiwqkn-99.png:sleep | 5000 |
| upload:m58-del-mriiwqkn-99.png | 5427 |

## Delete / batch-delete timings

| Operation | elapsed_ms |
|-----------|------------|
| (none) | — |

## Phase aggregates (sum of all invocations)

| Phase | calls | total_ms | avg_ms | max_ms |
|-------|-------|----------|--------|--------|
| prior-missions:all | 1 | 928537 | 928537 | 928537 |
| 5.8-D:stress-uploads | 1 | 561950 | 561950 | 561950 |
| prior:mission-5.7.6-validate.mjs | 1 | 158292 | 158292 | 158292 |
| prior:mission-5.7.1-validate.mjs | 1 | 124758 | 124758 | 124758 |
| prior:mission-5.5-validate.mjs | 1 | 124520 | 124520 | 124520 |
| prior:mission-5.7.4-validate.mjs | 1 | 123373 | 123373 | 123373 |
| prior:mission-5.6-validate.mjs | 1 | 100457 | 100457 | 100457 |
| openStudio | 7 | 85918 | 12274 | 13165 |
| prior:mission-5.7.7-live-delete-audit.mjs | 1 | 80638 | 80638 | 80638 |
| prior:mission-5.6.5-validate.mjs | 1 | 75857 | 75857 | 75857 |
| openStudio:sleep | 21 | 63001 | 3000 | 5001 |
| prior:mission-5.7-validate.mjs | 1 | 60969 | 60969 | 60969 |
| prior:mission-5.7.2-validate.mjs | 1 | 59254 | 59254 | 59254 |
| 5.8-C:hard-refresh | 1 | 32769 | 32769 | 32769 |
| prior:mission-5.7.5-render-audit.mjs | 1 | 20414 | 20414 | 20414 |
| 5.8-B:index-sync | 1 | 18511 | 18511 | 18511 |
| 5.8-A:ghost-purge | 1 | 16175 | 16175 | 16175 |
| 5.8-E:offline | 1 | 13447 | 13447 | 13447 |
| openStudio:ghost-click | 7 | 10506 | 1501 | 2810 |
| upload:m58-del-mriiwqkn-34.png | 1 | 5754 | 5754 | 5754 |
| upload:m58-del-mriiwqkn-46.png | 1 | 5712 | 5712 | 5712 |
| upload:m58-del-mriiwqkn-57.png | 1 | 5673 | 5673 | 5673 |
| upload:m58-stress-mriiwqkn-84.png | 1 | 5659 | 5659 | 5659 |
| upload:m58-del-mriiwqkn-40.png | 1 | 5657 | 5657 | 5657 |
| upload:m58-del-mriiwqkn-58.png | 1 | 5648 | 5648 | 5648 |
| upload:m58-del-mriiwqkn-43.png | 1 | 5646 | 5646 | 5646 |
| upload:m58-stress-mriiwqkn-71.png | 1 | 5640 | 5640 | 5640 |
| upload:m58-stress-mriiwqkn-31.png | 1 | 5625 | 5625 | 5625 |
| upload:m58-del-mriiwqkn-54.png | 1 | 5611 | 5611 | 5611 |
| upload:m58-del-mriiwqkn-29.png | 1 | 5599 | 5599 | 5599 |
| upload:m58-stress-mriiwqkn-53.png | 1 | 5596 | 5596 | 5596 |
| upload:m58-del-mriiwqkn-36.png | 1 | 5592 | 5592 | 5592 |
| upload:m58-stress-mriiwqkn-69.png | 1 | 5591 | 5591 | 5591 |
| upload:m58-del-mriiwqkn-5.png | 1 | 5586 | 5586 | 5586 |
| upload:m58-stress-mriiwqkn-49.png | 1 | 5558 | 5558 | 5558 |
| upload:m58-stress-mriiwqkn-47.png | 1 | 5557 | 5557 | 5557 |
| upload:m58-stress-mriiwqkn-21.png | 1 | 5555 | 5555 | 5555 |
| upload:m58-stress-mriiwqkn-62.png | 1 | 5554 | 5554 | 5554 |
| upload:m58-del-mriiwqkn-65.png | 1 | 5553 | 5553 | 5553 |
| upload:m58-del-mriiwqkn-12.png | 1 | 5548 | 5548 | 5548 |
| upload:m58-stress-mriiwqkn-95.png | 1 | 5547 | 5547 | 5547 |
| upload:m58-del-mriiwqkn-77.png | 1 | 5547 | 5547 | 5547 |
| upload:m58-del-mriiwqkn-78.png | 1 | 5547 | 5547 | 5547 |
| upload:m58-del-mriiwqkn-28.png | 1 | 5545 | 5545 | 5545 |
| upload:m58-stress-mriiwqkn-54.png | 1 | 5542 | 5542 | 5542 |
| upload:m58-del-mriiwqkn-56.png | 1 | 5542 | 5542 | 5542 |
| upload:m58-del-mriiwqkn-31.png | 1 | 5540 | 5540 | 5540 |
| upload:m58-del-mriiwqkn-59.png | 1 | 5539 | 5539 | 5539 |
| upload:m58-del-mriiwqkn-9.png | 1 | 5535 | 5535 | 5535 |
| upload:m58-del-mriiwqkn-74.png | 1 | 5535 | 5535 | 5535 |
| upload:m58-stress-mriiwqkn-41.png | 1 | 5533 | 5533 | 5533 |
| upload:m58-del-mriiwqkn-95.png | 1 | 5532 | 5532 | 5532 |
| upload:m58-del-mriiwqkn-97.png | 1 | 5532 | 5532 | 5532 |
| upload:m58-stress-mriiwqkn-78.png | 1 | 5528 | 5528 | 5528 |
| upload:m58-del-mriiwqkn-49.png | 1 | 5528 | 5528 | 5528 |
| upload:m58-del-mriiwqkn-30.png | 1 | 5527 | 5527 | 5527 |
| upload:m58-del-mriiwqkn-63.png | 1 | 5524 | 5524 | 5524 |
| upload:m58-stress-mriiwqkn-86.png | 1 | 5520 | 5520 | 5520 |
| upload:m58-stress-mriiwqkn-79.png | 1 | 5519 | 5519 | 5519 |
| upload:m58-stress-mriiwqkn-76.png | 1 | 5517 | 5517 | 5517 |
| upload:m58-del-mriiwqkn-26.png | 1 | 5516 | 5516 | 5516 |
| upload:m58-del-mriiwqkn-69.png | 1 | 5516 | 5516 | 5516 |
| upload:m58-del-mriiwqkn-70.png | 1 | 5516 | 5516 | 5516 |
| upload:m58-del-mriiwqkn-89.png | 1 | 5512 | 5512 | 5512 |
| upload:m58-stress-mriiwqkn-57.png | 1 | 5511 | 5511 | 5511 |
| upload:m58-del-mriiwqkn-22.png | 1 | 5511 | 5511 | 5511 |
| upload:m58-refresh-mriiwqkn.png | 1 | 5510 | 5510 | 5510 |
| upload:m58-del-mriiwqkn-25.png | 1 | 5509 | 5509 | 5509 |
| upload:m58-del-mriiwqkn-76.png | 1 | 5508 | 5508 | 5508 |
| upload:m58-del-mriiwqkn-67.png | 1 | 5507 | 5507 | 5507 |
| upload:m58-del-mriiwqkn-85.png | 1 | 5506 | 5506 | 5506 |
| upload:m58-del-mriiwqkn-81.png | 1 | 5505 | 5505 | 5505 |
| upload:m58-del-mriiwqkn-33.png | 1 | 5502 | 5502 | 5502 |
| upload:m58-del-mriiwqkn-93.png | 1 | 5499 | 5499 | 5499 |
| upload:m58-stress-mriiwqkn-67.png | 1 | 5497 | 5497 | 5497 |
| upload:m58-stress-mriiwqkn-35.png | 1 | 5496 | 5496 | 5496 |
| upload:m58-stress-mriiwqkn-91.png | 1 | 5496 | 5496 | 5496 |
| upload:m58-del-mriiwqkn-50.png | 1 | 5495 | 5495 | 5495 |
| upload:m58-del-mriiwqkn-6.png | 1 | 5494 | 5494 | 5494 |
| upload:m58-del-mriiwqkn-20.png | 1 | 5494 | 5494 | 5494 |
| upload:m58-del-mriiwqkn-86.png | 1 | 5494 | 5494 | 5494 |
| upload:m58-stress-mriiwqkn-32.png | 1 | 5492 | 5492 | 5492 |
| upload:m58-del-mriiwqkn-60.png | 1 | 5492 | 5492 | 5492 |
| upload:m58-del-mriiwqkn-91.png | 1 | 5492 | 5492 | 5492 |
| upload:m58-stress-mriiwqkn-50.png | 1 | 5491 | 5491 | 5491 |
| upload:m58-stress-mriiwqkn-88.png | 1 | 5491 | 5491 | 5491 |
| upload:m58-del-mriiwqkn-87.png | 1 | 5491 | 5491 | 5491 |
| upload:m58-del-mriiwqkn-94.png | 1 | 5490 | 5490 | 5490 |
| upload:m58-del-mriiwqkn-27.png | 1 | 5489 | 5489 | 5489 |
| upload:m58-del-mriiwqkn-47.png | 1 | 5489 | 5489 | 5489 |
| upload:m58-del-mriiwqkn-64.png | 1 | 5489 | 5489 | 5489 |
| upload:m58-del-mriiwqkn-39.png | 1 | 5485 | 5485 | 5485 |
| upload:m58-del-mriiwqkn-51.png | 1 | 5485 | 5485 | 5485 |
| upload:m58-del-mriiwqkn-11.png | 1 | 5484 | 5484 | 5484 |
| upload:m58-stress-mriiwqkn-7.png | 1 | 5483 | 5483 | 5483 |
| upload:m58-del-mriiwqkn-15.png | 1 | 5482 | 5482 | 5482 |
| upload:m58-del-mriiwqkn-37.png | 1 | 5482 | 5482 | 5482 |
| upload:m58-del-mriiwqkn-21.png | 1 | 5481 | 5481 | 5481 |
| upload:m58-del-mriiwqkn-45.png | 1 | 5481 | 5481 | 5481 |
| upload:m58-del-mriiwqkn-17.png | 1 | 5479 | 5479 | 5479 |
| upload:m58-del-mriiwqkn-79.png | 1 | 5478 | 5478 | 5478 |
| upload:m58-del-mriiwqkn-96.png | 1 | 5478 | 5478 | 5478 |
| upload:m58-stress-mriiwqkn-45.png | 1 | 5477 | 5477 | 5477 |
| upload:m58-stress-mriiwqkn-97.png | 1 | 5476 | 5476 | 5476 |
| upload:m58-stress-mriiwqkn-20.png | 1 | 5475 | 5475 | 5475 |
| upload:m58-stress-mriiwqkn-24.png | 1 | 5475 | 5475 | 5475 |
| upload:m58-stress-mriiwqkn-59.png | 1 | 5475 | 5475 | 5475 |
| upload:m58-stress-mriiwqkn-80.png | 1 | 5475 | 5475 | 5475 |
| upload:m58-del-mriiwqkn-83.png | 1 | 5474 | 5474 | 5474 |
| upload:m58-del-mriiwqkn-92.png | 1 | 5473 | 5473 | 5473 |
| upload:m58-stress-mriiwqkn-56.png | 1 | 5471 | 5471 | 5471 |
| upload:m58-del-mriiwqkn-44.png | 1 | 5471 | 5471 | 5471 |
| upload:m58-stress-mriiwqkn-46.png | 1 | 5470 | 5470 | 5470 |
| upload:m58-stress-mriiwqkn-81.png | 1 | 5469 | 5469 | 5469 |
| upload:m58-del-mriiwqkn-24.png | 1 | 5469 | 5469 | 5469 |
| upload:m58-stress-mriiwqkn-61.png | 1 | 5468 | 5468 | 5468 |
| upload:m58-del-mriiwqkn-41.png | 1 | 5468 | 5468 | 5468 |
| upload:m58-stress-mriiwqkn-77.png | 1 | 5467 | 5467 | 5467 |
| upload:m58-stress-mriiwqkn-26.png | 1 | 5465 | 5465 | 5465 |
| upload:m58-stress-mriiwqkn-11.png | 1 | 5464 | 5464 | 5464 |
| upload:m58-del-mriiwqkn-16.png | 1 | 5464 | 5464 | 5464 |
| upload:m58-stress-mriiwqkn-72.png | 1 | 5462 | 5462 | 5462 |
| upload:m58-stress-mriiwqkn-25.png | 1 | 5461 | 5461 | 5461 |
| upload:m58-stress-mriiwqkn-27.png | 1 | 5460 | 5460 | 5460 |
| upload:m58-stress-mriiwqkn-65.png | 1 | 5460 | 5460 | 5460 |
| upload:m58-del-mriiwqkn-61.png | 1 | 5459 | 5459 | 5459 |
| upload:m58-del-mriiwqkn-72.png | 1 | 5458 | 5458 | 5458 |
| upload:m58-del-mriiwqkn-98.png | 1 | 5458 | 5458 | 5458 |
| upload:m58-stress-mriiwqkn-34.png | 1 | 5457 | 5457 | 5457 |
| upload:m58-del-mriiwqkn-32.png | 1 | 5457 | 5457 | 5457 |
| upload:m58-del-mriiwqkn-73.png | 1 | 5457 | 5457 | 5457 |
| upload:m58-del-mriiwqkn-35.png | 1 | 5455 | 5455 | 5455 |
| upload:m58-stress-mriiwqkn-38.png | 1 | 5454 | 5454 | 5454 |
| upload:m58-stress-mriiwqkn-74.png | 1 | 5454 | 5454 | 5454 |
| upload:m58-stress-mriiwqkn-75.png | 1 | 5454 | 5454 | 5454 |
| upload:m58-del-mriiwqkn-1.png | 1 | 5454 | 5454 | 5454 |
| upload:m58-stress-mriiwqkn-23.png | 1 | 5453 | 5453 | 5453 |
| upload:m58-stress-mriiwqkn-40.png | 1 | 5452 | 5452 | 5452 |
| upload:m58-del-mriiwqkn-2.png | 1 | 5452 | 5452 | 5452 |
| upload:m58-del-mriiwqkn-10.png | 1 | 5452 | 5452 | 5452 |
| upload:m58-stress-mriiwqkn-51.png | 1 | 5451 | 5451 | 5451 |
| upload:m58-stress-mriiwqkn-70.png | 1 | 5451 | 5451 | 5451 |
| upload:m58-del-mriiwqkn-14.png | 1 | 5451 | 5451 | 5451 |
| upload:m58-stress-mriiwqkn-30.png | 1 | 5450 | 5450 | 5450 |
| upload:m58-del-mriiwqkn-8.png | 1 | 5448 | 5448 | 5448 |
| upload:m58-stress-mriiwqkn-92.png | 1 | 5445 | 5445 | 5445 |
| upload:m58-del-mriiwqkn-71.png | 1 | 5445 | 5445 | 5445 |
| upload:m58-stress-mriiwqkn-13.png | 1 | 5444 | 5444 | 5444 |
| upload:m58-del-mriiwqkn-53.png | 1 | 5444 | 5444 | 5444 |
| upload:m58-del-mriiwqkn-55.png | 1 | 5444 | 5444 | 5444 |
| upload:m58-stress-mriiwqkn-55.png | 1 | 5443 | 5443 | 5443 |
| upload:m58-stress-mriiwqkn-43.png | 1 | 5442 | 5442 | 5442 |
| upload:m58-stress-mriiwqkn-58.png | 1 | 5442 | 5442 | 5442 |
| upload:m58-del-mriiwqkn-88.png | 1 | 5441 | 5441 | 5441 |
| upload:m58-stress-mriiwqkn-52.png | 1 | 5438 | 5438 | 5438 |
| upload:m58-stress-mriiwqkn-89.png | 1 | 5438 | 5438 | 5438 |
| upload:m58-del-mriiwqkn-62.png | 1 | 5438 | 5438 | 5438 |
| upload:m58-stress-mriiwqkn-16.png | 1 | 5436 | 5436 | 5436 |
| upload:m58-stress-mriiwqkn-29.png | 1 | 5436 | 5436 | 5436 |
| upload:m58-stress-mriiwqkn-93.png | 1 | 5436 | 5436 | 5436 |
| upload:m58-del-mriiwqkn-7.png | 1 | 5436 | 5436 | 5436 |
| upload:m58-stress-mriiwqkn-66.png | 1 | 5435 | 5435 | 5435 |
| upload:m58-stress-mriiwqkn-94.png | 1 | 5434 | 5434 | 5434 |
| upload:m58-stress-mriiwqkn-1.png | 1 | 5432 | 5432 | 5432 |
| upload:m58-stress-mriiwqkn-68.png | 1 | 5432 | 5432 | 5432 |
| upload:m58-del-mriiwqkn-19.png | 1 | 5432 | 5432 | 5432 |
| upload:m58-del-mriiwqkn-38.png | 1 | 5432 | 5432 | 5432 |
| upload:m58-del-mriiwqkn-82.png | 1 | 5432 | 5432 | 5432 |
| upload:m58-stress-mriiwqkn-36.png | 1 | 5431 | 5431 | 5431 |
| upload:m58-stress-mriiwqkn-87.png | 1 | 5429 | 5429 | 5429 |
| upload:m58-stress-mriiwqkn-6.png | 1 | 5428 | 5428 | 5428 |
| upload:m58-stress-mriiwqkn-98.png | 1 | 5428 | 5428 | 5428 |
| upload:m58-stress-mriiwqkn-60.png | 1 | 5427 | 5427 | 5427 |
| upload:m58-del-mriiwqkn-99.png | 1 | 5427 | 5427 | 5427 |
| upload:m58-stress-mriiwqkn-28.png | 1 | 5425 | 5425 | 5425 |
| upload:m58-stress-mriiwqkn-64.png | 1 | 5425 | 5425 | 5425 |
| upload:m58-del-mriiwqkn-66.png | 1 | 5425 | 5425 | 5425 |
| upload:m58-stress-mriiwqkn-2.png | 1 | 5424 | 5424 | 5424 |
| upload:m58-stress-mriiwqkn-99.png | 1 | 5423 | 5423 | 5423 |
| upload:m58-del-mriiwqkn-52.png | 1 | 5423 | 5423 | 5423 |
| upload:m58-stress-mriiwqkn-19.png | 1 | 5421 | 5421 | 5421 |
| upload:m58-del-mriiwqkn-84.png | 1 | 5420 | 5420 | 5420 |
| upload:m58-stress-mriiwqkn-17.png | 1 | 5419 | 5419 | 5419 |
| upload:m58-stress-mriiwqkn-85.png | 1 | 5416 | 5416 | 5416 |
| upload:m58-del-mriiwqkn-68.png | 1 | 5416 | 5416 | 5416 |
| upload:m58-stress-mriiwqkn-5.png | 1 | 5415 | 5415 | 5415 |
| upload:m58-del-mriiwqkn-90.png | 1 | 5415 | 5415 | 5415 |
| upload:m58-stress-mriiwqkn-18.png | 1 | 5412 | 5412 | 5412 |
| upload:m58-stress-mriiwqkn-14.png | 1 | 5407 | 5407 | 5407 |
| upload:m58-stress-mriiwqkn-39.png | 1 | 5407 | 5407 | 5407 |
| upload:m58-stress-mriiwqkn-42.png | 1 | 5407 | 5407 | 5407 |
| upload:m58-del-mriiwqkn-18.png | 1 | 5402 | 5402 | 5402 |
| upload:m58-stress-mriiwqkn-83.png | 1 | 5401 | 5401 | 5401 |
| upload:m58-del-mriiwqkn-3.png | 1 | 5397 | 5397 | 5397 |
| upload:m58-stress-mriiwqkn-22.png | 1 | 5395 | 5395 | 5395 |
| upload:m58-stress-mriiwqkn-37.png | 1 | 5394 | 5394 | 5394 |
| upload:m58-stress-mriiwqkn-82.png | 1 | 5393 | 5393 | 5393 |
| upload:m58-sync-mriiwqkn.png | 1 | 5391 | 5391 | 5391 |
| upload:m58-stress-mriiwqkn-15.png | 1 | 5390 | 5390 | 5390 |
| upload:m58-stress-mriiwqkn-63.png | 1 | 5390 | 5390 | 5390 |
| upload:m58-del-mriiwqkn-13.png | 1 | 5390 | 5390 | 5390 |
| upload:m58-del-mriiwqkn-23.png | 1 | 5390 | 5390 | 5390 |
| upload:m58-stress-mriiwqkn-10.png | 1 | 5388 | 5388 | 5388 |
| upload:m58-stress-mriiwqkn-8.png | 1 | 5385 | 5385 | 5385 |
| upload:m58-del-mriiwqkn-48.png | 1 | 5384 | 5384 | 5384 |
| upload:m58-stress-mriiwqkn-12.png | 1 | 5382 | 5382 | 5382 |
| upload:m58-stress-mriiwqkn-44.png | 1 | 5377 | 5377 | 5377 |
| upload:m58-del-mriiwqkn-75.png | 1 | 5377 | 5377 | 5377 |
| upload:m58-del-mriiwqkn-80.png | 1 | 5375 | 5375 | 5375 |
| upload:m58-stress-mriiwqkn-9.png | 1 | 5362 | 5362 | 5362 |
| upload:m58-del-mriiwqkn-0.png | 1 | 5362 | 5362 | 5362 |
| upload:m58-stress-mriiwqkn-73.png | 1 | 5360 | 5360 | 5360 |
| upload:m58-stress-mriiwqkn-0.png | 1 | 5358 | 5358 | 5358 |
| upload:m58-stress-mriiwqkn-48.png | 1 | 5356 | 5356 | 5356 |
| upload:m58-del-mriiwqkn-42.png | 1 | 5354 | 5354 | 5354 |
| upload:m58-stress-mriiwqkn-96.png | 1 | 5350 | 5350 | 5350 |
| upload:m58-stress-mriiwqkn-90.png | 1 | 5346 | 5346 | 5346 |
| upload:m58-stress-mriiwqkn-33.png | 1 | 5344 | 5344 | 5344 |
| upload:m58-stress-mriiwqkn-3.png | 1 | 5342 | 5342 | 5342 |
| upload:m58-del-mriiwqkn-4.png | 1 | 5309 | 5309 | 5309 |
| upload:m58-stress-mriiwqkn-4.png | 1 | 5279 | 5279 | 5279 |
| openStudio:content-tab | 7 | 5254 | 751 | 1620 |
| upload:m58-stress-mriiwqkn-69.png:sleep | 1 | 5004 | 5004 | 5004 |
| upload:m58-stress-mriiwqkn-30.png:sleep | 1 | 5003 | 5003 | 5003 |
| upload:m58-stress-mriiwqkn-14.png:sleep | 1 | 5002 | 5002 | 5002 |
| upload:m58-sync-mriiwqkn.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-refresh-mriiwqkn.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-1.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-9.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-10.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-13.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-32.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-37.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-46.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-55.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-60.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-61.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-71.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-82.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-6.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-15.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-22.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-25.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-28.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-35.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-47.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-51.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-71.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-76.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-77.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-80.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-83.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-88.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-90.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-del-mriiwqkn-91.png:sleep | 1 | 5001 | 5001 | 5001 |
| upload:m58-stress-mriiwqkn-0.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-3.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-4.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-5.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-6.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-7.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-8.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-11.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-12.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-15.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-17.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-18.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-19.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-21.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-22.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-23.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-24.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-27.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-28.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-29.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-31.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-35.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-36.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-38.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-39.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-40.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-42.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-43.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-44.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-45.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-47.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-48.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-49.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-50.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-51.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-52.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-53.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-54.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-57.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-62.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-63.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-64.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-65.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-66.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-67.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-68.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-70.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-72.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-73.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-74.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-75.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-76.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-77.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-78.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-79.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-80.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-81.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-83.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-84.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-85.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-86.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-87.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-88.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-89.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-90.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-94.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-95.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-97.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-99.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-0.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-2.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-3.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-4.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-5.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-7.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-8.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-9.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-10.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-11.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-13.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-14.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-16.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-17.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-18.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-19.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-20.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-21.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-23.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-24.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-27.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-29.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-30.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-31.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-32.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-34.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-36.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-37.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-38.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-39.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-40.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-41.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-42.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-43.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-44.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-45.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-46.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-48.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-49.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-50.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-52.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-53.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-54.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-55.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-56.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-57.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-58.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-60.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-61.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-62.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-63.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-65.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-66.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-67.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-68.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-69.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-70.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-72.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-73.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-75.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-79.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-81.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-82.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-84.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-85.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-86.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-87.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-92.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-93.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-95.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-97.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-98.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-del-mriiwqkn-99.png:sleep | 1 | 5000 | 5000 | 5000 |
| upload:m58-stress-mriiwqkn-2.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-16.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-20.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-25.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-26.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-33.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-34.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-41.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-56.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-58.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-59.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-91.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-92.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-93.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-96.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-stress-mriiwqkn-98.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-1.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-12.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-26.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-33.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-59.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-64.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-74.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-78.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-89.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-94.png:sleep | 1 | 4999 | 4999 | 4999 |
| upload:m58-del-mriiwqkn-96.png:sleep | 1 | 4999 | 4999 | 4999 |
| openStudio:goto | 7 | 4491 | 642 | 741 |
| 5.8-A:reload | 1 | 2037 | 2037 | 2037 |
| openStudio:control-center | 7 | 1998 | 285 | 957 |
| 5.8-A:goto | 1 | 922 | 922 | 922 |
| 5.8-F:goto | 1 | 869 | 869 | 869 |
| 5.8-C:goto | 1 | 864 | 864 | 864 |
| 5.8-D:goto | 1 | 847 | 847 | 847 |
| 5.8-E:goto | 1 | 793 | 793 | 793 |
| 5.8-B:goto | 1 | 764 | 764 | 764 |
| 5.8-E:reload | 1 | 706 | 706 | 706 |
| openStudio:canonicalization-ready | 7 | 657 | 94 | 472 |
| 5.8-C:reload | 1 | 630 | 630 | 630 |
| upload:m58-del-mriiwqkn-34.png:accept-click | 1 | 560 | 560 | 560 |
| upload:m58-del-mriiwqkn-5.png:accept-click | 1 | 493 | 493 | 493 |
| upload:m58-stress-mriiwqkn-84.png:accept-click | 1 | 467 | 467 | 467 |
| upload:m58-del-mriiwqkn-46.png:accept-click | 1 | 464 | 464 | 464 |
| upload:m58-stress-mriiwqkn-47.png:accept-click | 1 | 458 | 458 | 458 |
| upload:m58-stress-mriiwqkn-62.png:accept-click | 1 | 458 | 458 | 458 |
| upload:m58-del-mriiwqkn-58.png:accept-click | 1 | 410 | 410 | 410 |
| upload:m58-del-mriiwqkn-29.png:accept-click | 1 | 404 | 404 | 404 |
| upload:m58-del-mriiwqkn-43.png:accept-click | 1 | 403 | 403 | 403 |
| upload:m58-del-mriiwqkn-97.png:accept-click | 1 | 403 | 403 | 403 |
| upload:m58-stress-mriiwqkn-79.png:accept-click | 1 | 402 | 402 | 402 |
| upload:m58-del-mriiwqkn-9.png:accept-click | 1 | 394 | 394 | 394 |
| upload:m58-stress-mriiwqkn-69.png:accept-click | 1 | 385 | 385 | 385 |
| upload:m58-stress-mriiwqkn-49.png:accept-click | 1 | 384 | 384 | 384 |
| upload:m58-del-mriiwqkn-85.png:accept-click | 1 | 382 | 382 | 382 |
| upload:m58-stress-mriiwqkn-91.png:accept-click | 1 | 378 | 378 | 378 |
| upload:m58-del-mriiwqkn-95.png:accept-click | 1 | 377 | 377 | 377 |
| upload:m58-del-mriiwqkn-26.png:accept-click | 1 | 376 | 376 | 376 |
| upload:m58-del-mriiwqkn-31.png:accept-click | 1 | 374 | 374 | 374 |
| upload:m58-stress-mriiwqkn-78.png:accept-click | 1 | 371 | 371 | 371 |
| upload:m58-del-mriiwqkn-77.png:accept-click | 1 | 367 | 367 | 367 |
| upload:m58-del-mriiwqkn-47.png:accept-click | 1 | 366 | 366 | 366 |
| upload:m58-stress-mriiwqkn-21.png:accept-click | 1 | 365 | 365 | 365 |
| upload:m58-stress-mriiwqkn-7.png:accept-click | 1 | 361 | 361 | 361 |
| upload:m58-del-mriiwqkn-33.png:accept-click | 1 | 360 | 360 | 360 |
| upload:m58-del-mriiwqkn-70.png:accept-click | 1 | 360 | 360 | 360 |
| upload:m58-del-mriiwqkn-54.png:accept-click | 1 | 358 | 358 | 358 |
| upload:m58-del-mriiwqkn-81.png:accept-click | 1 | 358 | 358 | 358 |
| upload:m58-del-mriiwqkn-30.png:accept-click | 1 | 356 | 356 | 356 |
| upload:m58-stress-mriiwqkn-81.png:accept-click | 1 | 355 | 355 | 355 |
| upload:m58-stress-mriiwqkn-32.png:accept-click | 1 | 353 | 353 | 353 |
| upload:m58-stress-mriiwqkn-86.png:accept-click | 1 | 350 | 350 | 350 |
| upload:m58-del-mriiwqkn-36.png:accept-click | 1 | 348 | 348 | 348 |
| upload:m58-stress-mriiwqkn-31.png:accept-click | 1 | 346 | 346 | 346 |
| upload:m58-stress-mriiwqkn-97.png:accept-click | 1 | 346 | 346 | 346 |
| upload:m58-del-mriiwqkn-56.png:accept-click | 1 | 346 | 346 | 346 |
| upload:m58-del-mriiwqkn-49.png:accept-click | 1 | 345 | 345 | 345 |
| upload:m58-del-mriiwqkn-67.png:accept-click | 1 | 345 | 345 | 345 |
| upload:m58-del-mriiwqkn-39.png:accept-click | 1 | 344 | 344 | 344 |
| upload:m58-del-mriiwqkn-60.png:accept-click | 1 | 342 | 342 | 342 |
| upload:m58-stress-mriiwqkn-72.png:accept-click | 1 | 341 | 341 | 341 |
| upload:m58-stress-mriiwqkn-59.png:accept-click | 1 | 339 | 339 | 339 |
| upload:m58-del-mriiwqkn-99.png:accept-click | 1 | 339 | 339 | 339 |
| upload:m58-stress-mriiwqkn-80.png:accept-click | 1 | 338 | 338 | 338 |
| upload:m58-del-mriiwqkn-87.png:accept-click | 1 | 338 | 338 | 338 |
| upload:m58-stress-mriiwqkn-11.png:accept-click | 1 | 337 | 337 | 337 |
| upload:m58-stress-mriiwqkn-77.png:accept-click | 1 | 337 | 337 | 337 |
| upload:m58-del-mriiwqkn-41.png:accept-click | 1 | 337 | 337 | 337 |
| upload:m58-del-mriiwqkn-89.png:accept-click | 1 | 337 | 337 | 337 |
| upload:m58-refresh-mriiwqkn.png:accept-click | 1 | 335 | 335 | 335 |
| upload:m58-stress-mriiwqkn-53.png:accept-click | 1 | 335 | 335 | 335 |
| upload:m58-del-mriiwqkn-21.png:accept-click | 1 | 335 | 335 | 335 |
| upload:m58-stress-mriiwqkn-51.png:accept-click | 1 | 334 | 334 | 334 |
| upload:m58-stress-mriiwqkn-76.png:accept-click | 1 | 334 | 334 | 334 |
| upload:m58-stress-mriiwqkn-41.png:accept-click | 1 | 333 | 333 | 333 |
| upload:m58-del-mriiwqkn-6.png:accept-click | 1 | 332 | 332 | 332 |
| upload:m58-del-mriiwqkn-55.png:accept-click | 1 | 332 | 332 | 332 |
| upload:m58-del-mriiwqkn-69.png:accept-click | 1 | 332 | 332 | 332 |
| upload:m58-del-mriiwqkn-96.png:accept-click | 1 | 332 | 332 | 332 |
| upload:m58-stress-mriiwqkn-56.png:accept-click | 1 | 331 | 331 | 331 |
| upload:m58-del-mriiwqkn-40.png:accept-click | 1 | 331 | 331 | 331 |
| upload:m58-del-mriiwqkn-59.png:accept-click | 1 | 329 | 329 | 329 |
| upload:m58-del-mriiwqkn-1.png:accept-click | 1 | 328 | 328 | 328 |
| upload:m58-del-mriiwqkn-83.png:accept-click | 1 | 327 | 327 | 327 |
| upload:m58-stress-mriiwqkn-28.png:accept-click | 1 | 324 | 324 | 324 |
| upload:m58-stress-mriiwqkn-25.png:accept-click | 1 | 323 | 323 | 323 |
| upload:m58-del-mriiwqkn-51.png:accept-click | 1 | 323 | 323 | 323 |
| upload:m58-del-mriiwqkn-64.png:accept-click | 1 | 323 | 323 | 323 |
| upload:m58-del-mriiwqkn-79.png:accept-click | 1 | 323 | 323 | 323 |
| upload:m58-stress-mriiwqkn-57.png:accept-click | 1 | 322 | 322 | 322 |
| upload:m58-stress-mriiwqkn-71.png:accept-btn | 1 | 322 | 322 | 322 |
| upload:m58-del-mriiwqkn-65.png:accept-click | 1 | 322 | 322 | 322 |
| upload:m58-stress-mriiwqkn-65.png:accept-click | 1 | 321 | 321 | 321 |
| upload:m58-del-mriiwqkn-93.png:accept-click | 1 | 319 | 319 | 319 |
| upload:m58-del-mriiwqkn-45.png:accept-click | 1 | 317 | 317 | 317 |
| upload:m58-stress-mriiwqkn-88.png:accept-click | 1 | 316 | 316 | 316 |
| upload:m58-stress-mriiwqkn-95.png:accept-click | 1 | 316 | 316 | 316 |
| upload:m58-stress-mriiwqkn-40.png:accept-click | 1 | 315 | 315 | 315 |
| upload:m58-stress-mriiwqkn-50.png:accept-click | 1 | 315 | 315 | 315 |
| upload:m58-del-mriiwqkn-28.png:accept-click | 1 | 314 | 314 | 314 |
| upload:m58-stress-mriiwqkn-99.png:accept-click | 1 | 313 | 313 | 313 |
| upload:m58-stress-mriiwqkn-67.png:accept-click | 1 | 312 | 312 | 312 |
| upload:m58-del-mriiwqkn-20.png:accept-click | 1 | 312 | 312 | 312 |
| upload:m58-del-mriiwqkn-84.png:accept-click | 1 | 312 | 312 | 312 |
| upload:m58-del-mriiwqkn-63.png:accept-click | 1 | 311 | 311 | 311 |
| upload:m58-stress-mriiwqkn-45.png:accept-click | 1 | 310 | 310 | 310 |
| upload:m58-stress-mriiwqkn-64.png:accept-click | 1 | 310 | 310 | 310 |
| upload:m58-del-mriiwqkn-98.png:accept-click | 1 | 309 | 309 | 309 |
| upload:m58-del-mriiwqkn-80.png:accept-click | 1 | 308 | 308 | 308 |
| upload:m58-stress-mriiwqkn-24.png:accept-click | 1 | 307 | 307 | 307 |
| upload:m58-stress-mriiwqkn-43.png:accept-click | 1 | 307 | 307 | 307 |
| upload:m58-del-mriiwqkn-57.png:accept-click | 1 | 307 | 307 | 307 |
| upload:m58-del-mriiwqkn-91.png:accept-click | 1 | 307 | 307 | 307 |
| upload:m58-stress-mriiwqkn-46.png:accept-click | 1 | 306 | 306 | 306 |
| upload:m58-stress-mriiwqkn-54.png:accept-click | 1 | 306 | 306 | 306 |
| upload:m58-del-mriiwqkn-72.png:accept-click | 1 | 306 | 306 | 306 |
| upload:m58-del-mriiwqkn-78.png:accept-click | 1 | 306 | 306 | 306 |
| upload:m58-del-mriiwqkn-24.png:accept-click | 1 | 305 | 305 | 305 |
| upload:m58-del-mriiwqkn-25.png:accept-click | 1 | 305 | 305 | 305 |
| upload:m58-del-mriiwqkn-27.png:accept-click | 1 | 305 | 305 | 305 |
| upload:m58-del-mriiwqkn-8.png:accept-click | 1 | 304 | 304 | 304 |
| upload:m58-stress-mriiwqkn-13.png:accept-click | 1 | 303 | 303 | 303 |
| upload:m58-stress-mriiwqkn-26.png:accept-click | 1 | 303 | 303 | 303 |
| upload:m58-stress-mriiwqkn-34.png:accept-click | 1 | 303 | 303 | 303 |
| upload:m58-del-mriiwqkn-22.png:accept-click | 1 | 303 | 303 | 303 |
| upload:m58-del-mriiwqkn-50.png:accept-click | 1 | 302 | 302 | 302 |
| upload:m58-stress-mriiwqkn-75.png:accept-click | 1 | 301 | 301 | 301 |
| upload:m58-stress-mriiwqkn-60.png:accept-click | 1 | 300 | 300 | 300 |
| upload:m58-del-mriiwqkn-7.png:accept-click | 1 | 300 | 300 | 300 |
| upload:m58-stress-mriiwqkn-16.png:accept-click | 1 | 299 | 299 | 299 |
| upload:m58-stress-mriiwqkn-27.png:accept-click | 1 | 298 | 298 | 298 |
| upload:m58-stress-mriiwqkn-58.png:accept-click | 1 | 298 | 298 | 298 |
| upload:m58-stress-mriiwqkn-74.png:accept-click | 1 | 298 | 298 | 298 |
| upload:m58-stress-mriiwqkn-94.png:accept-click | 1 | 298 | 298 | 298 |
| upload:m58-del-mriiwqkn-53.png:accept-click | 1 | 298 | 298 | 298 |
| upload:m58-stress-mriiwqkn-55.png:accept-click | 1 | 297 | 297 | 297 |
| upload:m58-del-mriiwqkn-10.png:accept-click | 1 | 297 | 297 | 297 |
| upload:m58-del-mriiwqkn-44.png:accept-click | 1 | 296 | 296 | 296 |
| upload:m58-del-mriiwqkn-12.png:accept-click | 1 | 295 | 295 | 295 |
| upload:m58-del-mriiwqkn-17.png:accept-click | 1 | 295 | 295 | 295 |
| upload:m58-del-mriiwqkn-76.png:accept-click | 1 | 295 | 295 | 295 |
| upload:m58-del-mriiwqkn-74.png:accept-click | 1 | 294 | 294 | 294 |
| upload:m58-stress-mriiwqkn-17.png:accept-click | 1 | 292 | 292 | 292 |
| upload:m58-stress-mriiwqkn-36.png:accept-click | 1 | 292 | 292 | 292 |
| upload:m58-stress-mriiwqkn-70.png:accept-click | 1 | 292 | 292 | 292 |
| upload:m58-del-mriiwqkn-66.png:accept-click | 1 | 292 | 292 | 292 |
| upload:m58-del-mriiwqkn-48.png:accept-click | 1 | 291 | 291 | 291 |
| upload:m58-del-mriiwqkn-61.png:accept-click | 1 | 291 | 291 | 291 |
| upload:m58-del-mriiwqkn-37.png:accept-click | 1 | 290 | 290 | 290 |
| upload:m58-stress-mriiwqkn-8.png:accept-click | 1 | 289 | 289 | 289 |
| upload:m58-del-mriiwqkn-92.png:accept-click | 1 | 289 | 289 | 289 |
| upload:m58-stress-mriiwqkn-22.png:accept-click | 1 | 288 | 288 | 288 |
| upload:m58-stress-mriiwqkn-12.png:accept-click | 1 | 287 | 287 | 287 |
| upload:m58-del-mriiwqkn-52.png:accept-click | 1 | 287 | 287 | 287 |
| upload:m58-stress-mriiwqkn-29.png:accept-click | 1 | 285 | 285 | 285 |
| upload:m58-stress-mriiwqkn-87.png:accept-click | 1 | 285 | 285 | 285 |
| upload:m58-stress-mriiwqkn-71.png:accept-click | 1 | 284 | 284 | 284 |
| upload:m58-del-mriiwqkn-2.png:accept-click | 1 | 283 | 283 | 283 |
| upload:m58-del-mriiwqkn-32.png:accept-click | 1 | 283 | 283 | 283 |
| upload:m58-del-mriiwqkn-86.png:accept-click | 1 | 282 | 282 | 282 |
| upload:m58-del-mriiwqkn-88.png:accept-click | 1 | 282 | 282 | 282 |
| upload:m58-stress-mriiwqkn-1.png:accept-click | 1 | 281 | 281 | 281 |
| upload:m58-stress-mriiwqkn-66.png:accept-click | 1 | 281 | 281 | 281 |
| upload:m58-stress-mriiwqkn-18.png:accept-click | 1 | 280 | 280 | 280 |
| upload:m58-stress-mriiwqkn-20.png:accept-click | 1 | 280 | 280 | 280 |
| upload:m58-stress-mriiwqkn-39.png:accept-click | 1 | 279 | 279 | 279 |
| upload:m58-stress-mriiwqkn-52.png:accept-click | 1 | 279 | 279 | 279 |
| upload:m58-del-mriiwqkn-11.png:accept-click | 1 | 278 | 278 | 278 |
| upload:m58-stress-mriiwqkn-37.png:accept-click | 1 | 277 | 277 | 277 |
| upload:m58-del-mriiwqkn-38.png:accept-click | 1 | 277 | 277 | 277 |
| upload:m58-stress-mriiwqkn-6.png:accept-click | 1 | 275 | 275 | 275 |
| upload:m58-stress-mriiwqkn-19.png:accept-click | 1 | 275 | 275 | 275 |
| upload:m58-stress-mriiwqkn-89.png:accept-click | 1 | 274 | 274 | 274 |
| upload:m58-stress-mriiwqkn-93.png:accept-click | 1 | 272 | 272 | 272 |
| upload:m58-del-mriiwqkn-42.png:accept-click | 1 | 272 | 272 | 272 |
| upload:m58-del-mriiwqkn-71.png:accept-click | 1 | 272 | 272 | 272 |
| upload:m58-stress-mriiwqkn-68.png:accept-click | 1 | 271 | 271 | 271 |
| upload:m58-del-mriiwqkn-13.png:accept-click | 1 | 271 | 271 | 271 |
| upload:m58-stress-mriiwqkn-14.png:accept-click | 1 | 269 | 269 | 269 |
| upload:m58-del-mriiwqkn-3.png:accept-click | 1 | 266 | 266 | 266 |
| upload:m58-del-mriiwqkn-73.png:accept-click | 1 | 266 | 266 | 266 |
| upload:m58-stress-mriiwqkn-61.png:accept-click | 1 | 265 | 265 | 265 |
| upload:m58-del-mriiwqkn-68.png:accept-click | 1 | 265 | 265 | 265 |
| upload:m58-del-mriiwqkn-15.png:accept-click | 1 | 263 | 263 | 263 |
| upload:m58-del-mriiwqkn-16.png:accept-click | 1 | 263 | 263 | 263 |
| upload:m58-del-mriiwqkn-35.png:accept-click | 1 | 263 | 263 | 263 |
| upload:m58-del-mriiwqkn-62.png:accept-click | 1 | 263 | 263 | 263 |
| upload:m58-stress-mriiwqkn-38.png:accept-click | 1 | 260 | 260 | 260 |
| upload:m58-stress-mriiwqkn-42.png:accept-click | 1 | 259 | 259 | 259 |
| upload:m58-stress-mriiwqkn-92.png:accept-click | 1 | 259 | 259 | 259 |
| upload:m58-del-mriiwqkn-94.png:accept-click | 1 | 259 | 259 | 259 |
| upload:m58-del-mriiwqkn-18.png:accept-click | 1 | 258 | 258 | 258 |
| upload:m58-del-mriiwqkn-19.png:accept-click | 1 | 257 | 257 | 257 |
| upload:m58-del-mriiwqkn-0.png:accept-click | 1 | 254 | 254 | 254 |
| upload:m58-stress-mriiwqkn-98.png:accept-click | 1 | 253 | 253 | 253 |
| upload:m58-del-mriiwqkn-82.png:accept-click | 1 | 252 | 252 | 252 |
| upload:m58-del-mriiwqkn-57.png:accept-btn | 1 | 251 | 251 | 251 |
| upload:m58-del-mriiwqkn-90.png:accept-click | 1 | 249 | 249 | 249 |
| upload:m58-sync-mriiwqkn.png:accept-click | 1 | 248 | 248 | 248 |
| upload:m58-stress-mriiwqkn-15.png:accept-click | 1 | 248 | 248 | 248 |
| upload:m58-stress-mriiwqkn-85.png:accept-click | 1 | 248 | 248 | 248 |
| upload:m58-stress-mriiwqkn-2.png:accept-click | 1 | 247 | 247 | 247 |
| upload:m58-stress-mriiwqkn-23.png:accept-click | 1 | 247 | 247 | 247 |
| upload:m58-stress-mriiwqkn-90.png:accept-click | 1 | 241 | 241 | 241 |
| upload:m58-stress-mriiwqkn-83.png:accept-click | 1 | 238 | 238 | 238 |
| upload:m58-stress-mriiwqkn-48.png:accept-click | 1 | 236 | 236 | 236 |
| upload:m58-stress-mriiwqkn-3.png:accept-click | 1 | 235 | 235 | 235 |
| upload:m58-stress-mriiwqkn-33.png:accept-click | 1 | 235 | 235 | 235 |
| upload:m58-stress-mriiwqkn-35.png:accept-click | 1 | 235 | 235 | 235 |
| upload:m58-stress-mriiwqkn-30.png:accept-click | 1 | 233 | 233 | 233 |
| upload:m58-stress-mriiwqkn-10.png:accept-click | 1 | 231 | 231 | 231 |
| upload:m58-del-mriiwqkn-40.png:accept-btn | 1 | 231 | 231 | 231 |
| upload:m58-del-mriiwqkn-54.png:accept-btn | 1 | 231 | 231 | 231 |
| upload:m58-stress-mriiwqkn-73.png:accept-click | 1 | 228 | 228 | 228 |
| upload:m58-del-mriiwqkn-43.png:accept-btn | 1 | 226 | 226 | 226 |
| upload:m58-stress-mriiwqkn-44.png:accept-click | 1 | 225 | 225 | 225 |
| upload:m58-stress-mriiwqkn-63.png:accept-click | 1 | 224 | 224 | 224 |
| upload:m58-del-mriiwqkn-23.png:accept-click | 1 | 223 | 223 | 223 |
| upload:m58-del-mriiwqkn-78.png:accept-btn | 1 | 222 | 222 | 222 |
| upload:m58-del-mriiwqkn-58.png:accept-btn | 1 | 219 | 219 | 219 |
| upload:m58-del-mriiwqkn-12.png:accept-btn | 1 | 218 | 218 | 218 |
| upload:m58-del-mriiwqkn-94.png:accept-btn | 1 | 216 | 216 | 216 |
| upload:m58-del-mriiwqkn-36.png:accept-btn | 1 | 212 | 212 | 212 |
| upload:m58-stress-mriiwqkn-35.png:accept-btn | 1 | 211 | 211 | 211 |
| upload:m58-stress-mriiwqkn-0.png:accept-click | 1 | 207 | 207 | 207 |
| upload:m58-del-mriiwqkn-14.png:accept-click | 1 | 206 | 206 | 206 |
| upload:m58-stress-mriiwqkn-5.png:accept-btn | 1 | 205 | 205 | 205 |
| upload:m58-stress-mriiwqkn-5.png:accept-click | 1 | 202 | 202 | 202 |
| upload:m58-stress-mriiwqkn-82.png:accept-click | 1 | 202 | 202 | 202 |
| upload:m58-del-mriiwqkn-75.png:accept-click | 1 | 202 | 202 | 202 |
| upload:m58-del-mriiwqkn-59.png:accept-btn | 1 | 201 | 201 | 201 |
| upload:m58-del-mriiwqkn-28.png:accept-btn | 1 | 200 | 200 | 200 |
| upload:m58-del-mriiwqkn-74.png:accept-btn | 1 | 196 | 196 | 196 |
| upload:m58-del-mriiwqkn-76.png:accept-btn | 1 | 194 | 194 | 194 |
| upload:m58-del-mriiwqkn-11.png:accept-btn | 1 | 193 | 193 | 193 |
| upload:m58-stress-mriiwqkn-31.png:accept-btn | 1 | 189 | 189 | 189 |
| upload:m58-stress-mriiwqkn-96.png:accept-click | 1 | 189 | 189 | 189 |
| upload:m58-del-mriiwqkn-15.png:accept-btn | 1 | 189 | 189 | 189 |
| upload:m58-del-mriiwqkn-25.png:accept-btn | 1 | 189 | 189 | 189 |
| upload:m58-stress-mriiwqkn-9.png:accept-click | 1 | 188 | 188 | 188 |
| upload:m58-stress-mriiwqkn-21.png:accept-btn | 1 | 184 | 184 | 184 |
| upload:m58-stress-mriiwqkn-82.png:accept-btn | 1 | 184 | 184 | 184 |
| upload:m58-stress-mriiwqkn-57.png:accept-btn | 1 | 182 | 182 | 182 |
| upload:m58-del-mriiwqkn-46.png:accept-btn | 1 | 181 | 181 | 181 |
| upload:m58-del-mriiwqkn-14.png:accept-btn | 1 | 180 | 180 | 180 |
| upload:m58-stress-mriiwqkn-95.png:accept-btn | 1 | 178 | 178 | 178 |
| upload:m58-del-mriiwqkn-86.png:accept-btn | 1 | 178 | 178 | 178 |
| upload:m58-stress-mriiwqkn-61.png:accept-btn | 1 | 177 | 177 | 177 |
| upload:m58-stress-mriiwqkn-41.png:accept-btn | 1 | 174 | 174 | 174 |
| upload:m58-del-mriiwqkn-37.png:accept-btn | 1 | 174 | 174 | 174 |
| upload:m58-del-mriiwqkn-56.png:accept-btn | 1 | 173 | 173 | 173 |
| upload:m58-stress-mriiwqkn-20.png:accept-btn | 1 | 171 | 171 | 171 |
| upload:m58-stress-mriiwqkn-69.png:accept-btn | 1 | 171 | 171 | 171 |
| upload:m58-stress-mriiwqkn-50.png:accept-btn | 1 | 170 | 170 | 170 |
| upload:m58-del-mriiwqkn-34.png:accept-btn | 1 | 169 | 169 | 169 |
| upload:m58-stress-mriiwqkn-84.png:accept-btn | 1 | 167 | 167 | 167 |
| upload:m58-del-mriiwqkn-17.png:accept-btn | 1 | 167 | 167 | 167 |
| upload:m58-del-mriiwqkn-35.png:accept-btn | 1 | 167 | 167 | 167 |
| upload:m58-stress-mriiwqkn-54.png:accept-btn | 1 | 166 | 166 | 166 |
| upload:m58-del-mriiwqkn-65.png:accept-btn | 1 | 165 | 165 | 165 |
| upload:m58-del-mriiwqkn-50.png:accept-btn | 1 | 164 | 164 | 164 |
| upload:m58-del-mriiwqkn-73.png:accept-btn | 1 | 164 | 164 | 164 |
| upload:m58-del-mriiwqkn-4.png:accept-click | 1 | 163 | 163 | 163 |
| upload:m58-stress-mriiwqkn-2.png:accept-btn | 1 | 162 | 162 | 162 |
| upload:m58-stress-mriiwqkn-23.png:accept-btn | 1 | 162 | 162 | 162 |
| upload:m58-del-mriiwqkn-20.png:accept-btn | 1 | 162 | 162 | 162 |
| upload:m58-del-mriiwqkn-29.png:accept-btn | 1 | 162 | 162 | 162 |
| upload:m58-del-mriiwqkn-30.png:accept-btn | 1 | 162 | 162 | 162 |
| upload:m58-stress-mriiwqkn-67.png:accept-btn | 1 | 161 | 161 | 161 |
| upload:m58-stress-mriiwqkn-85.png:accept-btn | 1 | 161 | 161 | 161 |
| upload:m58-stress-mriiwqkn-45.png:accept-btn | 1 | 160 | 160 | 160 |
| upload:m58-stress-mriiwqkn-92.png:accept-btn | 1 | 160 | 160 | 160 |
| upload:m58-del-mriiwqkn-69.png:accept-btn | 1 | 160 | 160 | 160 |
| upload:m58-del-mriiwqkn-61.png:accept-btn | 1 | 159 | 159 | 159 |
| upload:m58-del-mriiwqkn-63.png:accept-btn | 1 | 158 | 158 | 158 |
| upload:m58-stress-mriiwqkn-63.png:accept-btn | 1 | 157 | 157 | 157 |
| upload:m58-del-mriiwqkn-62.png:accept-btn | 1 | 157 | 157 | 157 |
| upload:m58-del-mriiwqkn-75.png:accept-btn | 1 | 157 | 157 | 157 |
| upload:m58-stress-mriiwqkn-68.png:accept-btn | 1 | 156 | 156 | 156 |
| upload:m58-del-mriiwqkn-92.png:accept-btn | 1 | 156 | 156 | 156 |
| upload:m58-stress-mriiwqkn-4.png:accept-click | 1 | 155 | 155 | 155 |
| upload:m58-stress-mriiwqkn-76.png:accept-btn | 1 | 155 | 155 | 155 |
| upload:m58-del-mriiwqkn-89.png:accept-btn | 1 | 155 | 155 | 155 |
| upload:m58-stress-mriiwqkn-86.png:accept-btn | 1 | 154 | 154 | 154 |
| upload:m58-del-mriiwqkn-32.png:accept-btn | 1 | 154 | 154 | 154 |
| upload:m58-del-mriiwqkn-82.png:accept-btn | 1 | 153 | 153 | 153 |
| upload:m58-del-mriiwqkn-90.png:accept-btn | 1 | 153 | 153 | 153 |
| upload:m58-stress-mriiwqkn-26.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-stress-mriiwqkn-38.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-stress-mriiwqkn-46.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-del-mriiwqkn-23.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-del-mriiwqkn-27.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-del-mriiwqkn-31.png:accept-btn | 1 | 152 | 152 | 152 |
| upload:m58-stress-mriiwqkn-30.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-stress-mriiwqkn-49.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-stress-mriiwqkn-78.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-stress-mriiwqkn-88.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-del-mriiwqkn-22.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-del-mriiwqkn-64.png:accept-btn | 1 | 151 | 151 | 151 |
| upload:m58-del-mriiwqkn-71.png:accept-btn | 1 | 149 | 149 | 149 |
| upload:m58-refresh-mriiwqkn.png:accept-btn | 1 | 148 | 148 | 148 |
| upload:m58-stress-mriiwqkn-9.png:accept-btn | 1 | 148 | 148 | 148 |
| upload:m58-del-mriiwqkn-2.png:accept-btn | 1 | 147 | 147 | 147 |
| upload:m58-del-mriiwqkn-38.png:accept-btn | 1 | 147 | 147 | 147 |
| upload:m58-stress-mriiwqkn-24.png:accept-btn | 1 | 145 | 145 | 145 |
| upload:m58-stress-mriiwqkn-44.png:accept-btn | 1 | 145 | 145 | 145 |
| upload:m58-del-mriiwqkn-51.png:accept-btn | 1 | 145 | 145 | 145 |
| upload:m58-stress-mriiwqkn-29.png:accept-btn | 1 | 144 | 144 | 144 |
| upload:m58-del-mriiwqkn-77.png:accept-btn | 1 | 144 | 144 | 144 |
| upload:m58-stress-mriiwqkn-53.png:accept-btn | 1 | 143 | 143 | 143 |
| upload:m58-del-mriiwqkn-44.png:accept-btn | 1 | 142 | 142 | 142 |
| upload:m58-stress-mriiwqkn-27.png:accept-btn | 1 | 141 | 141 | 141 |
| upload:m58-stress-mriiwqkn-42.png:accept-btn | 1 | 141 | 141 | 141 |
| upload:m58-stress-mriiwqkn-19.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-stress-mriiwqkn-83.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-stress-mriiwqkn-89.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-stress-mriiwqkn-96.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-del-mriiwqkn-45.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-del-mriiwqkn-49.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-del-mriiwqkn-91.png:accept-btn | 1 | 140 | 140 | 140 |
| upload:m58-stress-mriiwqkn-55.png:accept-btn | 1 | 139 | 139 | 139 |
| upload:m58-del-mriiwqkn-72.png:accept-btn | 1 | 138 | 138 | 138 |
| 5.8-A:browser-launch | 1 | 137 | 137 | 137 |
| upload:m58-del-mriiwqkn-93.png:accept-btn | 1 | 137 | 137 | 137 |
| upload:m58-stress-mriiwqkn-15.png:accept-btn | 1 | 136 | 136 | 136 |
| upload:m58-stress-mriiwqkn-70.png:accept-btn | 1 | 136 | 136 | 136 |
| upload:m58-del-mriiwqkn-19.png:accept-btn | 1 | 136 | 136 | 136 |
| upload:m58-stress-mriiwqkn-10.png:accept-btn | 1 | 134 | 134 | 134 |
| upload:m58-stress-mriiwqkn-13.png:accept-btn | 1 | 134 | 134 | 134 |
| upload:m58-stress-mriiwqkn-52.png:accept-btn | 1 | 134 | 134 | 134 |
| upload:m58-stress-mriiwqkn-56.png:accept-btn | 1 | 134 | 134 | 134 |
| upload:m58-del-mriiwqkn-79.png:accept-btn | 1 | 134 | 134 | 134 |
| upload:m58-sync-mriiwqkn.png:accept-btn | 1 | 133 | 133 | 133 |
| upload:m58-del-mriiwqkn-6.png:accept-btn | 1 | 133 | 133 | 133 |
| upload:m58-del-mriiwqkn-70.png:accept-btn | 1 | 133 | 133 | 133 |
| upload:m58-stress-mriiwqkn-34.png:accept-btn | 1 | 132 | 132 | 132 |
| upload:m58-stress-mriiwqkn-75.png:accept-btn | 1 | 132 | 132 | 132 |
| upload:m58-del-mriiwqkn-96.png:accept-btn | 1 | 132 | 132 | 132 |
| upload:m58-stress-mriiwqkn-40.png:accept-btn | 1 | 131 | 131 | 131 |
| upload:m58-del-mriiwqkn-16.png:accept-btn | 1 | 131 | 131 | 131 |
| upload:m58-del-mriiwqkn-87.png:accept-btn | 1 | 131 | 131 | 131 |
| upload:m58-stress-mriiwqkn-14.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-stress-mriiwqkn-59.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-stress-mriiwqkn-66.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-del-mriiwqkn-9.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-del-mriiwqkn-68.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-del-mriiwqkn-95.png:accept-btn | 1 | 130 | 130 | 130 |
| upload:m58-stress-mriiwqkn-0.png:accept-btn | 1 | 129 | 129 | 129 |
| upload:m58-stress-mriiwqkn-32.png:accept-btn | 1 | 129 | 129 | 129 |
| upload:m58-stress-mriiwqkn-98.png:accept-btn | 1 | 129 | 129 | 129 |
| upload:m58-del-mriiwqkn-24.png:accept-btn | 1 | 129 | 129 | 129 |
| upload:m58-del-mriiwqkn-81.png:accept-btn | 1 | 129 | 129 | 129 |
| upload:m58-stress-mriiwqkn-1.png:accept-btn | 1 | 128 | 128 | 128 |
| upload:m58-stress-mriiwqkn-73.png:accept-btn | 1 | 127 | 127 | 127 |
| upload:m58-del-mriiwqkn-4.png:accept-btn | 1 | 127 | 127 | 127 |
| upload:m58-del-mriiwqkn-18.png:accept-btn | 1 | 127 | 127 | 127 |
| upload:m58-del-mriiwqkn-66.png:accept-btn | 1 | 127 | 127 | 127 |
| upload:m58-stress-mriiwqkn-93.png:accept-btn | 1 | 126 | 126 | 126 |
| upload:m58-stress-mriiwqkn-18.png:accept-btn | 1 | 125 | 125 | 125 |
| upload:m58-del-mriiwqkn-26.png:accept-btn | 1 | 125 | 125 | 125 |
| upload:m58-del-mriiwqkn-67.png:accept-btn | 1 | 125 | 125 | 125 |
| upload:m58-stress-mriiwqkn-77.png:accept-btn | 1 | 124 | 124 | 124 |
| upload:m58-del-mriiwqkn-3.png:accept-btn | 1 | 124 | 124 | 124 |
| upload:m58-del-mriiwqkn-53.png:accept-btn | 1 | 124 | 124 | 124 |
| upload:m58-del-mriiwqkn-88.png:accept-btn | 1 | 124 | 124 | 124 |
| upload:m58-stress-mriiwqkn-39.png:accept-btn | 1 | 123 | 123 | 123 |
| upload:m58-del-mriiwqkn-52.png:accept-btn | 1 | 123 | 123 | 123 |
| upload:m58-stress-mriiwqkn-87.png:accept-btn | 1 | 122 | 122 | 122 |
| upload:m58-del-mriiwqkn-10.png:accept-btn | 1 | 122 | 122 | 122 |
| upload:m58-del-mriiwqkn-83.png:accept-btn | 1 | 122 | 122 | 122 |
| upload:m58-stress-mriiwqkn-17.png:accept-btn | 1 | 121 | 121 | 121 |
| upload:m58-stress-mriiwqkn-58.png:accept-btn | 1 | 121 | 121 | 121 |
| upload:m58-del-mriiwqkn-7.png:accept-btn | 1 | 119 | 119 | 119 |
| upload:m58-stress-mriiwqkn-4.png:accept-btn | 1 | 118 | 118 | 118 |
| upload:m58-stress-mriiwqkn-53.png:drop | 1 | 118 | 118 | 118 |
| upload:m58-del-mriiwqkn-98.png:accept-btn | 1 | 118 | 118 | 118 |
| upload:m58-stress-mriiwqkn-16.png:accept-btn | 1 | 116 | 116 | 116 |
| upload:m58-stress-mriiwqkn-36.png:accept-btn | 1 | 116 | 116 | 116 |
| upload:m58-stress-mriiwqkn-74.png:accept-btn | 1 | 116 | 116 | 116 |
| upload:m58-stress-mriiwqkn-25.png:accept-btn | 1 | 115 | 115 | 115 |
| upload:m58-del-mriiwqkn-1.png:accept-btn | 1 | 115 | 115 | 115 |
| upload:m58-del-mriiwqkn-33.png:accept-btn | 1 | 115 | 115 | 115 |
| upload:m58-del-mriiwqkn-57.png:drop | 1 | 114 | 114 | 114 |
| upload:m58-del-mriiwqkn-60.png:accept-btn | 1 | 114 | 114 | 114 |
| upload:m58-stress-mriiwqkn-80.png:accept-btn | 1 | 113 | 113 | 113 |
| upload:m58-stress-mriiwqkn-72.png:accept-btn | 1 | 112 | 112 | 112 |
| upload:m58-stress-mriiwqkn-94.png:accept-btn | 1 | 112 | 112 | 112 |
| upload:m58-del-mriiwqkn-85.png:accept-btn | 1 | 112 | 112 | 112 |
| upload:m58-del-mriiwqkn-41.png:accept-btn | 1 | 111 | 111 | 111 |
| upload:m58-stress-mriiwqkn-43.png:accept-btn | 1 | 110 | 110 | 110 |
| upload:m58-stress-mriiwqkn-48.png:accept-btn | 1 | 110 | 110 | 110 |
| upload:m58-stress-mriiwqkn-91.png:accept-btn | 1 | 110 | 110 | 110 |
| upload:m58-stress-mriiwqkn-51.png:accept-btn | 1 | 109 | 109 | 109 |
| upload:m58-stress-mriiwqkn-97.png:accept-btn | 1 | 109 | 109 | 109 |
| upload:m58-stress-mriiwqkn-81.png:accept-btn | 1 | 108 | 108 | 108 |
| upload:m58-del-mriiwqkn-8.png:accept-btn | 1 | 108 | 108 | 108 |
| upload:m58-del-mriiwqkn-39.png:accept-btn | 1 | 108 | 108 | 108 |
| upload:m58-stress-mriiwqkn-65.png:accept-btn | 1 | 107 | 107 | 107 |
| upload:m58-stress-mriiwqkn-60.png:accept-btn | 1 | 106 | 106 | 106 |
| upload:m58-stress-mriiwqkn-6.png:accept-btn | 1 | 105 | 105 | 105 |
| upload:m58-del-mriiwqkn-47.png:accept-btn | 1 | 105 | 105 | 105 |
| upload:m58-stress-mriiwqkn-7.png:accept-btn | 1 | 104 | 104 | 104 |
| upload:m58-del-mriiwqkn-97.png:accept-btn | 1 | 104 | 104 | 104 |
| upload:m58-stress-mriiwqkn-11.png:accept-btn | 1 | 102 | 102 | 102 |
| upload:m58-stress-mriiwqkn-33.png:accept-btn | 1 | 100 | 100 | 100 |
| upload:m58-stress-mriiwqkn-99.png:accept-btn | 1 | 100 | 100 | 100 |
| upload:m58-del-mriiwqkn-84.png:accept-btn | 1 | 100 | 100 | 100 |
| upload:m58-stress-mriiwqkn-22.png:accept-btn | 1 | 98 | 98 | 98 |
| upload:m58-del-mriiwqkn-55.png:accept-btn | 1 | 98 | 98 | 98 |
| upload:m58-stress-mriiwqkn-64.png:accept-btn | 1 | 96 | 96 | 96 |
| upload:m58-del-mriiwqkn-0.png:accept-btn | 1 | 95 | 95 | 95 |
| upload:m58-del-mriiwqkn-21.png:accept-btn | 1 | 95 | 95 | 95 |
| upload:m58-del-mriiwqkn-40.png:drop | 1 | 95 | 95 | 95 |
| upload:m58-stress-mriiwqkn-3.png:accept-btn | 1 | 94 | 94 | 94 |
| upload:m58-stress-mriiwqkn-28.png:accept-btn | 1 | 92 | 92 | 92 |
| upload:m58-stress-mriiwqkn-37.png:accept-btn | 1 | 92 | 92 | 92 |
| upload:m58-stress-mriiwqkn-8.png:accept-btn | 1 | 91 | 91 | 91 |
| upload:m58-stress-mriiwqkn-47.png:accept-btn | 1 | 91 | 91 | 91 |
| upload:m58-stress-mriiwqkn-31.png:drop | 1 | 90 | 90 | 90 |
| upload:m58-stress-mriiwqkn-79.png:accept-btn | 1 | 87 | 87 | 87 |
| upload:m58-del-mriiwqkn-5.png:accept-btn | 1 | 84 | 84 | 84 |
| upload:m58-del-mriiwqkn-13.png:accept-btn | 1 | 83 | 83 | 83 |
| upload:m58-stress-mriiwqkn-90.png:accept-btn | 1 | 80 | 80 | 80 |
| upload:m58-del-mriiwqkn-48.png:accept-btn | 1 | 80 | 80 | 80 |
| upload:m58-stress-mriiwqkn-12.png:accept-btn | 1 | 77 | 77 | 77 |
| upload:m58-del-mriiwqkn-99.png:accept-btn | 1 | 77 | 77 | 77 |
| upload:m58-stress-mriiwqkn-54.png:drop | 1 | 70 | 70 | 70 |
| upload:m58-del-mriiwqkn-16.png:drop | 1 | 69 | 69 | 69 |
| upload:m58-stress-mriiwqkn-62.png:accept-btn | 1 | 68 | 68 | 68 |
| upload:m58-del-mriiwqkn-46.png:drop | 1 | 67 | 67 | 67 |
| upload:m58-del-mriiwqkn-65.png:drop | 1 | 66 | 66 | 66 |
| upload:m58-del-mriiwqkn-14.png:drop | 1 | 65 | 65 | 65 |
| upload:m58-stress-mriiwqkn-30.png:drop | 1 | 63 | 63 | 63 |
| upload:m58-del-mriiwqkn-42.png:accept-btn | 1 | 58 | 58 | 58 |
| upload:m58-del-mriiwqkn-80.png:accept-btn | 1 | 57 | 57 | 57 |
| upload:m58-del-mriiwqkn-22.png:drop | 1 | 56 | 56 | 56 |
| upload:m58-del-mriiwqkn-63.png:drop | 1 | 54 | 54 | 54 |
| upload:m58-stress-mriiwqkn-95.png:drop | 1 | 53 | 53 | 53 |
| upload:m58-del-mriiwqkn-21.png:drop | 1 | 50 | 50 | 50 |
| upload:m58-stress-mriiwqkn-35.png:drop | 1 | 49 | 49 | 49 |
| upload:m58-stress-mriiwqkn-6.png:drop | 1 | 48 | 48 | 48 |
| upload:m58-stress-mriiwqkn-98.png:drop | 1 | 47 | 47 | 47 |
| upload:m58-del-mriiwqkn-74.png:drop | 1 | 44 | 44 | 44 |
| upload:m58-del-mriiwqkn-91.png:drop | 1 | 44 | 44 | 44 |
| upload:m58-del-mriiwqkn-49.png:drop | 1 | 43 | 43 | 43 |
| upload:m58-del-mriiwqkn-93.png:drop | 1 | 43 | 43 | 43 |
| upload:m58-stress-mriiwqkn-23.png:drop | 1 | 42 | 42 | 42 |
| upload:m58-stress-mriiwqkn-38.png:drop | 1 | 41 | 41 | 41 |
| upload:m58-stress-mriiwqkn-74.png:drop | 1 | 39 | 39 | 39 |
| upload:m58-stress-mriiwqkn-93.png:drop | 1 | 38 | 38 | 38 |
| upload:m58-del-mriiwqkn-19.png:drop | 1 | 37 | 37 | 37 |
| upload:m58-del-mriiwqkn-8.png:drop | 1 | 36 | 36 | 36 |
| upload:m58-del-mriiwqkn-12.png:drop | 1 | 35 | 35 | 35 |
| upload:m58-del-mriiwqkn-13.png:drop | 1 | 35 | 35 | 35 |
| upload:m58-del-mriiwqkn-60.png:drop | 1 | 35 | 35 | 35 |
| upload:m58-del-mriiwqkn-67.png:drop | 1 | 35 | 35 | 35 |
| upload:m58-del-mriiwqkn-77.png:drop | 1 | 35 | 35 | 35 |
| upload:m58-del-mriiwqkn-24.png:drop | 1 | 34 | 34 | 34 |
| upload:m58-del-mriiwqkn-86.png:drop | 1 | 34 | 34 | 34 |
| upload:m58-del-mriiwqkn-88.png:drop | 1 | 34 | 34 | 34 |
| infrastructure:wait | 1 | 33 | 33 | 33 |
| upload:m58-stress-mriiwqkn-71.png:drop | 1 | 33 | 33 | 33 |
| upload:m58-stress-mriiwqkn-65.png:drop | 1 | 32 | 32 | 32 |
| upload:m58-del-mriiwqkn-10.png:drop | 1 | 32 | 32 | 32 |
| upload:m58-del-mriiwqkn-29.png:drop | 1 | 32 | 32 | 32 |
| upload:m58-del-mriiwqkn-39.png:drop | 1 | 32 | 32 | 32 |
| upload:m58-stress-mriiwqkn-69.png:drop | 1 | 31 | 31 | 31 |
| upload:m58-del-mriiwqkn-27.png:drop | 1 | 31 | 31 | 31 |
| upload:m58-del-mriiwqkn-36.png:drop | 1 | 31 | 31 | 31 |
| upload:m58-del-mriiwqkn-44.png:drop | 1 | 31 | 31 | 31 |
| upload:m58-stress-mriiwqkn-79.png:drop | 1 | 30 | 30 | 30 |
| upload:m58-del-mriiwqkn-28.png:drop | 1 | 30 | 30 | 30 |
| upload:m58-del-mriiwqkn-98.png:drop | 1 | 30 | 30 | 30 |
| upload:m58-del-mriiwqkn-15.png:drop | 1 | 29 | 29 | 29 |
| upload:m58-del-mriiwqkn-50.png:drop | 1 | 29 | 29 | 29 |
| upload:m58-stress-mriiwqkn-62.png:drop | 1 | 28 | 28 | 28 |
| waitHttp:http://127.0.0.1:5173/ | 1 | 27 | 27 | 27 |
| upload:m58-stress-mriiwqkn-76.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-del-mriiwqkn-6.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-del-mriiwqkn-33.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-del-mriiwqkn-73.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-del-mriiwqkn-82.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-del-mriiwqkn-92.png:drop | 1 | 27 | 27 | 27 |
| upload:m58-stress-mriiwqkn-41.png:drop | 1 | 26 | 26 | 26 |
| upload:m58-refresh-mriiwqkn.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-9.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-11.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-52.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-61.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-92.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-del-mriiwqkn-97.png:drop | 1 | 25 | 25 | 25 |
| upload:m58-stress-mriiwqkn-20.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-25.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-37.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-43.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-67.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-84.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-89.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-90.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-94.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-del-mriiwqkn-34.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-del-mriiwqkn-42.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-del-mriiwqkn-83.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-del-mriiwqkn-95.png:drop | 1 | 24 | 24 | 24 |
| upload:m58-stress-mriiwqkn-36.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-49.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-58.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-66.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-80.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-88.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-del-mriiwqkn-45.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-del-mriiwqkn-69.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-del-mriiwqkn-70.png:drop | 1 | 23 | 23 | 23 |
| upload:m58-stress-mriiwqkn-0.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-10.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-24.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-34.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-70.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-83.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-87.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-del-mriiwqkn-35.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-del-mriiwqkn-54.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-del-mriiwqkn-56.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-del-mriiwqkn-71.png:drop | 1 | 22 | 22 | 22 |
| upload:m58-stress-mriiwqkn-1.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-16.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-27.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-75.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-96.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-97.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-del-mriiwqkn-2.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-del-mriiwqkn-68.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-del-mriiwqkn-79.png:drop | 1 | 21 | 21 | 21 |
| upload:m58-stress-mriiwqkn-60.png:drop | 1 | 20 | 20 | 20 |
| upload:m58-del-mriiwqkn-53.png:drop | 1 | 20 | 20 | 20 |
| upload:m58-del-mriiwqkn-87.png:drop | 1 | 20 | 20 | 20 |
| upload:m58-del-mriiwqkn-89.png:drop | 1 | 20 | 20 | 20 |
| upload:m58-stress-mriiwqkn-64.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-del-mriiwqkn-20.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-del-mriiwqkn-32.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-del-mriiwqkn-41.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-del-mriiwqkn-58.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-del-mriiwqkn-78.png:drop | 1 | 19 | 19 | 19 |
| upload:m58-stress-mriiwqkn-7.png:drop | 1 | 18 | 18 | 18 |
| upload:m58-del-mriiwqkn-62.png:drop | 1 | 18 | 18 | 18 |
| upload:m58-del-mriiwqkn-76.png:drop | 1 | 18 | 18 | 18 |
| upload:m58-del-mriiwqkn-81.png:drop | 1 | 18 | 18 | 18 |
| upload:m58-stress-mriiwqkn-12.png:drop | 1 | 17 | 17 | 17 |
| upload:m58-del-mriiwqkn-4.png:drop | 1 | 17 | 17 | 17 |
| upload:m58-del-mriiwqkn-18.png:drop | 1 | 17 | 17 | 17 |
| upload:m58-del-mriiwqkn-47.png:drop | 1 | 17 | 17 | 17 |
| upload:m58-del-mriiwqkn-75.png:drop | 1 | 17 | 17 | 17 |
| upload:m58-del-mriiwqkn-17.png:drop | 1 | 16 | 16 | 16 |
| upload:m58-del-mriiwqkn-26.png:drop | 1 | 16 | 16 | 16 |
| upload:m58-del-mriiwqkn-37.png:drop | 1 | 16 | 16 | 16 |
| upload:m58-del-mriiwqkn-43.png:drop | 1 | 16 | 16 | 16 |
| upload:m58-del-mriiwqkn-51.png:drop | 1 | 16 | 16 | 16 |
| upload:m58-stress-mriiwqkn-86.png:drop | 1 | 15 | 15 | 15 |
| upload:m58-del-mriiwqkn-7.png:drop | 1 | 15 | 15 | 15 |
| upload:m58-del-mriiwqkn-64.png:drop | 1 | 15 | 15 | 15 |
| upload:m58-del-mriiwqkn-94.png:drop | 1 | 15 | 15 | 15 |
| upload:m58-stress-mriiwqkn-2.png:drop | 1 | 14 | 14 | 14 |
| upload:m58-del-mriiwqkn-23.png:drop | 1 | 14 | 14 | 14 |
| upload:m58-del-mriiwqkn-31.png:drop | 1 | 14 | 14 | 14 |
| upload:m58-del-mriiwqkn-55.png:drop | 1 | 14 | 14 | 14 |
| upload:m58-del-mriiwqkn-0.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-del-mriiwqkn-11.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-del-mriiwqkn-25.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-del-mriiwqkn-52.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-del-mriiwqkn-72.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-del-mriiwqkn-96.png:drop | 1 | 13 | 13 | 13 |
| upload:m58-stress-mriiwqkn-3.png:drop | 1 | 12 | 12 | 12 |
| upload:m58-del-mriiwqkn-48.png:drop | 1 | 12 | 12 | 12 |
| upload:m58-del-mriiwqkn-85.png:drop | 1 | 12 | 12 | 12 |
| upload:m58-del-mriiwqkn-90.png:drop | 1 | 12 | 12 | 12 |
| upload:m58-del-mriiwqkn-9.png:drop | 1 | 11 | 11 | 11 |
| upload:m58-del-mriiwqkn-99.png:drop | 1 | 11 | 11 | 11 |
| upload:m58-stress-mriiwqkn-26.png:drop | 1 | 10 | 10 | 10 |
| upload:m58-stress-mriiwqkn-46.png:drop | 1 | 10 | 10 | 10 |
| upload:m58-stress-mriiwqkn-48.png:drop | 1 | 10 | 10 | 10 |
| upload:m58-del-mriiwqkn-1.png:drop | 1 | 10 | 10 | 10 |
| upload:m58-sync-mriiwqkn.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-22.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-32.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-33.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-63.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-72.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-91.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-99.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-del-mriiwqkn-30.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-del-mriiwqkn-61.png:drop | 1 | 9 | 9 | 9 |
| upload:m58-stress-mriiwqkn-28.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-stress-mriiwqkn-47.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-stress-mriiwqkn-51.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-del-mriiwqkn-5.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-del-mriiwqkn-38.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-del-mriiwqkn-59.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-del-mriiwqkn-80.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-del-mriiwqkn-84.png:drop | 1 | 8 | 8 | 8 |
| upload:m58-stress-mriiwqkn-29.png:drop | 1 | 7 | 7 | 7 |
| upload:m58-del-mriiwqkn-3.png:drop | 1 | 7 | 7 | 7 |
| 5.8-B:backend-reels | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-4.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-5.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-13.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-14.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-15.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-17.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-18.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-19.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-21.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-45.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-50.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-55.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-56.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-57.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-59.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-77.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-78.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-81.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-82.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-del-mriiwqkn-66.png:drop | 1 | 6 | 6 | 6 |
| upload:m58-stress-mriiwqkn-8.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-39.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-40.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-42.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-44.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-68.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-73.png:drop | 1 | 5 | 5 | 5 |
| upload:m58-stress-mriiwqkn-85.png:drop | 1 | 5 | 5 | 5 |
| waitHttp:http://127.0.0.1:8080/health | 1 | 4 | 4 | 4 |

## Pauses > 2000ms

None recorded.

## Unbounded / risky waits

No exhausted retry loops or near-timeout waits detected in instrumented phases.

## Notes

- Profiling is **validator-only** (Mission 5.8.9). Application logic was not modified.
- Prior missions are timed at **spawn boundary** only; internal upload/wait loops inside child scripts are attributed to that mission's total.
- Fixed `waitForTimeout` calls are the dominant browser wait cost in 5.8 stress phases.

## Environment

```json
{
  "MISSION_5_8_STRESS": "100",
  "MISSION_5_8_DELETE_STRESS": "100",
  "stoppedAt": "5.8-F delete setup",
  "reason": "Expected >=100 thumbs before delete, got 20 (vault MAX_THUMBNAILS=20 cap)"
}
```

## Full timer log

See `MISSION_5_8_PROFILE.json` for complete `[MISSION_TIMER]` entries (1103 events).
