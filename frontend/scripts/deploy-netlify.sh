#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SITE="${NETLIFY_SITE_NAME:-hilarious-licorice-66808a}"
MESSAGE="${1:-ReelForge production deploy}"

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: NETLIFY_AUTH_TOKEN is not set."
  echo "Generate one at: https://app.netlify.com/user/applications#personal-access-tokens"
  echo "Then run:"
  echo "  export NETLIFY_AUTH_TOKEN='your-token'"
  echo "  npm run build"
  echo "  netlify deploy --prod --dir=dist --site=${SITE} --message=\"${MESSAGE}\""
  exit 1
fi

npm run build
netlify deploy --prod --dir=dist --site="${SITE}" --message="${MESSAGE}"

echo "Deployed to site: ${SITE}"
echo "Live URL: https://${SITE}.netlify.app/"
