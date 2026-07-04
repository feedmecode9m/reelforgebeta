#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FORCE_RESTART="${FORCE_RESTART:-0}"
AUTO_START_DB="${AUTO_START_DB:-1}"
BACKEND_START_TIMEOUT_SEC="${BACKEND_START_TIMEOUT_SEC:-180}"
START_DEV_LOCKFILE="${START_DEV_LOCKFILE:-/tmp/reelforge-start-dev.lock}"
START_DEV_LOG_DIR="${START_DEV_LOG_DIR:-$PROJECT_ROOT/.dev-logs}"
LOG_STAMP="$(date +%Y%m%d-%H%M%S)"
BACKEND_LOG_FILE="$START_DEV_LOG_DIR/backend-$LOG_STAMP.log"
BACKEND_LOG_LINK="$START_DEV_LOG_DIR/backend-latest.log"
FRONTEND_LOG_FILE="$START_DEV_LOG_DIR/frontend-$LOG_STAMP.log"
FRONTEND_LOG_LINK="$START_DEV_LOG_DIR/frontend-latest.log"
STARTED_BACKEND=0
FRONTEND_PID=""

if command -v flock >/dev/null 2>&1; then
  exec 9>"$START_DEV_LOCKFILE"
  if ! flock -n 9; then
    echo "Another start-dev.sh instance is already running."
    echo "Wait for it to finish or stop it, then retry."
    exit 1
  fi
fi

run_as_dev_user_bg() {
  local command="$1"
  if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
    sudo -u "$SUDO_USER" -H bash -lc "$command" &
  else
    bash -lc "$command" &
  fi
}

run_as_dev_user() {
  local command="$1"
  if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
    sudo -u "$SUDO_USER" -H bash -lc "$command"
  else
    bash -lc "$command"
  fi
}

kill_port() {
  local port="$1"
  if fuser -n tcp "$port" >/dev/null 2>&1; then
    echo "Port $port is in use. Releasing..."
    # Kill any process bound to this port so the dev stack can start cleanly.
    fuser -k -n tcp "$port" >/dev/null 2>&1 || true
    sleep 1
  fi
}

port_in_use() {
  local port="$1"
  fuser -n tcp "$port" >/dev/null 2>&1
}

port_pids() {
  local port="$1"
  fuser -n tcp "$port" 2>/dev/null | tr -cs '0-9' ' ' | xargs -n1 echo 2>/dev/null || true
}

db_ready() {
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h localhost -p 5432 -U user -d reelforge >/dev/null 2>&1
    return $?
  fi

  if command -v docker >/dev/null 2>&1; then
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db pg_isready -U user -d reelforge >/dev/null 2>&1
    return $?
  fi

  return 1
}

ensure_database_ready() {
  if db_ready; then
    return 0
  fi

  if [[ "$AUTO_START_DB" != "1" ]]; then
    echo "Database is not ready (localhost:5432), and AUTO_START_DB=0."
    echo "Start Postgres first, then re-run start-dev.sh."
    exit 1
  fi

  if [[ ! -x "$BACKEND_DIR/scripts/start-db.sh" ]]; then
    echo "Database is not ready and missing helper script: $BACKEND_DIR/scripts/start-db.sh"
    exit 1
  fi

  echo "Database not ready. Attempting auto-start via backend/scripts/start-db.sh..."
  "$BACKEND_DIR/scripts/start-db.sh"

  if ! db_ready; then
    echo "Database failed readiness check after auto-start attempt."
    exit 1
  fi
}

backend_healthy() {
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1
}

frontend_healthy() {
  curl -fsS "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1
}

wait_for_backend_ready() {
  local timeout="$1"
  local elapsed=0
  while (( elapsed < timeout )); do
    if [[ -n "${BACKEND_PID:-}" ]] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      echo "Backend exited during startup."
      return 1
    fi
    if backend_healthy; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Backend did not become healthy within ${timeout}s."
  return 1
}

is_reelforge_backend_pid() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmd" == *"/projects/reelforge/"* ]] && [[ "$cmd" == *"target/debug/backend"* ]]
}

is_reelforge_frontend_pid() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmd" == *"/projects/reelforge/frontend"* ]] && [[ "$cmd" == *"vite"* ]]
}

assert_port_usable_or_expected() {
  local port="$1"
  local service="$2"
  local checker="$3"
  local pids
  pids="$(port_pids "$port")"
  [[ -z "$pids" ]] && return 0
  for pid in $pids; do
    if ! "$checker" "$pid"; then
      local cmd
      cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      echo "Port $port is occupied by non-$service process (pid $pid): $cmd"
      echo "Use FORCE_RESTART=1 to reclaim the port, or stop that process manually."
      exit 1
    fi
  done
}

has_reelforge_backend_on_port() {
  local pids
  pids="$(port_pids "$BACKEND_PORT")"
  [[ -z "$pids" ]] && return 1
  for pid in $pids; do
    if is_reelforge_backend_pid "$pid"; then
      return 0
    fi
  done
  return 1
}

has_reelforge_frontend_on_port() {
  local pids
  pids="$(port_pids "$FRONTEND_PORT")"
  [[ -z "$pids" ]] && return 1
  for pid in $pids; do
    if is_reelforge_frontend_pid "$pid"; then
      return 0
    fi
  done
  return 1
}

cleanup_on_signal() {
  echo
  echo "Received interrupt. Cleaning up..."

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    pkill -TERM -P "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$STARTED_BACKEND" == "1" ]]; then
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      echo "Stopping backend launcher (pid $BACKEND_PID)..."
      kill "$BACKEND_PID" >/dev/null 2>&1 || true
      pkill -TERM -P "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
    # Ensure compiled backend child process is also terminated.
    pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
  fi
  exit 130
}
trap cleanup_on_signal INT TERM

run_as_dev_user "mkdir -p \"$START_DEV_LOG_DIR\""
run_as_dev_user ": > \"$BACKEND_LOG_FILE\""
run_as_dev_user "ln -sfn \"$BACKEND_LOG_FILE\" \"$BACKEND_LOG_LINK\""
run_as_dev_user ": > \"$FRONTEND_LOG_FILE\""
run_as_dev_user "ln -sfn \"$FRONTEND_LOG_FILE\" \"$FRONTEND_LOG_LINK\""
echo "Backend log file: $BACKEND_LOG_FILE"
echo "Backend log tail: tail -f \"$BACKEND_LOG_LINK\""
echo "Frontend log file: $FRONTEND_LOG_FILE"
echo "Frontend log tail: tail -f \"$FRONTEND_LOG_LINK\""

if [[ "$FORCE_RESTART" == "1" ]]; then
  echo "Force restart enabled. Releasing occupied ports..."
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  echo "Stopping old backend processes..."
  pkill -f "target/debug/backend" >/dev/null 2>&1 || true
  pkill -f "cargo run" >/dev/null 2>&1 || true
fi

assert_port_usable_or_expected "$BACKEND_PORT" "backend" is_reelforge_backend_pid
assert_port_usable_or_expected "$FRONTEND_PORT" "frontend" is_reelforge_frontend_pid

ensure_database_ready

if port_in_use "$BACKEND_PORT"; then
  if backend_healthy; then
    echo "Backend already running on :$BACKEND_PORT. Skipping backend launch."
  elif has_reelforge_backend_on_port; then
    echo "Backend process on :$BACKEND_PORT is stale/unhealthy. Recycling..."
    kill_port "$BACKEND_PORT"
    echo "Starting backend on :$BACKEND_PORT..."
    run_as_dev_user "printf '\n[start-dev] %s restarting backend on :%s\n' \"\$(date -Is)\" \"$BACKEND_PORT\" >> \"$BACKEND_LOG_FILE\""
    run_as_dev_user_bg "cd \"$BACKEND_DIR\" && cargo run >> \"$BACKEND_LOG_FILE\" 2>&1"
    BACKEND_PID=$!
    STARTED_BACKEND=1
    if ! wait_for_backend_ready "$BACKEND_START_TIMEOUT_SEC"; then
      if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
        pkill -TERM -P "$BACKEND_PID" >/dev/null 2>&1 || true
      fi
      pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
      exit 1
    fi
  else
    echo "Port :$BACKEND_PORT is occupied but backend health check failed."
    echo "Use FORCE_RESTART=1 to reclaim the port."
    exit 1
  fi
else
  echo "Starting backend on :$BACKEND_PORT..."
  run_as_dev_user "printf '\n[start-dev] %s launching backend on :%s\n' \"\$(date -Is)\" \"$BACKEND_PORT\" >> \"$BACKEND_LOG_FILE\""
  run_as_dev_user_bg "cd \"$BACKEND_DIR\" && cargo run >> \"$BACKEND_LOG_FILE\" 2>&1"
  BACKEND_PID=$!
  STARTED_BACKEND=1
  if ! wait_for_backend_ready "$BACKEND_START_TIMEOUT_SEC"; then
    # Handle bind/startup race: another valid ReelForge backend may have bound :8080.
    if port_in_use "$BACKEND_PORT" && has_reelforge_backend_on_port && backend_healthy; then
      echo "Backend became available on :$BACKEND_PORT from another process. Handing off."
      STARTED_BACKEND=0
      BACKEND_PID=""
    else
      if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
        pkill -TERM -P "$BACKEND_PID" >/dev/null 2>&1 || true
      fi
      pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
      exit 1
    fi
  fi
fi

if port_in_use "$FRONTEND_PORT"; then
  if frontend_healthy; then
    echo "Frontend already running on :$FRONTEND_PORT. Skipping frontend launch."
    exit 0
  fi
  if has_reelforge_frontend_on_port; then
    echo "Frontend process on :$FRONTEND_PORT is stale/unhealthy. Recycling..."
    kill_port "$FRONTEND_PORT"
  else
    echo "Port :$FRONTEND_PORT is occupied but frontend health check failed."
    echo "Use FORCE_RESTART=1 to reclaim the port."
    exit 1
  fi
fi

echo "Starting frontend on :$FRONTEND_PORT..."
set +e
run_as_dev_user "printf '\n[start-dev] %s launching frontend on :%s\n' \"\$(date -Is)\" \"$FRONTEND_PORT\" >> \"$FRONTEND_LOG_FILE\""
run_as_dev_user_bg "cd \"$FRONTEND_DIR\" && npm run dev -- --port \"$FRONTEND_PORT\" --strictPort >> \"$FRONTEND_LOG_FILE\" 2>&1"
FRONTEND_PID=$!
wait "$FRONTEND_PID"
FRONTEND_EXIT_CODE=$?
set -e

# Handle a bind race where another frontend grabbed the port after preflight checks.
if [[ "$FRONTEND_EXIT_CODE" -ne 0 ]] && port_in_use "$FRONTEND_PORT"; then
  for pid in $(port_pids "$FRONTEND_PORT"); do
    if is_reelforge_frontend_pid "$pid"; then
      echo "Frontend became available on :$FRONTEND_PORT (pid $pid). Handing off."
      exit 0
    fi
  done
fi

exit "$FRONTEND_EXIT_CODE"
