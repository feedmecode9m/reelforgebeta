# Placeholder Audit

## Placeholder surfaces

### Image vault placeholder (static fallback)

- File: `frontend/src/components/experiences/VaultExperience.svelte`
- Branch:
  - `{#if isImage(reel) && reel.url} ... {:else} <div class="placeholder">🖼️</div> {/if}`

### Video vault placeholder (static fallback)

- File: `frontend/src/components/experiences/VaultExperience.svelte`
- Branch:
  - `{#if isVideo(reel) && reel.url} ... {:else} <div class="placeholder">▶</div> {/if}`

### Runtime media error placeholder injection

- File: `frontend/src/lib/viewer/vaultUtils.js`
- Function: `handleVaultMediaError(event, item, kind)`
- Role: hide failed media element and inject/activate fallback placeholder.

## Missing placeholder regression point

- Historical failure mode:
  - thumbnail image failed loading
  - `img` was hidden
  - fallback insertion branch only reliably handled video path
  - result: blank card instead of visible placeholder

## Commit attribution

- In this workspace snapshot, vault utility/component files are not fully traceable via local git history (`--follow` returns no ancestry for extracted paths), so exact commit hash cannot be proven here.
- Function-level regression point is still concretely identified (`handleVaultMediaError` fallback branch asymmetry).

## Pending/loading placeholder behavior

- Pending upload preview is rendered via:
  - `VaultExperience.svelte` -> `.pending-preview`
- During validation, pending preview was visible for image uploads prior to accept.

## Determination

- Original placeholder component location: `VaultExperience.svelte`
- Runtime placeholder failure function: `vaultUtils.handleVaultMediaError(...)`
- Regression class: fallback activation/insertion asymmetry on image error path.
