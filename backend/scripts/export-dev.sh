#!/usr/bin/env bash
# Export ReelForge dev database + media for production migration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPORT_DIR="${EXPORT_DIR:-$ROOT/export}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="${DUMP_FILE:-$EXPORT_DIR/reelforge_${STAMP}.dump}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-user}"
PGDATABASE="${PGDATABASE:-reelforge}"

mkdir -p "$EXPORT_DIR/videos" "$EXPORT_DIR/thumbs"

echo "==> Dumping Postgres ($PGDATABASE) to $DUMP_FILE"
pg_dump -Fc -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f "$DUMP_FILE"

echo "==> Syncing media from $ROOT/backend/public"
rsync -a --delete "$ROOT/backend/public/videos/" "$EXPORT_DIR/videos/"
rsync -a --delete "$ROOT/backend/public/thumbs/" "$EXPORT_DIR/thumbs/"

echo "==> Writing manifests"
find "$EXPORT_DIR/videos" -type f | sort > "$EXPORT_DIR/videos.manifest"
find "$EXPORT_DIR/thumbs" -type f | sort > "$EXPORT_DIR/thumbs.manifest"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -F $'\t' -c \
  "SELECT id::text, file_name, video_url, thumbnail_url, status FROM reels ORDER BY created_at;" \
  > "$EXPORT_DIR/db-media-index.tsv"

if [[ -f "$ROOT/backend/src/data/reels.json" ]]; then
  mv "$ROOT/backend/src/data/reels.json" "$ROOT/backend/src/data/reels.json.bak.${STAMP}" 2>/dev/null || true
  echo "==> Archived reels.json to reels.json.bak.${STAMP}"
fi

echo "==> Export complete: $EXPORT_DIR"
echo "    dump: $DUMP_FILE"
