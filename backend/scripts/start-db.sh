#!/usr/bin/env bash
# Start Postgres for local ReelForge dev (Docker preferred, native fallback).
set -euo pipefail

# scripts/ -> backend/ -> reelforge/
REELFORGE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$REELFORGE_ROOT/docker-compose.yml"

wait_for_postgres() {
  echo "Waiting for Postgres on localhost:5432..."
  for _ in $(seq 1 45); do
    if command -v pg_isready >/dev/null 2>&1 \
      && pg_isready -h localhost -p 5432 -U user -d reelforge 2>/dev/null; then
      echo "✅ Postgres ready"
      return 0
    fi
    if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U user -d reelforge 2>/dev/null; then
      echo "✅ Postgres ready (docker)"
      return 0
    fi
    sleep 1
  done
  echo "❌ Postgres did not become ready in time"
  return 1
}

docker_permission_ok() {
  docker info >/dev/null 2>&1
}

start_docker_db() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "❌ Missing $COMPOSE_FILE"
    return 1
  fi
  cd "$REELFORGE_ROOT"
  if docker_permission_ok; then
    docker compose up -d db
    wait_for_postgres
    return $?
  fi
  if command -v sudo >/dev/null 2>&1; then
    echo "Docker socket not accessible — trying: sudo docker compose up -d db"
    sudo docker compose up -d db
    wait_for_postgres
    return $?
  fi
  return 1
}

print_help() {
  cat <<EOF
❌ Could not start Postgres via Docker.

Your error is usually one of:
  • Docker not running: start Docker Desktop / systemctl start docker
  • Permission denied on /var/run/docker.sock

Fix Docker access (pick one):
  sudo usermod -aG docker "\$USER"
  # then log out and back in, OR:
  newgrp docker

  # one-off:
  cd ~/projects/reelforge
  sudo docker compose up -d db

Then:
  cd ~/projects/reelforge/backend && cargo run

--- OR use native Postgres (no Docker) ---

  sudo apt install postgresql postgresql-contrib
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE USER "user" WITH PASSWORD 'password' CREATEDB;
CREATE DATABASE reelforge OWNER "user";
SQL

  cd ~/projects/reelforge/backend && cargo run

DATABASE_URL (backend/.env):
  postgres://user:password@localhost:5432/reelforge

Important: run commands separately (do not paste the arrow "→"):
  docker compose up -d db
  cargo run
EOF
}

if command -v pg_isready >/dev/null 2>&1 \
  && pg_isready -h localhost -p 5432 -U user -d reelforge 2>/dev/null; then
  echo "✅ Postgres already running on localhost:5432"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  echo "Starting Postgres via docker compose..."
  if start_docker_db; then
    exit 0
  fi
  print_help
  exit 1
fi

print_help
exit 1
