# BG-7K-HARDEN — Regression Report

**Branch:** `bg-7k-auth-hardening`  
**Date:** 2026-07-24  
**Status:** PASS

---

## Automated gates

| Script | Result |
|--------|--------|
| `node frontend/scripts/mission-bg-7k-regression.mjs` | **PASS** (14/14) |
| `node frontend/scripts/mission-bg-7s-shelf-presentation-validate.mjs` | **PASS** |

Artifacts:

- `frontend/artifacts/bg7k-auth-regression.json`
- `frontend/artifacts/bg7k-placeholder-regression.json`

---

## Regression matrix (mission spec)

| # | Scenario | Expected | Automated evidence |
|---|----------|----------|-------------------|
| 1 | Logged out Accept | Disabled; no network | `logged_out_no_token`, `logged_out_empty_headers` |
| 2 | Expired token 401 | Prompt login; no ghost accept | `invalid_session_handler`, `invalid_session_event_once`, `invalid_session_clears_token` |
| 3 | Fresh login Accept | Works without refresh | `fresh_login_token`, `fresh_login_headers`; UI via `reelforge:admin-session-changed` |
| 4 | One uploaded video | Exactly one real shelf card | `one_real_card_count`, `one_real_no_layout_fillers` |
| 5 | Zero uploads | Onboarding placeholders remain | `zero_uploads_padded` (5 slots), `zero_uploads_layout_markers` |

---

## Auth regression detail

```json
{
  "tests": [
    "logged_out_no_token",
    "logged_out_empty_headers",
    "fresh_login_token",
    "fresh_login_headers",
    "invalid_session_handler",
    "invalid_session_event_once",
    "invalid_session_handler_idempotent",
    "invalid_session_clears_token",
    "is_invalid_session_error"
  ],
  "pass": true
}
```

**Key behaviors verified:**

- `getAdminAuthHeaders()` empty when logged out
- `maybeHandleInvalidAdminSession` fires `AUTH_SESSION_EXPIRED` once
- Second 401 does not double-clear or double-emit
- Token removed after `invalid_session`

---

## Placeholder regression detail

```json
{
  "tests": [
    "one_real_card_count",
    "one_real_no_layout_fillers",
    "one_real_is_real_shelf",
    "zero_uploads_padded",
    "zero_uploads_layout_markers"
  ],
  "pass": true
}
```

**Production catalog spot-check (BG-7S):**

- Trending (37 real) → display 37, fillers 0
- Romance (0 real) → display 5 fillers (onboarding)
- Cyber-Action (2 real) → display 2, fillers 0

---

## Manual follow-up (browser)

Not run in this session (requires live Studio UI):

- [ ] Drop thumbnail logged out → confirm Accept disabled + no POST in Network tab
- [ ] Studio login → Accept without reload → 202 + thumbnail in vault after sync
- [ ] Stale `rf_*` token → Accept → session expired message, pending thumbnail preserved

---

## Unified diff

Mission-scoped patch: `frontend/artifacts/bg7k-unified.diff`

New file not in git diff hunk: `frontend/src/lib/adminSession.js` (see implementation report).
