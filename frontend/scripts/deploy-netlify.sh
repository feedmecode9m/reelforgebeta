#!/usr/bin/env bash
# ReelForge — Netlify production deploy (frontend/dist only)
# Routing: dist/_redirects proxies /api, /videos, /thumbs, /health → Railway
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SITE="${NETLIFY_SITE_NAME:-strong-lolly-a9fcb4}"
NETLIFY_SITE_ID="${NETLIFY_SITE_ID:-791fc14c-cee0-4876-986b-a5c455f10d2a}"
MESSAGE="${1:-ReelForge production deploy}"
DEPLOY_URL="https://${SITE}.netlify.app"

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: NETLIFY_AUTH_TOKEN is not set."
  echo "Generate one at: https://app.netlify.com/user/applications#personal-access-tokens"
  echo "Then run:"
  echo "  export NETLIFY_AUTH_TOKEN='your-token'"
  echo "  bash scripts/deploy-netlify.sh \"${MESSAGE}\""
  exit 1
fi

verify_dist_redirects() {
  local rules="${ROOT}/dist/_redirects"
  if [[ ! -f "$rules" ]]; then
    echo "ERROR: dist/_redirects missing — Vite must copy public/_redirects into dist/"
    exit 1
  fi
  grep -qE '^/api/\*' "$rules" || { echo "ERROR: dist/_redirects missing /api/* proxy"; exit 1; }
  grep -qE '^/health' "$rules" || { echo "ERROR: dist/_redirects missing /health proxy"; exit 1; }
  grep -qE '^/\*' "$rules" || { echo "ERROR: dist/_redirects missing SPA fallback"; exit 1; }
  echo "OK: dist/_redirects contains API proxy, /health, and SPA fallback"
}

verify_live_routes() {
  echo "Verifying live routes at ${DEPLOY_URL} ..."
  sleep 3

  local api_status health_status spa_status api_body
  api_status=$(curl -s -o /tmp/reelforge-api-reels.json -w "%{http_code}" "${DEPLOY_URL}/api/reels")
  health_status=$(curl -s -o /dev/null -w "%{http_code}" "${DEPLOY_URL}/health")
  spa_status=$(curl -s -o /dev/null -w "%{http_code}" "${DEPLOY_URL}/deep/client/route")
  api_body=$(head -c 80 /tmp/reelforge-api-reels.json 2>/dev/null || true)

  echo "  GET /api/reels          -> HTTP ${api_status}  body[0:80]=${api_body}"
  echo "  GET /health             -> HTTP ${health_status}"
  echo "  GET /deep/client/route  -> HTTP ${spa_status}"

  if [[ "$api_status" != "200" ]]; then
    echo "FAIL: /api/reels must return 200 (got ${api_status})"
    exit 1
  fi
  if [[ "$api_body" != \[* ]]; then
    echo "FAIL: /api/reels must return JSON array from Railway (got: ${api_body})"
    exit 1
  fi
  if [[ "$health_status" != "200" ]]; then
    echo "FAIL: /health must return 200 (got ${health_status})"
    exit 1
  fi
  if [[ "$spa_status" != "200" ]]; then
    echo "FAIL: SPA fallback must return 200 for deep routes (got ${spa_status})"
    exit 1
  fi
  echo "OK: Netlify routing verification passed"
}

echo "==> Building from ${ROOT} (publish dir: dist/)"
VITE_USE_SAME_ORIGIN_API=true npm run build

verify_dist_redirects

echo "==> Deploying dist/ to Netlify site: ${SITE} (${NETLIFY_SITE_ID})"
netlify deploy --prod --dir=dist --site="${NETLIFY_SITE_ID}" --message="${MESSAGE}"

verify_live_routes

echo ""
echo "Deployed to site: ${SITE} (${NETLIFY_SITE_ID})"
echo "Live URL: ${DEPLOY_URL}"
