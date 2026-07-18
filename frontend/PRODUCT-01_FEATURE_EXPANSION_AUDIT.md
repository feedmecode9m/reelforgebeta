# PRODUCT-01 — ReelForge Feature Expansion Baseline Audit

**Mission type:** Analysis and prioritization only — **no application code changes**  
**Date:** 2026-07-16  
**Predecessor:** BG investigation family closed — see [`BG_INVESTIGATION_FINAL_REPORT.md`](BG_INVESTIGATION_FINAL_REPORT.md)

---

## Executive Summary

ReelForge has a **validated media foundation** (upload, ingest, vault, hero, persistence, production deploy) and a **broad product surface** built on top of it (studio, series, workflow, marketplace, discovery, monetization, security). The highest-leverage next phase is **creator workflow completion**: turning uploaded media into published episodic content, not re-debugging pipelines.

**Validated infrastructure (do not reopen without regression evidence):**

- Media upload pipeline (`POST /api/reels` → ingestion → Postgres → static serve)
- MP4 Vault upload and persistence
- Thumbnail upload and persistence (confirm-before-upload model)
- Hero replacement with Accept confirmation
- Backend ingestion and database persistence
- MediaRenderer updates after storage writes
- Production deployment flow (Netlify + Railway)
- Playwright Hero human-flow coverage (BG-AUTO-01)

**Product maturity snapshot:**

| Layer | Maturity |
|-------|----------|
| Media / vault / hero | Production-ready, high confidence |
| Feed rendering | Production-ready with demo-placeholder fallback |
| Studio / series / workflow | Functional, partially local-first |
| Marketplace / revenue / enterprise | Foundation + roadmap UI |
| AI / discovery / search | Client-side engines, heuristic not ML |
| Automation | Hero covered; vault/episode paths not yet |

---

## 1. Current Product Capability Map

### Media & storage

| Feature | Current State | Confidence | Known Limitations |
|---------|---------------|------------|-------------------|
| **Unified upload ingress** | `createReel()` → `POST /api/reels` for video/thumbnail | High | Single canonical path; policy gate in `securityPolicyEngine` |
| **Ingestion pipeline** | Multipart upload → worker → ffmpeg → ready status | High | 202 + poll pattern; BG-5L verified |
| **MP4 Vault** | Drop → instant upload → `personal_video_vault` + feed sync | High | Upload-on-drop (differs from Hero confirm model) |
| **Thumbnail Vault** | Drop → preview → accept → persist | High | Confirm model matches Hero |
| **Hero replacement** | Drop → preview → Accept → upload → canonical stores | High | Requires explicit Accept (intentional UX) |
| **Batch delete** | Vault + API delete, feed prune | High | BG-6A phase 4 PASS |
| **MediaRenderer** | Unified video/image render with placeholder gates | High | `[RENDER_GATE]` diagnostics available |
| **Storage health** | BG-5J durability guardrails on backend | High | Ephemeral volume awareness documented |
| **localStorage sync** | Vault, hero, series metadata, many studio stores | Medium | Multi-key; sync API exists but studio is local-first |

**Key files:** `lib/api/media.js`, `lib/vaultMedia.js`, `VaultExperience.svelte`, `HeroExperience.svelte`, `viewerContext.js`, `backend/ingestion/`, `backend/src/media_durability.rs`

---

### Feed & viewer

| Feature | Current State | Confidence | Known Limitations |
|---------|---------------|------------|-------------------|
| **Public feed** | Category rows via `ReelshortExperience` | High | Demo placeholders when catalog empty (`demoPlaceholders.js`) |
| **Theater playback** | Card click → theater mode | Medium | Watch progress partially wired |
| **Vertical / Reelshort layout** | Full experience component | Medium | Autoplay, swipe gestures |
| **Hero stage** | Background video/image from hero stores | High | Accept gate documented in BG-UX-01 |
| **Admin ghost trigger** | Password unlock → Smart Production Studio | High | Session token in localStorage |

**Key files:** `FeedExperience.svelte`, `ReelshortExperience.svelte`, `viewerContext.js`, `Viewer.svelte`

---

### Studio & creator workflow

| Feature | Current State | Confidence | Known Limitations |
|---------|---------------|------------|-------------------|
| **Smart Production Studio** | Command center + workspace tabs | High | Large surface; progressive disclosure |
| **Guide Me 3.0** | Contextual assistant, modes, coaching cards | Medium | Aggregates local signals; not live AI |
| **Series / season / episode hierarchy** | CRUD via studio + series API | Medium | Production shows 6 episodes missing assets |
| **Episode ↔ reel attachment** | `attachReelToEpisode()` in Studio | Medium | Manual ID entry UX; top Guide Me blocker |
| **Episode pipeline** | Stages: draft → review → ready | Medium | Local + API hybrid (`episodePipeline.js`) |
| **Workflow tasks** | Auto-generated from production health | Medium | Many PENDING attach-reel tasks |
| **Release center** | Schedule / readiness scoring | Medium | Blocked when assets missing |
| **Production readiness** | Weighted score (25% in prod snapshot) | Medium | Driven by missing reel attachments |

**Key files:** `StudioExperience.svelte`, `lib/studio/guideMeEngine.js`, `lib/series/episodeBridge.js`, `lib/pipeline/episodePipeline.js`, `lib/workflow/workflowEngine.js`

---

### Discovery, search & intelligence

| Feature | Current State | Confidence | Known Limitations |
|---------|---------------|------------|-------------------|
| **Discovery engine** | Client-side index across vault, series, workflow | Medium | Keyword/heuristic scoring, not vector search |
| **Universal / global search** | Cross-domain search UI | Medium | Local index rebuild |
| **Hero intelligence** | Candidate scoring, manager config | Medium | Heuristic rules in `heroIntelligence.js` |
| **Sentinel assistant** | Risk/readiness analysis overlay | Medium | Rule-based recommendations |
| **Creator copilot** | Brief generation from studio state | Low–Medium | No external LLM integration in core path |
| **AI cleanup agent** | Vault hygiene, feed sync, orphan cleanup | Medium | Client-side maintenance, not generative AI |
| **Backend ai_detector** | Rust module present | Low | Not exposed as primary user feature |

**Key files:** `lib/discovery/discoveryEngine.js`, `lib/search/universalSearchEngine.js`, `lib/sentinel/sentinelAssistant.js`, `lib/viewer/aiCleanupAgent.js`, `backend/src/ai_detector.rs`

---

### Marketplace, monetization & enterprise

| Feature | Current State | Confidence | Known Limitations |
|---------|---------------|------------|-------------------|
| **Creator marketplace** | Local listings, gigs, reviews | Low–Medium | No payment processors |
| **Revenue dashboard** | Mock/local revenue metrics | Low–Medium | Backend revenue API exists |
| **Monetization hub** | Plan cards (foundation / roadmap) | Low | UI foundation only |
| **Enterprise / SOC** | Security operations UI + audit engines | Low–Medium | Backend security events API |
| **Teams** | Local team model + API | Medium | Multi-user pipeline partial |

**Key files:** `lib/marketplace/marketplaceEngine.js`, `lib/revenue/`, `lib/enterprise/`, `backend/src/api/revenue_api.rs`, `backend/src/api/team_api.rs`

---

### Backend API surface (architecture review)

| Domain | Endpoints (representative) | Maturity |
|--------|---------------------------|----------|
| **Media / reels** | `GET/POST/DELETE /api/reels`, `/api/media/*` | Production-ready |
| **Studio** | `/api/studio/*`, series CRUD | Functional |
| **Series / episodes** | `/api/series`, `/api/episodes` | Functional |
| **Sync** | `/api/sync/status`, push/state | Functional |
| **Workflow** | `/api/workflow/tasks` | Functional |
| **Analytics / watch** | `/api/analytics`, `/api/watch/event` | Present |
| **Teams / notifications / pipeline** | Full CRUD-style routes | Present |
| **Security / revenue / monetization** | Extended API modules | Foundation |
| **Experience composition** | `experience/` module with CSPP stubs | Experimental |

**Key files:** `backend/src/main.rs`, `handlers.rs`, `api/`, `db/`, `ingestion/worker.rs`, `models.rs`

---

### Automation & validation coverage

| Area | Coverage | Gap |
|------|----------|-----|
| **Hero confirmation** | Playwright + mission runner (BG-AUTO-01) | — |
| **MP4 Vault upload/reload** | BG-6A mission script | No dedicated Playwright spec |
| **Thumbnail vault** | Partial via validate scripts | No production Playwright journey |
| **Episode reel attach** | Manual / Guide Me only | No automation |
| **Platform validation** | 40+ `validate:*` npm scripts | Script-heavy, not unified CI suite |

---

## 2. Feature Opportunities

### Creator workflow

| Opportunity | Rationale | Existing hooks |
|-------------|-----------|----------------|
| **Streamlined episode ↔ reel attachment** | #1 production blocker in Guide Me (6 missing assets) | `attachReelToEpisode`, workflow tasks, episode bridge |
| **Vault → episode drag-link** | Upload works; linking is manual ID entry | `drag-drop.js`, vault payloads, studio hierarchy |
| **Bulk vault operations** | Partial multi-select exists | `selectedVideoIds`, `selectedThumbnailIds` in VaultExperience |
| **Publishing readiness dashboard** | Readiness score exists but opaque | `productionHealth.js`, release center |
| **Episode upload from Production tab** | Upload in Content; attach in Production | Studio workspace tabs |

### User experience

| Opportunity | Rationale | Existing hooks |
|-------------|-----------|----------------|
| **First-run creator onboarding** | Studio is powerful but dense | Guide Me modes, tour steps in `guideMeEngine.js` |
| **Empty states with actions** | Vault/feed show placeholders | `contentEmpty`, demo placeholders |
| **Consistent upload feedback** | Hero vs vault vs thumbnail differ | BG-UX-01 patterns |
| **Workflow task → action deep links** | Tasks exist; navigation partial | `deepNavigationEngine.js`, Guide Me actions |
| **Mobile / responsive studio** | Viewer-first; studio desktop-oriented | CSS in `viewer.css` |

### AI opportunities

| Opportunity | Rationale | Existing hooks |
|-------------|-----------|----------------|
| **Auto-tagging from filename/metadata** | Discovery index is keyword-based | `discoveryEngine.js`, `CATEGORY_DETECTOR` |
| **Thumbnail quality scoring** | Thumbnail vault has no quality signal | `thumbnailInvariants.js` |
| **Hero candidate ranking** | Already heuristic | `heroIntelligence.js` |
| **Scene / content analysis** | `ai_detector.rs` backend stub | Not user-facing |
| **Recommendations feed** | Homepage discovery feed engine | `homepageDiscoveryFeed.js` |
| **Copilot with external LLM** | Copilot is rule-based today | `creatorCopilot.js`, `studioAssistant.js` |

### Performance

| Opportunity | Rationale | Existing hooks |
|-------------|-----------|----------------|
| **Feed lazy loading / virtualization** | Large catalogs render all cards | Reelshort row scrolling |
| **Media prefetch** | Theater transition latency | `mediaBootstrap.js`, `resourceManager` |
| **Sync debouncing** | Many localStorage writes on upload | `studioSync.js`, `scheduleSyncPush` |
| **Bundle splitting** | Vite warns 1.4MB main chunk | `vite build` output |
| **Thumbnail CDN / cache headers** | Static serve via Netlify proxy | `video_stream.rs` |

---

## 3. Prioritized Opportunities

Scoring: **User Impact** (U), **Engineering Effort** (E), **Risk** (R), **Dependencies** (D) — each H/M/L.

### High Impact / Low Risk

| Opportunity | U | E | R | D | Notes |
|-------------|---|---|---|---|-------|
| **Episode reel attachment UX** | H | M | L | Vault upload ✅, series API ✅ | Closes top Guide Me blocker without pipeline changes |
| **Workflow task deep navigation** | H | L | L | Studio tabs exist | "Attach reel to E01" → one-click to attach UI |
| **Vault Playwright automation (BG-AUTO-02 pattern)** | M | M | L | BG-AUTO-01 template ✅ | Extends proven test model; not product change |
| **Empty states with CTA** | M | L | L | None | Upload / attach prompts when vault or episodes empty |

### High Impact / High Risk

| Opportunity | U | E | R | D | Notes |
|-------------|---|---|---|---|-------|
| **Unified upload UX across Hero/Vault/Thumbnail** | H | H | M | BG-UX-01 Accept contract | Risk of breaking validated hero gate |
| **Backend-authoritative studio sync** | H | H | M | Sync API exists | Local-first → server truth migration |
| **Real payment marketplace** | H | H | H | Legal, PCI, processors | Foundation only today |
| **LLM-powered copilot** | H | H | M | API keys, cost, latency | Rule engine works offline today |

### Low Impact / Low Risk

| Opportunity | U | E | R | D | Notes |
|-------------|---|---|---|---|-------|
| **Bundle code-splitting** | L | M | L | None | Dev experience + load time |
| **Studio appearance themes** | L | L | L | `studioAppearance.js` exists | Already partially built |
| **Daily engagement card polish** | L | L | L | `dailyEngagement.js` | Cosmetic |

### Defer

| Opportunity | Reason |
|-------------|--------|
| **Re-open Hero / upload pipeline diagnostics** | BG family closed; covered by BG-AUTO-01 |
| **Change Hero Accept to auto-upload** | BG-UX-01 rejected; breaks automation contract |
| **Experience CSPP composition pipeline** | Experimental backend module; not user-critical |
| **Enterprise reporting expansion** | Marketplace/revenue not primary creator loop yet |
| **Rewrite VaultExperience / viewerContext** | Stable, validated; high regression risk |

---

## 4. Recommended Next Mission

### Mission Name

**PRODUCT-02 — Episode Reel Attachment Workflow**

### Objective

Ship a creator-facing workflow that connects **already-uploaded vault reels** to **series episodes** without modifying the upload pipeline, storage keys, or Hero Accept contract.

Transform the current manual attach flow (episode ID + reel ID fields) into a guided **"pick episode → pick vault reel → confirm attach"** journey integrated with Guide Me and workflow tasks.

### Why now

1. **Validated foundation** — vault upload, persistence, and API ingestion are proven (BG-5L, BG-6A, BG-AUTO-01). The bottleneck is **content organization**, not media transport.
2. **Production signal** — Guide Me and readiness dashboards consistently report missing episode assets as the top blocker (6 episodes, ~25% readiness).
3. **Code already exists** — `attachReelToEpisode()`, episode bridge, workflow task generation, and studio hierarchy are implemented; the gap is **product UX and discoverability**.
4. **Low pipeline risk** — attaches metadata links; does not change `createReel()`, ingestion, or hero stores.
5. **Natural automation follow-up** — enables PRODUCT-03 Playwright coverage for vault-upload → attach → feed visibility (mirroring BG-AUTO-01 discipline).

### Files likely involved

| Area | Files |
|------|-------|
| Studio UI | `src/components/experiences/StudioExperience.svelte` |
| Episode binding | `src/lib/series/episodeBridge.js`, `src/lib/series/seriesStore.js` |
| Workflow navigation | `src/lib/workflow/workflowEngine.js`, `src/lib/navigation/deepNavigationEngine.js` |
| Guide Me integration | `src/lib/studio/guideMeEngine.js`, `GuideMeAssistantPanel.svelte` |
| Vault reel picker | `src/components/experiences/VaultExperience.svelte` (read-only picker mode) |
| API | `src/lib/api/seriesApi.js`, `backend/src/api/series_api.rs` |
| Validation | New `scripts/mission-product-02-episode-attach.mjs` or Playwright spec (optional in same mission) |

### Expected validation

```bash
npm run build                                          # no regressions
npm run test:hero-playwright                           # hero contract unchanged
npm run test:hero-confirmation                         # hero contract unchanged
node scripts/mission-bg-6a-production-ui-validate.mjs  # vault phase still PASS
# New: manual or automated attach flow
# Upload vault reel → attach to episode E01 → reload → episode.reelId set → feed/play works
```

### Risk level

**Low–Medium**

| Risk | Mitigation |
|------|------------|
| Breaking vault/hero upload | Scope UI to attach-only; no upload handler changes |
| Series API mismatch | Use existing `attachReelToEpisode` API path |
| Workflow desync | Reuse `loadStudioHierarchy()` + existing sync hooks |
| Over-scoping | Phase 1: single-series attach UI; defer bulk/multi-series |

---

## 5. Architecture Reference (for product phase)

### Frontend layering

```text
Viewer.svelte
  ├── FeedExperience → ReelshortExperience (public feed)
  ├── HeroExperience (stage + replace section)
  ├── VaultExperience (MP4 + thumbnail vaults)
  ├── StudioExperience (series, attach, pipeline)
  └── viewerContext.js (stores, syncFromVault, feed, agents)

lib/api/media.js     → createReel, upload, delete, fetch (canonical upload)
lib/vaultMedia.js    → reel type helpers, poster resolution
lib/storage.js       → localStorage registry + quota
```

### Backend layering

```text
main.rs → route table
handlers.rs → reels CRUD, health, admin auth
ingestion/upload.rs + worker.rs + ffmpeg.rs → async processing
db/reels.rs, db/series.rs → Postgres persistence
media_durability.rs → production guardrails (BG-5J)
reel_contract.rs → API response normalization
```

### Validated media flow (frozen contract)

```text
Drop / pick file
  → createReel() [Hero: after Accept only]
  → POST /api/reels
  → ingestion worker
  → pollIngestionUntilReady
  → syncFromVault / saveHeroReel
  → MediaRenderer refresh
```

---

## 6. Constraints Observed (this mission)

- ✅ No backend logic modified
- ✅ No upload behavior changed
- ✅ No stable pipeline refactors
- ✅ No UX contract removals (`.accept-btn`, Hero Accept gate preserved)
- ✅ No storage key changes
- ✅ No component rewrites

---

## 7. Success Criteria — Met

| Criterion | Status |
|-----------|--------|
| Existing architecture documented | ✅ Section 1 + 5 |
| Product opportunities identified | ✅ Section 2 |
| One next implementation target selected | ✅ PRODUCT-02 |
| No production behavior changes | ✅ Documentation only |

---

## 8. Classification

```text
BG-CLOSE-01
        ↓
Infrastructure stabilization complete

PRODUCT-01
        ↓
Product evolution planning begins

PRODUCT-02 (recommended)
        ↓
First implementation milestone: episode reel attachment workflow
```

Proceed from the validated ReelForge foundation. Do not reopen closed BG investigations unless new evidence demonstrates an actual regression.

**Related documents:**

- [`BG_INVESTIGATION_FINAL_REPORT.md`](BG_INVESTIGATION_FINAL_REPORT.md) — closed investigation archive
- [`BG-AUTO-01_HERO_AUTOMATION_AUDIT.md`](BG-AUTO-01_HERO_AUTOMATION_AUDIT.md) — automation contract reference
- [`BG-UX-01_HERO_UX_AUDIT.md`](BG-UX-01_HERO_UX_AUDIT.md) — Hero Accept product decision
