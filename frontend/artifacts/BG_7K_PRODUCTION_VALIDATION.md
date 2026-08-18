# BG-7K Production Validation

**Mission:** BG-7K-PROMOTION Step 9  
**Frontend:** https://strong-lolly-a9fcb4.netlify.app  
**Backend:** https://reelforge-deploy-production.up.railway.app  
**Raw JSON:** `frontend/artifacts/bg7k-production-validation.json`

---

## Deploy fingerprints

| Field | Value |
|-------|-------|
| Netlify deploy ID | `6a63fc2d0f70c2c343a9ce11` |
| Production bundle | `index-Dv1Hvx_O.js` |
| Railway deploy ID | `2f442416-ab37-444b-9c1b-060e52884868` |
| Git commit | `b7608ce301568c9dc8fb44275d470b15e303a02a` |

---

## PASS/FAIL matrix

| Scenario | Description | Result |
|----------|-------------|--------|
| **A** | Logged out (no admin token) → Accept disabled + "Studio login required." | **PASS** |
| **B** | Fresh Studio login → Accept enabled without page refresh | **PASS** |
| **C** | Upload thumbnail → Accept → `POST /api/reels` HTTP **202** | **PASS** |
| **D** | Expired session → Accept → **401** `invalid_session`, session cleared, banner shown, pending preserved, no vault write | **PASS** |
| **E** | One real asset shelf → exactly one card, zero Coming Soon fillers | **PASS** |
| **F** | Zero uploads shelf → five onboarding placeholders | **PASS** |

**Overall:** **ALL PASS**  
**First failing boundary:** none

---

## HTTP traces (key)

### B — reauth

```
POST /admin/auth → 200 { success: true, token: "rf_…" }
```

### D — expired session

```
POST /api/reels → 401 { error: "invalid_session" }
```

### C — successful accept

```
POST /api/reels → 202 { id: "1d422a2f-2694-4649-9989-26c7dba7b0f3", status: "ready", … }
```

---

## Console traces (key)

```
[UPLOAD_FAILED] {status: 401, error: invalid_session, …}
Upload failed: Error: invalid_session
[BG7S_SHELF_FILL] { shelf: 'Trending', realCount: 1, displayCount: 1, fillerCount: 0, branch: 'bg7k_real_assets_no_padding' }
[BG7S_SHELF_FILL] { shelf: 'Trending', realCount: 0, displayCount: 5, fillerCount: 5 }
```

Global operation status banner observed:

```
Studio session expired. Please sign in again.
```

---

## Validation runner

```bash
cd frontend
node scripts/mission-bg-7k-production-validation.mjs
```

---

## Verdict

**BG-7K RELEASE COMPLETE**
