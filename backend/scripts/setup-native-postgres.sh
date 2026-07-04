#!/usr/bin/env bash
# One-time native Postgres setup for ReelForge (no Docker).
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "Installing PostgreSQL..."
  sudo apt update
  sudo apt install -y postgresql postgresql-contrib
fi

sudo systemctl enable postgresql 2>/dev/null || true
sudo systemctl start postgresql 2>/dev/null || sudo service postgresql start

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user') THEN
    CREATE USER "user" WITH PASSWORD 'password' CREATEDB;
  END IF;
END
$$;
SELECT 'CREATE DATABASE reelforge OWNER "user"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'reelforge')\gexec
SQL

echo "✅ Native Postgres ready"
echo "   DATABASE_URL=postgres://user:password@localhost:5432/reelforge"
echo "   cd ~/projects/reelforge/backend && cargo run"
