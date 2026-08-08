#!/usr/bin/env bash
# Validate GET/PUT /api/hero/presentation against a live backend.
#
# Usage:
#   REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app \
#     bash scripts/validate-hero-presentation-api.sh
#
# Defaults to production Railway when REELFORGE_API_BASE is unset.
set -euo pipefail

BASE="${REELFORGE_API_BASE:-https://reelforge-deploy-production.up.railway.app}"
BASE="${BASE%/}"
PATH_CANON="${BASE}/api/hero/presentation"
PATH_SLASH="${BASE}/api/hero/presentation/"
PATH_PLATFORM="${BASE}/api/platform/hero"

failed=0

echo "REELFORGE_API_BASE=${BASE}"
echo "Canonical: ${PATH_CANON}"
echo

# --- GET public -------------------------------------------------------------
code=$(curl -sS \
  -o /tmp/hero_presentation_get.json \
  -w "%{http_code}" \
  "${PATH_CANON}")
body=$(head -c 400 /tmp/hero_presentation_get.json || true)
echo "GET ${PATH_CANON} → HTTP ${code}"
echo "  body: ${body}"
if [[ "${code}" != "200" ]]; then
  echo "  FAIL: expected HTTP 200"
  failed=$((failed + 1))
else
  # JSON should mention presentation keys (camelCase from serde rename_all)
  if ! grep -qE 'heroAssetId|presentation|backgroundSource' /tmp/hero_presentation_get.json; then
    echo "  FAIL: body missing expected presentation fields"
    failed=$((failed + 1))
  else
    echo "  OK: presentation JSON shape"
  fi
fi
echo

# --- GET trailing slash (alias; may need latest deploy) ---------------------
code_slash=$(curl -sS \
  -o /tmp/hero_presentation_get_slash.json \
  -w "%{http_code}" \
  "${PATH_SLASH}")
echo "GET ${PATH_SLASH} → HTTP ${code_slash}"
if [[ "${code_slash}" != "200" ]]; then
  echo "  WARN: trailing-slash GET is not 200 (optional alias; redeploy if needed)"
else
  echo "  OK"
fi
echo

# --- PUT without auth → 401 -------------------------------------------------
code_put=$(curl -sS \
  -o /tmp/hero_presentation_put.json \
  -w "%{http_code}" \
  -X PUT \
  "${PATH_CANON}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"heroTitle":"auth-probe"}')
put_body=$(head -c 200 /tmp/hero_presentation_put.json || true)
echo "PUT (no auth) ${PATH_CANON} → HTTP ${code_put}"
echo "  body: ${put_body}"
if [[ "${code_put}" != "401" ]]; then
  echo "  FAIL: expected HTTP 401 missing_authorization / invalid_session"
  failed=$((failed + 1))
else
  echo "  OK: admin auth enforced"
fi
echo

# --- Distinguish platform hero (often 404 when flag off) --------------------
code_plat=$(curl -sS \
  -o /tmp/platform_hero.json \
  -w "%{http_code}" \
  "${PATH_PLATFORM}")
echo "GET ${PATH_PLATFORM} → HTTP ${code_plat} (not presentation; often 404 when REELFORGE_PLATFORM_CONFIG=off)"
echo "  note: do not use this as the site hero background endpoint"
echo

# --- curl cheat sheet -------------------------------------------------------
cat <<EOF
curl examples:
  # Public read
  curl -sS "${PATH_CANON}" | jq .

  # Unauthenticated write (expect 401)
  curl -sS -X PUT "${PATH_CANON}" \\
    -H "Content-Type: application/json" \\
    -d '{"heroAssetId":"...","heroTitle":"Vic G LA Story"}'

  # Authenticated write
  curl -sS -X PUT "${PATH_CANON}" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \$ADMIN_TOKEN" \\
    -d '{"heroAssetId":"3894107e-ae44-43c5-af72-b3f5d5e0ad90","heroTitle":"Vic G LA Story","backgroundSource":"custom_video","presentation":{}}'
EOF

if [[ "${failed}" -eq 0 ]]; then
  echo
  echo "✓ hero presentation API validation passed"
  exit 0
fi
echo
echo "✗ hero presentation API validation failed (${failed} check(s))"
exit 1
