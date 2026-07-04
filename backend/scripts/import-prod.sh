#!/usr/bin/env bash
# Import ReelForge export bundle into production Postgres + media volume.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <export-dir> [pg_restore options...]"
  echo "  export-dir must contain reelforge_*.dump, videos/, thumbs/"
  exit 1
fi

EXPORT_DIR="$1"
shift

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-user}"
PGDATABASE="${PGDATABASE:-reelforge}"
MEDIA_ROOT="${MEDIA_ROOT:-/var/lib/reelforge/public}"

DUMP="$(ls -t "$EXPORT_DIR"/reelforge_*.dump 2>/dev/null | head -1)"
if [[ -z "$DUMP" ]]; then
  echo "No reelforge_*.dump found in $EXPORT_DIR"
  exit 1
fi

echo "==> Restoring database from $DUMP"
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" --clean --if-exists "$DUMP" "$@"

mkdir -p "$MEDIA_ROOT/videos" "$MEDIA_ROOT/thumbs"
echo "==> Syncing media to $MEDIA_ROOT"
rsync -a "$EXPORT_DIR/videos/" "$MEDIA_ROOT/videos/"
rsync -a "$EXPORT_DIR/thumbs/" "$MEDIA_ROOT/thumbs/"

echo "==> Running integrity check"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGDATABASE="$PGDATABASE" \
  MEDIA_ROOT="$MEDIA_ROOT" bash "$SCRIPT_DIR/verify-media-integrity.sh"

echo "==> Import complete. Start backend with MEDIA_PUBLIC_BASE set to your public URL."
