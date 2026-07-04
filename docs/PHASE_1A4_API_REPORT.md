# Phase 1a.4 API Report

**Endpoint:** `GET /api/experience/resolve`  
**Handler:** `backend/src/api/experience.rs`  
**Composition:** `experience::experience_resolve::resolve`

---

## Enablement

| Environment variable | Value | Effect |
|---------------------|-------|--------|
| `REELFORGE_EXPERIENCE_PROFILES` | `true` or `1` | Endpoint active |
| (unset / false) | — | **404** — API disabled |

---

## Request

```
GET /api/experience/resolve?episode_id={uuid}
```

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `episode_id` | Yes | UUID | Studio episode to resolve |

No request body. No auth changes in 1a.4 (inherits global API middleware).

---

## Success response

**Status:** `200 OK`  
**Content-Type:** `application/json`  
**Body:** Full `ResolvedViewerExperience` object (`schema_version` `1.0.0`)

Includes all required contract sections: `resolve_context`, `layout`, `theme`, `labels`, `metadata`, `visibility`, `campaigns` (empty array), `slots`, `monetization_presentation`, `watch_features`, `provenance`.

Optional: `experience_profile` when hierarchy has a profile attachment.

---

## Error responses

| Status | Condition | Body shape |
|--------|-----------|------------|
| **404** | API disabled | `{ "error", "hint" }` |
| **404** | Episode not found | `{ "error", "episode_id" }` |
| **400** | Invalid `episode_id` UUID | `{ "error", "hint" }` |
| **422** | Pinned DRAFT profile (NC-103) | `{ "error", "codes": ["NC-103"], "fields" }` |
| **422** | RVE schema validation failed (NC-101 / NC-104) | `{ "error", "codes", "fields" }` |
| **500** | Database error | `{ "error", "detail" }` |

### 422 example (validation)

```json
{
  "error": "ResolvedViewerExperience validation failed",
  "codes": ["NC-101"],
  "fields": ["... schema error detail ..."]
}
```

### 422 example (pinned draft)

```json
{
  "error": "Pinned profile version cannot be DRAFT",
  "codes": ["NC-103"],
  "fields": ["experience_profile.profile_version_id"]
}
```

---

## Example

```bash
curl -s "http://localhost:8080/api/experience/resolve?episode_id=EPISODE_UUID" \
  -H "Accept: application/json" | jq '.schema_version, .resolve_context, .campaigns'
```

Expected:

```json
"1.0.0"
{ "episode_id": "...", "enforce_paywall": false, ... }
[]
```

---

## Out of scope (1a.4)

- Write endpoints for profiles, metadata, slots
- `Accept-Experience-Schema` negotiation
- Caching headers / ETag
- Batch resolve (multiple episodes)

---

## Route registration

Registered in `main.rs` under `/api` scope:

```text
GET /api/experience/resolve → api::experience::get_experience_resolve
```
