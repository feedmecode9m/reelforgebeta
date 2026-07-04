#!/usr/bin/env bash
# Verify DB file_name / URLs match on-disk media under MEDIA_ROOT.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-user}"
PGDATABASE="${PGDATABASE:-reelforge}"
MEDIA_ROOT="${MEDIA_ROOT:-./public}"

FAIL=0

check_ready() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -F $'\t' -c \
    "SELECT id::text, file_name, video_url, thumbnail_url FROM reels WHERE status = 'ready';" \
  | while IFS=$'\t' read -r id file_name video_url thumb_url; do
      [[ -z "$id" ]] && continue
      if [[ -n "$file_name" ]]; then
        vpath="$MEDIA_ROOT/videos/$file_name"
        if [[ ! -f "$vpath" ]]; then
          echo "MISSING video: reel=$id file=$vpath"
          FAIL=1
        fi
      fi
      if [[ -n "$thumb_url" ]]; then
        tbase="${thumb_url##*/}"
        tpath="$MEDIA_ROOT/thumbs/$tbase"
        if [[ ! -f "$tpath" ]]; then
          echo "MISSING thumb: reel=$id file=$tpath"
          FAIL=1
        fi
      else
        echo "MISSING thumbnail_url: reel=$id"
        FAIL=1
      fi
    done
}

echo "==> Checking ready reels vs $MEDIA_ROOT"
check_ready

PENDING=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -c \
  "SELECT COUNT(*) FROM reels WHERE status IN ('pending','processing','failed');" | tr -d ' ')
echo "==> Non-ready reels: $PENDING"

if [[ "$FAIL" -ne 0 ]]; then
  echo "==> Integrity check FAILED"
  exit 1
fi
echo "==> Integrity check OK"
