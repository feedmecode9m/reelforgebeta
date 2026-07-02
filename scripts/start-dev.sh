#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain is required. Install from https://rustup.rs" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm is required." >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/reelforge}"
export PORT="${PORT:-8080}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:${PORT}}"

echo "Starting backend on http://localhost:${PORT}"
(
  cd "${ROOT_DIR}/backend"
  cargo run
) &
BACKEND_PID=$!

cleanup() {
  kill "${BACKEND_PID}" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

echo "Starting frontend on http://localhost:5173"
(
  cd "${ROOT_DIR}/frontend"
  npm install
  npm run dev
)
