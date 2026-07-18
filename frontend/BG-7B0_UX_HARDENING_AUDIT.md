# BG-7B.0 — UX Hardening Audit

**Mission:** BG-7B.0 — UX Hardening Audit (planning only)  
**Date:** 2026-07-17  
**Scope:** Frontend production-readiness UX — evidence from codebase static analysis  
**Out of scope:** Hero upload pipeline behavior (BG-7A frozen), application changes, deployment, release tooling

**Reference milestones (complete):** BG-5J · BG-5K · BG-5L · BG-6A · BG-6B · BG-6C · BG-7A implementation · BG-7A.5 Release Resume  
**Release state:** Operationally blocked only by `NETLIFY_AUTH_TOKEN`

**Production target:** https://strong-lolly-a9fcb4.netlify.app  
**Prior validation artifact:** `frontend/artifacts/bg-6a-production-ui.json`

---

## Executive summary

Core production paths (feed render, vault upload, batch delete) were validated in BG-6A. This audit identifies **UX hardening gaps** that do not block infrastructure but should be addressed before a polished public release.

| Severity | Count | Release posture |
|----------|------:|-----------------|
| **P0** — Release blocker | 1 | Must fix before release sign-off |
| **P1** — Should fix before release | 10 | Strongly recommended pre-release |
| **P2** — Polish | 9 | Post-release acceptable; improves quality |
| **P3** — Future enhancement | 5 | Backlog / nice-to-have |

**Top risk:** Global operation feedback (`uploadStatus`) is written throughout Vault, Studio, and sync flows but **never rendered in the UI**, leaving users without visible confirmation for uploads, deletes, sync, and errors (except Hero replace panel and a few localized hints).

**Strengths observed:** Feed cards use semantic `<button>` with `aria-label` and keyboard handlers; Studio and delete modals implement focus trapping; Hero replace panel uses `aria-live`; responsive breakpoints exist for hero, studio workspace, feed rows, and vault grids.

---

## Audit methodology

| Method | Coverage |
|--------|----------|
| Static review of primary surfaces | Hero (non-upload UX), Feed, Vault, Studio, Settings (`PlatformConfigPanel`) |
| Pattern grep | `aria-*`, `@media`, loading/error/offline, browser prefixes |
| Store-to-UI trace | `uploadStatus`, `contentEmpty`, `loading`, backend connection state |
| Cross-reference | BG-6A production UI validation (functional baseline) |

No code was modified. No deploy was performed.

---

## Findings backlog (ranked)

### P0 — Release blocker

| ID | Area | Location | User impact | Recommended fix | Complexity |
|----|------|----------|-------------|---------------|------------|
| **P0-01** | Error UX / Loading | `uploadStatus` writable store in `viewer/viewerContext.js`; consumed as prop in `StudioExperience.svelte`, `VaultExperience.svelte`, `HeroExperience.svelte`, `StudioLauncher.svelte` — **zero template bindings** (`$uploadStatus` not found anywhere in `frontend/`) | Vault uploads, batch deletes, studio uploads, sync, and offline messages are written to a store users never see. Operators get no visible success/failure feedback for most production workflows. BG-6A tests passed via automation/DOM observation, not via this status channel. | Add a persistent, accessible status region (e.g. studio header + optional global toast) bound to `$uploadStatus` with `role="status"` / `aria-live="polite"`, success/error styling, and non-emoji fallback text. | **M** |

---

### P1 — Should fix before release

| ID | Area | Location | User impact | Recommended fix | Complexity |
|----|------|----------|-------------|---------------|------------|
| **P1-01** | Accessibility | Codebase-wide — no `prefers-reduced-motion` matches; global `* { transition: transform … }` in `styles.css`; animated `glowRotate`, `heroSpin`, theater glow in `viewer/viewer.css`, `TheaterExperience.svelte` | Users with vestibular sensitivity receive continuous motion with no opt-out. | Wrap animations/transitions in `@media (prefers-reduced-motion: no-preference)`; provide reduced-motion fallbacks. | **M** |
| **P1-02** | Accessibility | `VaultExperience.svelte` — thumbnail/video/delete drop zones use `role="group"` only (lines ~1420–1565); no `tabindex`, no keyboard activation, no file-picker fallback on vault zones themselves | Keyboard-only and screen-reader users cannot add media via vault drop zones without mouse/drag. | Mirror Hero pattern: optional `role="button"`, `tabindex="0"`, `on:keydown`, and explicit “Browse file” buttons per zone. | **M** |
| **P1-03** | Responsive | `VaultExperience.svelte` — batch delete toolbars use inline `display:flex` without wrap (~lines 1395–1417, 1514–1532); `viewer.css` mobile rules only adjust grid columns (640px) | On mobile/tablet, DELETE SELECTED / BATCH DELETE ALL buttons likely overflow or clip in Studio vault panel. | Replace inline layout with responsive flex-wrap + stacked mobile layout in `viewer.css`. | **S** |
| **P1-04** | Loading | `FeedExperience.svelte` — `{#if $loading}` renders `<div class="forge-loader">SYNCHRONIZING...</div>` only; no spinner, skeleton shelves, or `aria-live` | Abrupt transition from loader to feed; screen readers get no structured loading announcement. | Add skeleton shelf placeholders + `role="status"`/`aria-busy="true"` on feed container during load. | **M** |
| **P1-05** | Error UX / Offline | `viewerContext.js` (`syncFromVault`) sets messages like “Backend offline…”, “Sync failed”; `lib/api.js` tracks `BackendConnectionState`; `lib/sync/studioSync.js` listens to `offline` — **none surfaced in Viewer DOM** | Users cannot tell when app is offline/degraded; may attempt uploads that silently fall back to localStorage. | Add visible connection badge/banner wired to backend health + `navigator.onLine`. | **M** |
| **P1-06** | Error UX / Visual | `VaultExperience.svelte` lines ~1653–1679 — empty vault shows light-themed demo cards with external `via.placeholder.com` images | Empty vault looks like real catalog content; depends on third-party URLs; breaks dark-theme consistency. | Replace with on-brand empty state, local assets, clear “No media yet” CTA — not demo cards masquerading as content. | **M** |
| **P1-07** | Accessibility / Visual | Widespread `color: rgba(255,255,255,0.45–0.55)` — e.g. `viewer.css` `.thumbnail-hint`, `StudioWorkspaceLayout.svelte` metric copy, `PlatformConfigPanel.svelte` `.platform-hint` | Secondary text likely fails WCAG AA contrast on dark backgrounds. | Audit tokens; bump muted text to ≥4.5:1 contrast or increase weight/size. | **M** |
| **P1-08** | Accessibility | `PlatformConfigPanel.svelte` — tabs have `role="tablist"` / `aria-selected` but no `aria-controls`, `id` pairing, or roving `tabindex` | Settings tabs work for mouse; keyboard tab order may skip hidden panels incorrectly. | Implement WAI-ARIA tabs pattern (roving tabindex, `aria-controls`, panel `id`s). | **S** |
| **P1-09** | Loading / Performance UX | `lib/api/ingestPoll.js` — polls up to 120s at 800ms; `VaultExperience.svelte` sets `$uploadStatus` “Uploading…” (invisible per P0-01) with no progress % | Large uploads feel hung; no progress or cancel. | Surface poll progress (status text + optional progress bar); expose cancel where safe. | **L** |
| **P1-10** | Error UX | `contentEmpty` writable in `viewerContext.js` — updated during sync but **never bound to UI** (grep shows context export only) | Public feed can appear blank after load with no guided empty state. | Drive empty-feed component from `$contentEmpty` with actionable copy (open Studio, upload). | **S** |

---

### P2 — Polish

| ID | Area | Location | User impact | Recommended fix | Complexity |
|----|------|----------|-------------|---------------|------------|
| **P2-01** | Responsive | `ReelshortExperience.svelte` — `.row-nav` hidden `@media (max-width: 900px)` | Mobile users rely on horizontal scroll without scroll affordance hints. | Add subtle edge fade or “scroll for more” hint on first visit. | **S** |
| **P2-02** | Cross-browser | `viewer.css` header gradient uses `-webkit-background-clip` + `background-clip` (partial fallback); `studioThemes.css` webkit-only clip | Safari/Firefox may render gradient headings inconsistently. | Standardize heading styles with solid high-contrast fallback when clip unsupported. | **S** |
| **P2-03** | Responsive / Performance | `ReelshortExperience.svelte` — feed cards play video on `mouseenter` when `prefersHoverPreview()` | Touch users never see hover overlay metadata (stats, badges). | Tap/long-press alternative or always-visible minimal metadata on mobile. | **M** |
| **P2-04** | Responsive | `viewer.css` `.control-center-grid { grid-template-columns: 1fr 1fr }` collapses only at 900px; Studio vault + hero side-by-side on tablet | Tablet Studio feels cramped; excessive horizontal scroll inside modal. | Add ~768px single-column breakpoint for control center grid. | **S** |
| **P2-05** | Visual consistency | Vault pending thumbnail flow still requires manual **Accept/Reject** (`VaultExperience.svelte` ~1438–1441) while Hero uses auto-accept (BG-7A) | Inconsistent upload confirmation patterns across surfaces. | Align vault thumbnail accept UX with BG-7A orchestration pattern (future BG-7B item — not hero). | **M** |
| **P2-06** | Visual consistency | Emoji-prefixed controls across Studio/Vault (`🗑️ DELETE SELECTED`, `📤 UPLOAD`, etc.) | Visual hierarchy varies; screen readers announce emoji names verbosely. | Introduce icon component + consistent button variants; `aria-label` without emoji. | **M** |
| **P2-07** | Accessibility | `SmartHelpTooltip.svelte` — `outline: none` on focusable trigger | Keyboard users may lose focus visibility on help triggers. | Replace with `:focus-visible` ring matching studio neon focus style. | **S** |
| **P2-08** | Error UX | Vault batch delete — errors go to `uploadStatus` + `console.error`; no per-card error state | Failed deletes may look successful until refresh. | Inline error badges on cards + visible summary toast. | **M** |
| **P2-09** | Loading | `viewerContext.js` line ~1727 — 5s safety timeout forces `loading.set(false)` | Slow networks may flash empty feed before sync completes. | Tie loader to sync completion; extend timeout or show “still loading” sub-state. | **S** |

---

### P3 — Future enhancement

| ID | Area | Location | User impact | Recommended fix | Complexity |
|----|------|----------|-------------|---------------|------------|
| **P3-01** | Accessibility | `Viewer.svelte` — `<main>` with header/footer but no skip link | Repeated navigation on every page load for keyboard users. | Add “Skip to feed” / “Skip to main” link. | **S** |
| **P3-02** | Cross-browser | `styles.css` — scrollbar styled with `::-webkit-scrollbar` only; partial `scrollbar-width: thin` in studio tabs | Firefox scrollbars inconsistent with Chrome. | Add `scrollbar-color` / `scrollbar-width` globally. | **S** |
| **P3-03** | Accessibility | `lib/accessibility/accessibilityAudit.js` — console/event only | No automated a11y regression gate in CI. | Wire to Playwright axe checks or mission script in release smoke. | **L** |
| **P3-04** | Performance UX | Feed shelves render many `<video preload="metadata">` cards simultaneously (`ReelshortExperience.svelte`) | Scroll jank and bandwidth use on large catalogs. | Intersection Observer: load metadata only when near viewport. | **L** |
| **P3-05** | Visual | `HeroExperience.svelte` / `viewer.css` — hero stage `84–86vh` min-heights on mobile | Hero dominates viewport; feed below fold on phones. | Reduce mobile hero height; optional collapsed hero mode. | **M** |

---

## Area summaries

### 1. Accessibility

| Signal | Assessment |
|--------|------------|
| Keyboard navigation | **Mixed** — Feed cards, ghost studio trigger, hero replace zone, studio/delete modals: good. Vault drop zones, some editable labels: gaps. |
| Focus order | **Mixed** — Studio overlay focus trap implemented (`StudioExperience.svelte`). Platform tabs incomplete. |
| ARIA | **Mixed** — Feed row regions, vault delete labels, hero live regions: good. Missing live region for global status. |
| Screen reader | **Gap** — Emoji-heavy buttons; invisible `uploadStatus`; hover-only feed metadata on desktop. |
| Color contrast | **Risk** — Extensive 45–55% white opacity secondary text. |

### 2. Responsive behavior

| Surface | Desktop | Tablet | Mobile | Notes |
|---------|---------|--------|--------|-------|
| Hero | OK | OK | Tall viewport consumption (P3-05) | Breakpoints 980px / 640px in `viewer.css` |
| Feed | OK | Row nav hidden 900px | Horizontal scroll | Cards use `clamp()` sizing |
| Vault | OK | Cramped toolbars (P1-03) | Grid adjusts 640px | Demo empty state breaks theme (P1-06) |
| Studio | OK | 900px workspace stack | Modal scroll | Control center 2-col until 900px (P2-04) |
| Settings | OK | Tabs wrap | OK | No dedicated mobile layout |

### 3. Loading states

| Surface | Current | Gap |
|---------|---------|-----|
| Feed | Text “SYNCHRONIZING…” | No skeleton, no aria-live (P1-04) |
| Hero | Spinner + phase panel | Adequate for replace UX (frozen) |
| Studio upload | Spinner for auto-detect only | General upload/delete feedback missing (P0-01) |
| Vault upload | Status strings to store | Invisible + no ingest progress (P1-09) |

### 4. Error UX

| Scenario | Current | Gap |
|----------|---------|-----|
| Upload failures | `uploadStatus.set('❌ …')` | Not displayed (P0-01) |
| Empty states | Demo placeholders / blank feed | Misleading or silent (P1-06, P1-10) |
| Offline | Messages in store/console | No banner (P1-05) |
| Network failures | CORS message in `media.js` throw | User may only see generic failure |
| Validation | Vault sets warning strings | Invisible unless P0-01 fixed |

### 5. Cross-browser

| Browser | Risk |
|---------|------|
| Chrome | Primary target; webkit scrollbars, hover video |
| Firefox | Scrollbar styling; gradient text fallback |
| Edge | Chromium — likely parity with Chrome |
| Safari | `-webkit-overflow-scrolling: touch` used; `webkitAudioContext` fallback in audio engine; video autoplay/hover policies stricter |

### 6. Visual consistency

| Element | Issue |
|---------|-------|
| Modals | Delete, Studio, Theater share overlay pattern — consistent |
| Drop zones | Hero, Studio, Vault share dashed-border idiom — consistent |
| Buttons | Emoji + ALL CAPS mix across vault/studio — inconsistent (P2-06) |
| Empty/demo | Light vault demo vs dark studio — inconsistent (P1-06) |
| Cards | Feed vs vault grid chrome differ — acceptable but polish opportunity |

### 7. Performance UX

| Signal | Issue |
|--------|-------|
| Large uploads | 120s ingest poll without visible progress (P1-09) |
| Long polling | Same |
| Animation | Global transitions on all elements (P1-01) |
| Scroll | Horizontal feed rows OK; studio tab overflow scroll on mobile |
| Layout shift | Card `min-height` helps; loader→feed swap abrupt (P1-04) |

---

## Recommended BG-7B implementation order

```
Phase 7B.1 — Critical feedback
  P0-01 → P1-05 → P1-10

Phase 7B.2 — Accessibility & responsive
  P1-01 → P1-02 → P1-07 → P1-08 → P1-03

Phase 7B.3 — Loading & empty states
  P1-04 → P1-06 → P1-09 → P2-09

Phase 7B.4 — Polish & cross-browser
  P2-01 → P2-02 → P2-03 → P2-04 → P2-05 → P2-06 → P2-07 → P2-08

Phase 7B.5 — Future
  P3-* as capacity allows
```

---

## Positive findings (preserve in BG-7B)

| Item | Evidence |
|------|----------|
| Feed card accessibility | `ReelshortExperience.svelte` — `<button class="reel-card">` with `aria-label="Play {title}"` and Enter/Space handlers |
| Studio modal a11y | `StudioExperience.svelte` — `role="dialog"`, `aria-modal`, focus trap |
| Delete modal a11y | `StudioLauncher.svelte` — labelled dialog, focus trap, spinner on delete |
| Hero replace feedback | `HeroExperience.svelte` — `aria-live="polite"` state panel (BG-7A frozen) |
| Production functional baseline | BG-6A — feed, vault upload, batch delete validated on production |

---

## Constraints acknowledged

- **No code changes** in this mission
- **Hero upload behavior** not investigated (BG-7A frozen); hero carousel/responsive noted only where unrelated to upload pipeline
- **Release tooling** untouched
- **Deploy** not performed

---

## Conclusion

BG-7B should treat **visible operational feedback (P0-01)** as the highest-priority UX hardening item, followed by **accessibility motion/keyboard gaps** and **honest empty/offline states**. Functional production paths are proven; this backlog addresses operator and viewer experience quality before release sign-off after `NETLIFY_AUTH_TOKEN` deploy.

**This document is the implementation backlog for BG-7B.**

**STOP.**
