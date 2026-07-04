#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
LOG_FILE="${LOG_FILE:-backend/logs/backend-restart.log}"
START_CMD="${START_CMD:-cargo run --manifest-path backend/Cargo.toml}"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

echo "== ReelForge backend recovery =="
echo "port=$PORT health=$HEALTH_PATH"

discover_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    return
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$PORT" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/' | sed '/^$/d' || true
    return
  fi
}

wait_for_release() {
  local attempts=20
  while [[ $attempts -gt 0 ]]; do
    if [[ -z "$(discover_pids)" ]]; then
      return 0
    fi
    sleep 0.5
    attempts=$((attempts - 1))
  done
  return 1
}

terminate_port_holders() {
  local pids
  pids="$(discover_pids | sort -u)"
  if [[ -z "$pids" ]]; then
    echo "No listener on port $PORT"
    return 0
  fi

  echo "Found listener PID(s): $pids"
  echo "Sending SIGTERM..."
  while read -r pid; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"

  if wait_for_release; then
    echo "Port $PORT released after SIGTERM"
    return 0
  fi

  echo "Still busy; sending SIGKILL..."
  while read -r pid; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done <<< "$pids"

  if ! wait_for_release; then
    echo "ERROR: failed to release port $PORT"
    exit 1
  fi
  echo "Port $PORT released after SIGKILL"
}

start_backend() {
  echo "Starting backend: $START_CMD"
  nohup bash -lc "$START_CMD" >> "$LOG_FILE" 2>&1 &
  BACKEND_PID=$!
  echo "Started backend PID $BACKEND_PID (logs: $LOG_FILE)"
}

wait_for_health() {
  local attempts=30
  while [[ $attempts -gt 0 ]]; do
    if curl -fsS "http://127.0.0.1:${PORT}${HEALTH_PATH}" >/dev/null 2>&1; then
      echo "Health check OK: http://127.0.0.1:${PORT}${HEALTH_PATH}"
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  echo "ERROR: backend did not become healthy in time"
  return 1
}

terminate_port_holders
start_backend
wait_for_health
echo "Recovery complete."
