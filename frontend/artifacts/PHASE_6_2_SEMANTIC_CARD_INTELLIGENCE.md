# Phase 6.2 — Semantic Premium Card Intelligence

**Status:** Implementation Complete · **Release:** N/A (no deploy)  
**Principle:** NLP suggests · Human decides · presentation only · never invent  
**Date:** 2026-08-13

---

## Architecture

```
Asset fields (title, filename, description, tags, duration, resolution, mediaType)
        ↓
enrichSemanticCard  (sync, in-memory)
        ├─ extractSemanticThemes     → themes / mood / audience / contentType
        ├─ deriveMediaPresentationFields → duration / resolution / aspect
        └─ derivePresentationTheme   → visual family / badges / motion
        ↓
viewerSemanticShell  → ViewerSemanticCard
        ↓
Studio (unchanged async path)
  semanticCardProfile → creatorPresentationControl (allowPersist=false)
```

### Separation of concerns

| Layer | Owns | Never owns |
|-------|------|------------|
| `semanticCardIntelligence` | Sync enrichment + display hierarchy | Category writes, invented copy |
| `semanticThemeSignals` | Evidence themes / mood / audience | Shelves |
| `presentationThemeSystem` | Visual family + presentation badges | Genres / ratings |
| `viewerSemanticShell` | Viewer-facing shell projection | Mutations |
| `ViewerSemanticCard` | 16:9 cinematic UI, empty states | Fabricated metadata |
| Studio `creatorPresentationControl` | Suggestion draft + human handoff | Silent persist |

### Display hierarchy

1. Media (video/artwork or elegant empty plane)  
2. Title overlay (existing title only; UI “Untitled” when missing — not catalog write)  
3. Presentation badges  
4. Duration / resolution  
5. Approved shelf chip (if present)  
6. Mood / audience / themes (evidence only)

### Human category workflow

- NLP may suggest shelves in Studio via `buildSemanticCardProfile`.  
- Creator/admin remains final shelf authority.  
- `allowPersist=false` remains.  
- Enrichment sets `suggestedCategory: ''` and `categoryWritten: false`.  
- Viewer shows **approved shelf only**.

---

## Safety invariants

- No invented titles / descriptions / creators / episodes / genres / ratings  
- Missing fields stay empty (elegant empty UI only)  
- Themes ≠ shelves  
- No category PATCH / production writes  
- No deploy in this milestone  

---

## Validation

- `npm run validate:phase-6-2-semantic-card-intelligence`  
- `npm run validate:phase-5-premium-semantic-media`  
- `npm run validate:phase-6-viewer-cinematic-cards`  
- `npm run build`  
- `git diff --check`  

**Deploy:** blocked until explicit release approval.
