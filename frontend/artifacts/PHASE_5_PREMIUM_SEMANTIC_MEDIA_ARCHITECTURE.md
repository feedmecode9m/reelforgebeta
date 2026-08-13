# Phase 5 — Premium Semantic Media Experience

**Status:** Implementation Complete · **Release:** Not started (no deploy)  
**Principle:** AI assists · Creator decides · ReelForge metadata drives presentation  
**Date:** 2026-08-13

---

## Architecture

```
Catalog asset (/api/reels)
        ↓
Identity registry (EXACT / optional)
        ↓
Creator catalog + editorial context (existing)
        ↓
NLP classifyContentSemantic (existing — suggestion only)
        ↓
semanticThemeSignals  ──► themes / mood / audience / contentType  (≠ shelves)
        ↓
presentationThemeSystem ──► family, badges, motion, card variant  (visual only)
        ↓
semanticCardProfile ──► Premium Semantic Media Profile (derived, in-memory)
        ↓
creatorPresentationControl ──► suggested draft (persist gated)
        ↓
SemanticProductionCard ──► cinematic UI
```

### Separation of concerns

| Layer | Owns | Never owns |
|-------|------|------------|
| `discoveryTaxonomy` | Active + future shelf registry | Themes, moods, auto-assignment |
| `semanticThemeSignals` | Themes / mood / audience from evidence | Shelf placement |
| `presentationThemeSystem` | Visual family (production/drama/action/technology/neutral) | Categories |
| `semanticCardProfile` | Derived presentation profile | Mutations / invented copy |
| `creatorPresentationControl` | Future-ready draft + workflow | Silent persist |
| Card UI | Hierarchy, hover, badges | Fake platform branding |

### Expandable taxonomy

- **Active today:** Trending, Romance, Cyber-Action, Suspense  
- **Future (registered only):** Documentary, Music, Culture, Comedy, Reality, Sports, Education, Animation, Experimental  
- Future shelves are **not** active in feed distribution or creator persist options.

### Creator workflow (ready, gated)

```
Asset → AI understanding → Suggested presentation → Creator approval → Published experience
```

Studio keeps `allowPersist={false}` — Apply Category remains non-mutating until explicitly enabled.

---

## Visual system

ReelForge-owned cinematic treatment (not Netflix/Apple/IMAX branding):

- Layered media plane + vignette + runtime badge  
- Expressive serif title, uppercase meta chips  
- Theme families drive accent/glow/depth CSS variables  
- Motion: lift / parallax / pulse by family  
- Variants: cinematic / editorial / compact (aspect-aware)  
- Hierarchy: What (series/type) → Title → Why (tagline/description) → Unique (themes/mood) → Tertiary (tech meta) → Human handoff

---

## Safety invariants

- No invented titles / descriptions / creators / episodes / taglines  
- Missing fields stay empty  
- Themes ≠ shelves  
- HERO still excluded from discovery shelves (Phase 4)  
- No automatic category PATCH  
- Duplicate identities collapsed in `buildSemanticCardProfiles`  
- No external platform branding on cards  

---

## Validation

- `npm run validate:phase-5-premium-semantic-media`  
- `npm run validate:phase-4-semantic-cards`  
- `npm run validate:phase-4-semantic-cards-browser`  
- `npm run build`  
- `git diff --check`  

**Deploy:** blocked until explicit release approval.
