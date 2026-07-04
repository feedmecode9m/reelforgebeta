#!/usr/bin/env bash
# Smoke-test a deployed ReelForge instance.
set -euo pipefail

BACKEND="${BACKEND:-http://localhost:8080}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "OK: $*"; }

echo "==> GET /health"
HEALTH=$(curl -sf "$BACKEND/health") || fail "health unreachable"
echo "$HEALTH" | grep -q '"database":"connected"' || fail "database not connected"
echo "$HEALTH" | grep -q 'postgres-ingestion-v2' || fail "expected postgres-ingestion-v2"
ok "health"

echo "==> GET /api/sync"
SYNC=$(curl -sf "$BACKEND/api/sync") || fail "sync unreachable"
echo "$SYNC" | grep -q '"database":"connected"' || fail "sync database"
ok "sync"

echo "==> GET /api/reels"
REELS=$(curl -sf "$BACKEND/api/reels") || fail "reels unreachable"
if echo "$REELS" | grep -q 'localhost:5173'; then
  fail "reels contain vite origin"
fi
if [[ "$REELS" != "[]" ]]; then
  echo "$REELS" | grep -q 'http' || fail "reels URLs should be absolute when MEDIA_PUBLIC_BASE is set"
  echo "$REELS" | grep -q 'thumbnailUrl' || fail "reels missing thumbnailUrl"
fi
ok "reels ($(echo "$REELS" | jq -r 'length' 2>/dev/null || echo '?') items)"

echo "==> Sample media HEAD (first reel)"
URL=$(echo "$REELS" | jq -r '.[0].url // empty' 2>/dev/null || true)
THUMB=$(echo "$REELS" | jq -r '.[0].thumbnailUrl // empty' 2>/dev/null || true)
if [[ -n "$URL" ]]; then
  curl -sfI "$URL" >/dev/null || fail "video URL not reachable: $URL"
  ok "video $URL"
fi
if [[ -n "$THUMB" ]]; then
  curl -sfI "$THUMB" >/dev/null || fail "thumb URL not reachable: $THUMB"
  ok "thumb $THUMB"
fi

echo "==> Logs must not mention JSON fallback (manual check on server)"
ok "post-deploy verify complete"
