#!/usr/bin/env bash
# Import on-disk videos into Postgres + enqueue ffmpeg thumbnail jobs.
set -euo pipefail
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
BACKEND="${BACKEND:-http://localhost:8080}"
curl -sS -X POST "${BACKEND}/api/admin/migrate-media" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${ADMIN_PASSWORD}\"}" | jq .
