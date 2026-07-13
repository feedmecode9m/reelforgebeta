# MISSION_5_7_3_LIVE_DELETE_TRACE

Generated: 2026-07-12T13:55:00.000Z

## Result: INVESTIGATION COMPLETE — NO PATCH APPLIED

Live UI reproduction explains authoritative behavior: **vault shows 20 thumbnails, batch delete leaves count at 20.**

---

## First failing stage

**Path A (DELETE SELECTED THUMBS — primary when orphans dominate):**  
**Selection state** — `selectedThumbnailIds` remains empty; delete handler never runs with targets.

**Path B (BATCH DELETE ALL — matches “count unchanged” after click):**  
**Storage update / viewerContext** — backend DELETE succeeds, but personal vault store is never tombstoned; `personal_thumbnails` and `personalThumbnailCollection` stay at 20.

---

## Authoritative symptom reproduction

Live trace file: `live-delete-trace-573.json`

### Scenario: 20 thumbnails (5 canonical + 15 id-less phantoms)

| Stage | Count | Notes |
|-------|-------|-------|
| Page load | **20** cards, 15 placeholders | `thumbsWithId: 5`, `thumbsWithoutId: 15`, `enabled checkboxes: 5` |
| After selecting 3 canonical | `DELETE SELECTED THUMBS (3)` enabled | `selectedIds`: 3 UUIDs |
| After DELETE SELECTED | **17** | 3 API DELETE 200; 15 phantoms remain |
| User expectation “unchanged at 20” | — | Matches if user selects orphans or uses BATCH DELETE ALL |

### Scenario: 20 all-phantom thumbnails (orphaned, no `reel.id`)

| Stage | Count | Notes |
|-------|-------|-------|
| Page load | **20** | `enabled checkboxes: 0`, all labeled Orphan |
| Force-click 5 checkboxes | **0** checked, **0** `[BATCH_SELECT]` logs | `toggleThumbnailSelection('')` no-op |
| DELETE SELECTED button | `(0)` **disabled** | `batchDeleteSelectedThumbnails()` not invoked |
| BATCH DELETE ALL click | **20** unchanged | **22** `DELETE /api/reels/{id}` sent, vault store untouched |

---

## Event flow verification

### DELETE SELECTED THUMBS (all-phantom vault)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Delete button click fires? | **No effective click** | Button `disabled={selectedThumbnailIds.length === 0}` |
| 2 | `batchDeleteSelectedThumbnails()` executes? | **No** | No `[BATCH_DELETE_CLICK]` in logs |
| 3 | `selectedThumbnailIds` contains ids? | **No** | 0 enabled checkboxes; no `[BATCH_SELECT]` |
| 4–10 | — | **Not reached** | — |

**FIRST "No": #3 — selection state**

### DELETE SELECTED THUMBS (mixed vault, 3 canonical selected)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Button click fires? | **Yes** | `[BATCH_DELETE_CLICK] selectedCount: 3` |
| 2 | `batchDeleteSelectedThumbnails()` executes? | **Yes** | `[BATCH_DELETE_START]` |
| 3 | `selectedThumbnailIds` contains ids? | **Yes** | 3 UUIDs |
| 4 | `deleteReelById()` called? | **Yes** | 3 `[BATCH_DELETE_ITERATION]` |
| 5 | `fetch()` executed? | **Yes** | 3 DELETE requests |
| 6 | Backend receives DELETE? | **Yes** | `DELETE /api/reels/{uuid}` |
| 7 | Backend returns success? | **Yes** | status 200 ×3 |
| 8 | viewerContext removes reel? | **Partial** | 3 canonical removed; **15 id-less entries kept** |
| 9 | localStorage updates? | **Partial** | 20 → 17; phantoms persist |
| 10 | Render reintroduces deleted? | **No** | Count 17 after delete |

**FIRST divergence from user “unchanged at 20”:** partial delete only; phantoms survive due to tombstone guard.

### BATCH DELETE ALL (20 all-phantom vault)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Button click fires? | **Yes** | Handler runs |
| 2 | `batchDeleteThumbnails()` executes? | **Yes** | 22 backend DELETEs |
| 3 | N/A selectedIds | — | — |
| 4 | `deleteReelById()` called? | **Yes** | 22 requests |
| 5 | `fetch()` executed? | **Yes** | — |
| 6 | Backend receives DELETE? | **Yes** | — |
| 7 | Backend returns success? | **Yes** | — |
| 8 | viewerContext removes entries? | **No** | No `applyThumbnailDeleteTombstone` call |
| 9 | localStorage updates? | **No** | `personal_thumbnails` length stays 20 |
| 10 | Render reintroduces? | **N/A** | Store never changed |

**FIRST "No": #8 — storage / viewerContext update**

---

## Structured log evidence (live UI)

### Selection (`[BATCH_SELECT]`)

```json
{
  "selectedCount": 3,
  "selectedIds": [
    "1fd6621f-240e-4bb3-aeb8-6bd28bcfc65d",
    "6f19ec1d-3b96-4858-84cd-57e1e087fd3b",
    "7b6e1139-c311-4203-807e-5bf25dd25d04"
  ]
}
```

Orphan vault: **no `[BATCH_SELECT]` logs** after checkbox interaction.

### Delete pipeline (`[BATCH_DELETE]`)

```json
{ "tag": "[BATCH_DELETE_CLICK]", "selectedCount": 3 }
{ "tag": "[BATCH_DELETE_START]", "selectedIds": ["…uuid…", "…", "…"] }
{ "tag": "[BATCH_STORE_UPDATE]", "beforeCount": 20, "afterCount": 17 }
{ "tag": "[BATCH_DELETE_COMPLETE]", "deletedCount": 3, "finalRegistrySize": 17 }
```

### API (`[DELETE_API]` — captured from network)

| Method | URL | Status |
|--------|-----|--------|
| DELETE | `/api/reels/1fd6621f-240e-4bb3-aeb8-6bd28bcfc65d` | 200 |
| DELETE | `/api/reels/6f19ec1d-3b96-4858-84cd-57e1e087fd3b` | 200 |
| DELETE | `/api/reels/7b6e1139-c311-4203-807e-5bf25dd25d04` | 200 |

BATCH DELETE ALL on phantom vault: **22 DELETE requests**, vault heading still **Your Thumbnails (20)**.

### Store (`[DELETE_STORE]`)

```
[DELETE_PIPELINE] stage: store_after — storeSizeBefore: 20, storeSizeAfter: 17, deletedCount: 3
```

BATCH DELETE ALL: **no store_after log**; `personal_thumbnails.length` remains 20.

### Render (`[DELETE_RENDER]`)

```
[BATCH_UI_REFRESH] newCount: 17   // DELETE SELECTED (partial)
heading: "Your Thumbnails (20)"   // BATCH DELETE ALL (unchanged)
```

---

## Live data dumps

### After page load (20 mixed)

```
personal_thumbnails: 20 (5 with id, 15 without id, 15 orphaned:true)
personal_thumbnail_index: 20 fileName strings
viewer collection: 20
rendered cards: 20 (15 placeholders)
delete button: "DELETE SELECTED THUMBS (0)" disabled=true
enabled checkboxes: 5 / disabled: 15
```

### After selection (3 canonical)

```
selectedThumbnailIds: 3 UUIDs (from [BATCH_SELECT])
delete button: "DELETE SELECTED THUMBS (3)" disabled=false
checked checkboxes: 3
```

### After DELETE SELECTED click

```
personal_thumbnails: 17
personal_thumbnail_index: 17
viewer collection: 17
remaining phantoms: 15
```

### After reload (partial delete case)

Phantoms persist in storage until explicitly removed (not tested in unchanged-20 path).

---

## Root cause analysis

### Why 20 cards exist

Mission 5.7.2 addressed catalog **import** phantoms. Remaining 20-card vaults contain **id-less / orphaned metadata** already in `personal_thumbnails` (no backend reel, 404 image → 🖼️ placeholder).

### Why batch delete appears to do nothing (count stays 20)

**Cause 1 — Selection gate (DELETE SELECTED)**  
`thumbnailSelectionId()` → `resolveThumbnailCanonicalId()` returns `''` for orphans. Checkboxes `disabled={!selectId}`. `toggleThumbnailSelection('')` returns immediately:

```304:306:frontend/src/components/experiences/VaultExperience.svelte
  function toggleThumbnailSelection(reelId) {
    const key = String(reelId || '').trim();
    if (!key) return;
```

Button bound to `disabled={selectedThumbnailIds.length === 0}` (line 1195). With all-or-mostly orphans, user cannot populate selection → **no delete attempted**.

**Cause 2 — Tombstone preserves id-less entries (DELETE SELECTED partial path)**  
Even when API delete succeeds, `applyThumbnailDeleteTombstone` **keeps every entry without a resolvable canonical id**:

```208:218:frontend/src/components/experiences/VaultExperience.svelte
    personalThumbnailCollection.update((collection) =>
      (collection || []).filter((entry, index) => {
        const id = resolveThumbnailCanonicalId(entry, index);
        return !id || !deletedSet.has(id);
      })
    );
    const nextStored = getStoredThumbnailEntries().filter((entry) => {
      if (!entry) return false;
      if (typeof entry === 'string') return true;
      const id = String(entry?.id || '').trim();
      return !id || !deletedSet.has(id);
```

`!id` → **keep**. Orphan/phantom rows are immune to id-based tombstone.

**Cause 3 — BATCH DELETE ALL never updates personal vault**  
`batchDeleteThumbnails()` deletes backend image reels from `fetchReadyReels()` then calls `syncFromVault()` — it **never calls `applyThumbnailDeleteTombstone`** and does not clear id-less local entries. Phantom rows remain at original count.

```1013:1026:frontend/src/components/experiences/VaultExperience.svelte
      const reels = await fetchReadyReels();
      const idsToDelete = reels
        .filter((reel) => { ... })
        .map((reel) => reel.id)
        .filter(Boolean);
      let removed = 0;
      for (const reelId of idsToDelete) {
        if (await deleteReelById(reelId)) removed += 1;
      }
      await syncFromVault(true, true);
```

Live proof: 22 successful DELETEs, **Your Thumbnails (20)** unchanged.

---

## Delete audit — one phantom card

| Field | Value |
|-------|-------|
| **id** | none (`orphaned: true` after 5.7.1 canonicalization) |
| **fileName** | `phantom-no-id-0.png` |
| **url** | `/thumbs/phantom-no-id-0.png` (404) |
| **orphan** | true |
| **placeholder** | true (🖼️, naturalWidth 0) |
| **selectable** | false (`disabled={!selectId}`) |
| **delete target** | none — never enters `selectedThumbnailIds` |
| **why batch delete cannot remove** | No `reel.id` → checkbox disabled → selection empty; tombstone explicitly retains `!id` entries even if other paths delete |

---

## Placeholder audit

| Field | Value |
|-------|-------|
| reason created | Id-less metadata in `personal_thumbnails` (legacy ingest / phantom pipeline 5.7.2) |
| origin | `personal_thumbnails` localStorage |
| source function | Prior `ingestThumbReelsToVault` / index rebuild (pre-5.7.2) |
| expected lifetime | Until explicitly removed from storage |
| why it survives | Tombstone `!id` guard; BATCH DELETE ALL skips vault store |
| enters `personal_thumbnails` | **yes** |
| enters `personal_thumbnail_index` | **yes** |
| enters viewer collection | **yes** |
| render-only | **no** — `{#each $personalThumbnailCollection}` |

---

## Minimal patch recommendation (NOT IMPLEMENTED)

Per mission scope — report only:

1. **`applyThumbnailDeleteTombstone`** (`VaultExperience.svelte` ~208–218): Stop retaining entries solely because `!id`. Orphan rows (`orphaned: true`) should be removable via a dedicated purge path, or excluded from vault entirely at ingest.

2. **`batchDeleteThumbnails`** (`VaultExperience.svelte` ~1011–1026): After backend deletes, call `applyThumbnailDeleteTombstone(deletedIds)` **or** clear `personal_thumbnails` / collection for entries matching deleted ids **and** purge orphaned phantoms when user confirms “delete all”.

3. **UX clarity** (optional): When all visible rows are Orphan, show why DELETE SELECTED is disabled — already partially present via Orphan label.

**Do not change:** canonical identity contract (`reel.id` only for API delete), Hero/Video/Upload/Feed/storage architecture.

---

## Files referenced (no changes made)

| File | Function | Lines |
|------|----------|-------|
| `VaultExperience.svelte` | `toggleThumbnailSelection` | 304–306 |
| `VaultExperience.svelte` | `applyThumbnailDeleteTombstone` | 205–220 |
| `VaultExperience.svelte` | `batchDeleteSelectedThumbnails` | 355–452 |
| `VaultExperience.svelte` | `batchDeleteThumbnails` | 995–1060 |
| `VaultExperience.svelte` | DELETE SELECTED button | 1191–1198 |

---

## Conclusion

Previous automated PASS validations assumed vault entries had canonical `reel.id`. **Live vault with ~20 phantom/orphan rows diverges:**

- **DELETE SELECTED:** First failure at **selection state** (no ids → button disabled / empty `selectedThumbnailIds`).
- **BATCH DELETE ALL:** First failure at **storage update** (API succeeds; personal vault never tombstoned; count unchanged at 20).

Both explain authoritative “batch delete does not remove thumbnails; count remains 20; reload unchanged.”

**Stop here — no fix applied per mission instructions.**
