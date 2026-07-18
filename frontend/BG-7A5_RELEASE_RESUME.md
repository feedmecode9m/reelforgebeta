# BG-7A.5 — Release Resume Capability

**Mission:** BG-7A.5 — Release Resume Capability  
**Date:** 2026-07-17  
**Scope:** Release tooling enhancement only — no application code changes  
**Release process:** ReelForge Release Engineer v1.0 (frozen gate order unchanged)

---

## Summary

Blocked releases can now **resume from the first incomplete gate** instead of always restarting at Gate 1.

| Scenario | Before BG-7A.5 | After BG-7A.5 |
|----------|----------------|---------------|
| Gate 1 PASS, Gate 2 BLOCKED | Re-run Gate 1 build on every attempt | Skip Gate 1; resume at Gate 2 |
| Bundle hash changed | N/A | Invalidate resume; restart Gate 1 |
| Tooling hash changed | N/A | Invalidate resume; restart Gate 1 |

Gate ordering, deployment, bundle verification, smoke, and regression requirements are **unchanged**. Failed or blocked gates are **never skipped**.

---

## Files updated

| File | Change |
|------|--------|
| `.cursor/skills/reelforge-release-engineer/scripts/release-run.sh` | Resume resolution at startup; conditional gate execution |
| `.cursor/skills/reelforge-release-engineer/scripts/write-release-manifest.mjs` | Fingerprinting, `--resolve-resume`, `--restore-gate-state`, manifest fields |
| `.cursor/skills/reelforge-release-engineer/manifest-template.json` | Added `release_tooling_hash`, `resume` section |
| `.cursor/skills/reelforge-release-engineer/SKILL.md` | Resume eligibility rules and examples |

No application code, frontend behavior, backend behavior, or gate order was modified.

---

## Resume eligibility

Resume is permitted **only** when the prior manifest for the same milestone matches on all four fingerprints:

| Fingerprint | Manifest field | Current source |
|-------------|----------------|----------------|
| Process version | `release_process_version` | `process-version.json` |
| Git commit | `git_commit_full` | `git rev-parse HEAD` |
| Bundle hash | `bundle_hash` | `dist/assets/index-*.js` basename |
| Release tooling | `release_tooling_hash` | SHA-256 of `release-run.sh`, `write-release-manifest.mjs`, `deploy-netlify.sh` |

If **any** fingerprint mismatches or is missing → **start from Gate 1**.

---

## Resume algorithm

```
1. Read release-manifest-latest.json for milestone
2. Count consecutive PASS gates from Gate 1
3. start_gate = last_consecutive_pass + 1
4. Verify all four fingerprints match
5. If eligible:
     restore PASS gate state from manifest
     skip gates < start_gate
     execute gates >= start_gate in immutable order
   Else:
     init fresh gate state
     execute from Gate 1
```

### Example: BG-7A blocked at Gate 2

**Prior manifest:**

```json
{
  "gates": {
    "1_build": "PASS",
    "2_credentials": "BLOCKED",
    "3_deploy": "PENDING"
  },
  "bundle_hash": "index-DzsYCSxC.js",
  "release_tooling_hash": "8a35672aa61400800a837d17aa63b729729678b9131de94ba1cb31842a74ed76"
}
```

**Second execution output:**

```text
==> ReelForge release-run: BG-7A
    Resuming from Gate 2 (Gate 1 PASS; resuming at Gate 2)
    Gates 2–7 (immutable order)

Gate 1: SKIP (resume — prior PASS)
Gate 2: Credential check
  BLOCKED: NETLIFY_AUTH_TOKEN not set
```

Gate 1 build was **not** re-executed. Gate 2 was re-evaluated.

---

## Manifest schema additions

```json
{
  "release_tooling_hash": "8a35672aa61400800a837d17aa63b729729678b9131de94ba1cb31842a74ed76",
  "resume": {
    "supported": true,
    "start_gate": 2,
    "resumed": true,
    "resumed_at": "2026-07-17T04:34:34.968Z",
    "prior_manifest_timestamp": "2026-07-17T04:34:29.155Z",
    "fingerprint": {
      "processVersion": "1.0",
      "gitCommit": "1635252",
      "gitCommitFull": "1635252aa41db557afb0d1bf610673187412d493",
      "bundleHash": "index-DzsYCSxC.js",
      "toolingHash": "8a35672aa61400800a837d17aa63b729729678b9131de94ba1cb31842a74ed76"
    }
  }
}
```

---

## CLI inspection

```bash
# Preview resume decision without running gates
node .cursor/skills/reelforge-release-engineer/scripts/write-release-manifest.mjs --resolve-resume BG-7A

# Restore gate state from manifest (called internally by release-run)
node .cursor/skills/reelforge-release-engineer/scripts/write-release-manifest.mjs --restore-gate-state BG-7A
```

---

## Validation results

### Test 1 — Resume from Gate 2 (BG-7A blocked state)

**Setup:** Prior manifest with Gate 1 PASS, Gate 2 BLOCKED; manifest backfilled with `release_tooling_hash`.

**Resolve:**

```json
{
  "resume": true,
  "start_gate": 2,
  "reason": "Gate 1 PASS; resuming at Gate 2"
}
```

**Execution** (`RELEASE_THROUGH_GATE=2 bash release-run.sh BG-7A`):

| Gate | Result |
|------|--------|
| Gate 1 | SKIP (resume — prior PASS) |
| Gate 2 | RUN — BLOCKED (no token) |

**PASS** — second execution started at Gate 2, not Gate 1.

---

### Test 2 — Bundle hash change invalidates resume

**Setup:** Modified `release-manifest-latest.json` → `bundle_hash: "index-FAKE99999.js"`

**Resolve:**

```json
{
  "resume": false,
  "start_gate": 1,
  "reason": "bundle_hash mismatch or missing — restart from Gate 1",
  "details": {
    "field": "bundle_hash",
    "expected": "index-FAKE99999.js",
    "actual": "index-DzsYCSxC.js"
  }
}
```

**PASS** — bundle hash change forces restart from Gate 1.

---

### Test 3 — Legacy manifest without tooling hash

**Setup:** Manifest predating `release_tooling_hash` field.

**Resolve:**

```json
{
  "resume": false,
  "start_gate": 1,
  "reason": "release_tooling_hash mismatch or missing — restart from Gate 1"
}
```

**Remediation:** Run `write-release-manifest.mjs` once to backfill tooling hash without re-running gates (uses existing gate state).

---

## Constraints preserved

| Rule | Status |
|------|--------|
| Immutable gate ordering | ✓ Unchanged |
| Never skip failed gate | ✓ BLOCKED/FAIL gates re-run |
| Never skip deployment (Gate 3) | ✓ Only skipped if prior PASS restored |
| Never skip bundle verification | ✓ Same |
| Never skip smoke / regression | ✓ Same |
| No application code changes | ✓ Release tooling only |

---

## Operational note for BG-7A

When `NETLIFY_AUTH_TOKEN` becomes available:

```bash
export NETLIFY_AUTH_TOKEN='…'
bash .cursor/skills/reelforge-release-engineer/scripts/release-run.sh BG-7A
```

Expected flow:

1. Gate 1 SKIP (prior PASS from BG-7A.3)
2. Gate 2 PASS (credentials present)
3. Gates 3–7 execute in order

No Gate 1 rebuild required if bundle hash and fingerprints remain stable.

---

**STOP.**
