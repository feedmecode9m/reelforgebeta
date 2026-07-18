# BG-7B.1 — Global Operation Status UX

**Mission:** BG-7B.1 — Global Operation Status UX  
**Date:** 2026-07-17  
**Resolves:** BG-7B.0 **P0-01** — `uploadStatus` updated but never rendered  
**Scope:** Presentation layer only — no business logic changes

---

## Summary

Added a single global status banner that subscribes to the existing `uploadStatus` writable store. All producers remain unchanged; only the UI now surfaces their messages.

| Criterion | Result |
|-----------|--------|
| One global status component | ✅ `GlobalOperationStatus.svelte` |
| Zero business logic changes | ✅ No `uploadStatus.set` call sites modified |
| Zero duplicate status systems | ✅ Reads existing store only |
| Hero orchestration unchanged | ✅ No HeroExperience logic edits |
| Mounted once at app root | ✅ `Viewer.svelte` |

---

## Component architecture

```
uploadStatus (writable store — viewerContext.js)
        │
        │  subscribe ($uploadStatus)
        ▼
GlobalOperationStatus.svelte
        │
        ├── classifyOperationStatus()  ← operationStatusPresentation.js (pure)
        │
        └── Render by kind:
              loading  → spinner + message (aria-live="polite")
              success  → ✓ + auto-fade (~2.2s)
              warning  → ! + dismiss button
              error    → × + dismiss button (aria-live="assertive")
```

### Files added

| File | Role |
|------|------|
| `src/components/viewer/GlobalOperationStatus.svelte` | Global banner UI + dismiss/fade behavior |
| `src/lib/operationStatusPresentation.js` | Pure string → `{ kind, message, live }` mapping |

### Files modified

| File | Change |
|------|--------|
| `src/Viewer.svelte` | Import + single mount beside `ObservabilityBridge` |

### Files intentionally untouched

- `viewerContext.js` — store definition and all `uploadStatus.set` producers
- `VaultExperience.svelte`, `StudioExperience.svelte`, `HeroExperience.svelte`
- `lib/api/*`, backend, release tooling

---

## Integration point

```svelte
<!-- Viewer.svelte -->
<ObservabilityBridge />
<GlobalOperationStatus {uploadStatus} />
```

- **Z-index:** `1250` (below Studio 1500, Theater 2000, Delete 3000)
- **Position:** fixed bottom center
- **Pointer events:** banner does not block page interaction; dismiss button is focusable
- **Dismiss:** sets `uploadStatus` → `'Standby'` (same idle sentinel producers use)

---

## Visual behavior

| Kind | Trigger patterns (examples) | Icon | Auto-dismiss | Dismiss button |
|------|----------------------------|------|--------------|----------------|
| **Loading** | `Uploading…`, `Deleting…`, `Syncing…`, `Processing…` | Spinner | No — hides when producer sets `Standby` | No |
| **Success** | `✅`, `SUCCESS`, `Added to vault`, `Deleted N/N` | ✓ | Yes — fade after 2.2s | No |
| **Warning** | `⚠️`, `Backend offline`, `Storage full`, validation hints | ! | No (producer may set `Standby`) | Yes |
| **Error** | `❌`, `ERROR`, `failed` | × | No — persists until replaced/dismissed | Yes |

`Standby` and empty strings → **hidden** (no render).

Emoji prefixes are stripped from displayed text for screen-reader clarity; semantic meaning preserved in message body.

---

## Accessibility

| Requirement | Implementation |
|-------------|----------------|
| `aria-live="polite"` | Loading, success, warning |
| `aria-live="assertive"` | Errors |
| `aria-atomic="true"` | Full message announced |
| `role="status"` | On banner container |
| Keyboard dismiss | `Escape` on warning/error; dismiss button with `aria-label` |
| Focus visible | `:focus-visible` outline on dismiss |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` disables spinner animation and fade transition |

Hero replace inline panel (`hero-replace-state-panel` with its own `aria-live`) is **unchanged** — global banner does not replace or duplicate that orchestration UI; it only reflects the shared `uploadStatus` store when producers update it.

---

## Before / after (DOM evidence)

### Before BG-7B.1

```bash
# No template binding anywhere in frontend
rg '\$uploadStatus' frontend/src → 0 matches
```

Status updates were invisible except Hero's dedicated replace phase panel in Studio.

### After BG-7B.1

When `uploadStatus.set('🎬 Uploading to backend...')` runs, DOM contains:

```html
<div
  class="global-operation-status global-operation-status--loading"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  data-global-operation-status="loading"
>
  <div class="global-operation-status__inner">
    <span class="global-operation-status__spinner" aria-hidden="true"></span>
    <p class="global-operation-status__message">Uploading to backend...</p>
  </div>
</div>
```

Build artifact includes component: `npm run build` → **PASS** (bundle `index-Bv9Te2Qk.js`).

---

## Validation matrix

Classification unit check (`operationStatusPresentation.js`):

| Scenario | Producer message (unchanged) | Kind | Visible message |
|----------|------------------------------|------|-----------------|
| 1. MP4 Vault upload | `🎬 Uploading to backend...` | loading | Uploading to backend... |
| 2. Hero upload | `🎬 Uploading hero video...` | loading | Uploading hero video... |
| 3. Delete Selected | `🗑️ Deleting videos from backend...` | loading | Deleting videos from backend... |
| 4. Delete All | `🗑️ Deleted 2/2 video reels` | success | Deleted 2/2 video reels |
| 5. Feed sync | `🔄 Syncing with backend...` | loading | Syncing with backend... |
| 6. Offline/backend | `Backend offline and storage full...` | warning | Backend offline and storage full... |
| 7. Validation failure | `ERROR: Invalid video file` | error | ERROR: Invalid video file |

**11/11** classification cases passed in Node verification.

### Producer integrity

No `uploadStatus.set(` call sites were modified in this mission. Producers continue to include:

- `VaultExperience.svelte` — upload, delete, validation
- `HeroExperience.svelte` — hero operations (orchestration frozen)
- `viewerContext.js` — sync, offline, refresh
- `StudioExperience.svelte` — studio upload flows
- `aiCleanupAgent.js`, `contentAgents.js`, `uiAgent.js`

---

## Regression assessment

| Area | Risk | Assessment |
|------|------|------------|
| Upload pipeline | None | No upload code touched |
| Delete pipeline | None | No delete code touched |
| Sync / offline | None | No sync logic touched |
| Hero BG-7A | None | HeroExperience not modified |
| Release tooling | None | Not touched |
| Modal stacking | Low | z-index 1250 below all modals |
| Input blocking | None | Fixed banner; non-modal |
| Duplicate toasts | Low | Success auto-fades; producers still set `Standby` |

---

## Manual verification checklist (post-deploy)

When `NETLIFY_AUTH_TOKEN` deploy is available:

1. Open Studio → Vault → drop MP4 → confirm bottom banner shows loading then success
2. Trigger Delete Selected → confirm loading then result message
3. Disconnect network → refresh → confirm offline warning visible with dismiss
4. Drop invalid file → confirm validation error persists until dismiss
5. Confirm Hero replace panel still works independently in Studio

---

## Conclusion

**BG-7B.0 P0-01 is resolved.** The existing `uploadStatus` store is now visible application-wide through one reusable, accessible component with no business logic changes.

**STOP.**
