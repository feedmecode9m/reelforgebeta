# Hero Authority — Server Migration Notes (Phase 8)

Server is the **canonical source** of Hero publication truth.  
The client may **request**, **display**, **draft**, and **rehydrate** — it must not originate final lifecycle grants.

## Backend module

`backend/src/api/hero_authority.rs` owns server grants:

- **Backend responsibilities**: authenticate principal, bind actor role, validate lifecycle chain, append-only audit rows, mint `srv1` signatures.
- Frontend never grants publication locally.

## Authority roles

| Role | Rule |
|------|------|
| **Frontend authority** | *requests publication* (authenticated session only) |
| **Backend authority** | *grants publication* (session-bound actor + append-only audit + signature) |
| **Viewer** | *only displays verified publication* |

```
creatorTruth
     ↓
heroPresentation (draft local ok)
     ↓
authenticated lifecycle request
     ↓
POST /api/hero/authority/events  (server binds principal; strips client actor elevation)
     ↓
backend grants / rejects
     ↓
serverAuthorityReceipt + serverAuthorityState
     ↓
GET /api/hero/authority/events/:heroId  (rehydrate on Vault / Manager load)
     ↓
public Hero Vault (verified only)
```

## Phase 8 — Production runtime hardening

### Identity binding

- `resolveAuthorityIdentity()` reads session / admin_session bridge (never `master_hero_admin` display strings).
- Client-supplied `actor` / `approvedBy` / elevated fields → reject (`client_supplied_elevated_actor`).
- Backend `bind_session_actor` requires authenticated admin with hero authority permission.

### Draft vs publish

| Action | Authority |
|--------|-----------|
| Draft edit / local save | Client allowed |
| `approved` / `published` / `archived` | **Server required** |

### Rehydration (automatic)

```
load HeroRecord
 → fetch server authority history
 → verify signatures
 → merge serverAuthorityState (server wins; missing ⇒ unpublished)
 → resolve public presentation
```

### UI states (never bare “Published”)

- Pending approval  
- Rejected by authority  
- Waiting for authentication  
- Server unavailable  
- **Published and verified** — only when receipt + verified signature + lifecycle `published`

### Signature versioning

| Version | Algorithm | Status |
|---------|-----------|--------|
| `srv1` | FNV-1a 64 → `srv1:{hex16}` | **active mint** |
| `srv2` | HMAC-SHA256 → `srv2:{hex64}` | **contract only** — shape recognized, not minted, not trusted |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/hero/authority/events` | Grant (session actor bind) |
| GET | `/api/hero/authority/events?heroId=` | List trusted history |
| GET | `/api/hero/authority/events/:heroId` | Rehydrate trusted history |

### HeroRecord grant fields

```js
serverAuthorityReceipt: {
  authorityEventId,
  serverTimestamp,
  serverSignature,
  signatureVersion: "srv1"
}

serverAuthorityState: {
  status,                 // draft|review|approved|published|archived
  authorityEventId,
  serverTimestamp,
  verified: true,
  signatureVersion?: "srv1"
}
```

### Public resolver

`resolvePublicHeroViewerCopy()` + `isServerGrantedPublished()` require:

1. creatorTruth  
2. heroPresentation when published  
3. lifecycle published  
4. valid `serverAuthorityReceipt`  
5. matching `serverAuthorityState` verified published  

Otherwise: creatorTruth only.

## Validators

- `validate-server-backed-hero-authority.mjs`
- `validate-hero-authority-single-source.mjs`
- `validate-hero-production-authority-runtime.mjs`
- `validate-hero-read-authority.mjs`

## Migration phases

| Phase | Status |
|-------|--------|
| 5 Contract prep | done |
| 6 Server grant + receipt | done |
| 7 Rehydrate + single source | done |
| **8 Production runtime hardening** | **now** |
| 9 Cut over mint to `srv2` HMAC | future |
