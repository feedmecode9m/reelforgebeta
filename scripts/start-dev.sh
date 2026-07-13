#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# === Configuration ===
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FORCE_RESTART="${FORCE_RESTART:-0}"
AUTO_START_DB="${AUTO_START_DB:-1}"
BACKEND_START_TIMEOUT_SEC="${BACKEND_START_TIMEOUT_SEC:-180}"
DB_RETRY_INTERVAL="${DB_RETRY_INTERVAL:-2}"
DB_MAX_RETRIES="${DB_MAX_RETRIES:-30}"
HEALTHCHECK_INTERVAL="${HEALTHCHECK_INTERVAL:-1}"
START_DEV_LOCKFILE="${START_DEV_LOCKFILE:-/tmp/reelforge-start-dev.lock}"
START_DEV_LOG_DIR="${START_DEV_LOG_DIR:-$PROJECT_ROOT/.dev-logs}"
LOG_STAMP="$(date +%Y%m%d-%H%M%S)"
BACKEND_LOG_FILE="$START_DEV_LOG_DIR/backend-$LOG_STAMP.log"
BACKEND_LOG_LINK="$START_DEV_LOG_DIR/backend-latest.log"
FRONTEND_LOG_FILE="$START_DEV_LOG_DIR/frontend-$LOG_STAMP.log"
FRONTEND_LOG_LINK="$START_DEV_LOG_DIR/frontend-latest.log"
STARTED_BACKEND=0
FRONTEND_PID=""
BACKEND_PID=""

# === Development Environment Setup ===
export REELFORGE_ENV="development"
export RUST_LOG="${RUST_LOG:-reelforge=debug,actix_web=info}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT}"
export DATABASE_URL="${DATABASE_URL:-postgresql://user:password@localhost:5432/reelforge}"

# === Helper Functions ===
log_info() { echo "ℹ️  $*"; }
log_warn() { echo "⚠️  $*" >&2; }
log_error() { echo "❌ $*" >&2; }

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
  kill_listeners_on_port "$port"
}

kill_listeners_on_port() {
  local port="$1"
  local pid cmd
  local pids
  pids="$(listeners_on_port "$port")"
  [[ -z "$pids" ]] && return 0

  log_warn "Port $port is in use. Releasing..."
  for pid in $pids; do
    cmd="$(ps -p "$pid" -o user=,args= 2>/dev/null || true)"
    log_warn "  → pid $pid ($cmd)"
    if kill -TERM "$pid" >/dev/null 2>&1; then
      continue
    fi
    if [[ "$(id -u)" -eq 0 ]]; then
      kill -9 "$pid" >/dev/null 2>&1 || true
      continue
    fi
    if command -v sudo >/dev/null 2>&1 && sudo -n kill -TERM "$pid" >/dev/null 2>&1; then
      continue
    fi
    log_error "Cannot stop pid $pid on :$port (owned by another user). Run: sudo kill $pid"
    return 1
  done

  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || sudo -n kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
  sleep 1
}

listeners_on_port() {
  local port="$1"
  local pids=""

  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "( sport = :$port )" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 \
      | sort -u \
      | tr '\n' ' ')"
  fi

  if [[ -z "${pids//[[:space:]]/}" ]] && command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  fi

  if [[ -z "${pids//[[:space:]]/}" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$port" 2>/dev/null | tr -cs '0-9' ' ' | xargs -n1 echo 2>/dev/null || true)"
  fi

  echo "$pids" | xargs -n1 echo 2>/dev/null | sort -u | tr '\n' ' '
}

port_in_use() {
  local port="$1"
  local pids
  pids="$(listeners_on_port "$port")"
  pids="${pids//[[:space:]]/}"
  [[ -n "$pids" ]]
}

port_pids() {
  listeners_on_port "$1"
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  local attempt=1
  local max_attempts=5

  while (( attempt <= max_attempts )); do
    if ! port_in_use "$port"; then
      return 0
    fi
    if ! kill_listeners_on_port "$port"; then
      return 1
    fi
    sleep 1
    ((attempt++))
  done

  if port_in_use "$port"; then
    log_error "Port :$port still in use after cleanup ($label)"
    local pid
    for pid in $(listeners_on_port "$port"); do
      ps -p "$pid" -o user=,pid=,args= 2>/dev/null || true
    done
    return 1
  fi
  return 0
}

backend_healthy() {
  curl -fsS --max-time 5 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1
}

frontend_healthy() {
  curl -fsS --max-time 5 "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1
}

dev_stack_healthy() {
  backend_healthy && frontend_healthy
}

print_ready_message() {
  log_info "🎉 Development environment ready!"
  log_info "   → http://127.0.0.1:$FRONTEND_PORT"
  log_info "   Backend health: http://127.0.0.1:$BACKEND_PORT/health"
}

warn_if_running_as_root() {
  if [[ "$(id -u)" -eq 0 && -z "${SUDO_USER:-}" ]]; then
    log_warn "Running as root without SUDO_USER — cargo/vite may create root-owned artifacts."
    log_warn "Run as your normal user instead: FORCE_RESTART=1 ~/projects/reelforge/scripts/start-dev.sh"
  fi
}

stop_other_start_dev_instances() {
  local pid cmd
  for pid in $(pgrep -x bash 2>/dev/null || true); do
    [[ "$pid" == "$$" ]] && continue
    cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    [[ "$cmd" == *"$PROJECT_ROOT/scripts/start-dev.sh"* ]] || continue
    log_warn "Stopping prior start-dev.sh instance (pid $pid)..."
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
}

acquire_start_dev_lock() {
  if ! command -v flock >/dev/null 2>&1; then
    return 0
  fi

  exec 9>"$START_DEV_LOCKFILE"
  if flock -n 9; then
    return 0
  fi

  if [[ "$FORCE_RESTART" == "1" ]]; then
    log_warn "Force restart enabled — reclaiming start-dev lock..."
    stop_other_start_dev_instances
    ensure_port_free "$BACKEND_PORT" "backend" || true
    ensure_port_free "$FRONTEND_PORT" "frontend" || true
    pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
    pkill -f "cargo run" >/dev/null 2>&1 || true
    pkill -f "$PROJECT_ROOT/frontend/node_modules/.bin/vite" >/dev/null 2>&1 || true
    sleep 2
    flock -u 9 2>/dev/null || true
    exec 9>"$START_DEV_LOCKFILE"
    if flock -n 9; then
      return 0
    fi
  fi

  if dev_stack_healthy; then
    log_info "✅ Dev stack already running (another start-dev.sh holds the lock)."
    print_ready_message
    exit 0
  fi

  log_error "Another start-dev.sh instance is already running."
  log_error "Wait for it to finish, use FORCE_RESTART=1, or stop it manually."
  exit 1
}

# === Database Readiness with Exponential Backoff ===
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
    log_info "✅ Database is ready"
    return 0
  fi

  if [[ "$AUTO_START_DB" != "1" ]]; then
    log_error "Database not ready and AUTO_START_DB=0"
    exit 1
  fi

  if [[ ! -x "$BACKEND_DIR/scripts/start-db.sh" ]]; then
    log_error "Missing helper script: $BACKEND_DIR/scripts/start-db.sh"
    exit 1
  fi

  log_info "🔄 Database not ready. Starting via start-db.sh..."
  "$BACKEND_DIR/scripts/start-db.sh"

  local attempt=1
  while (( attempt <= DB_MAX_RETRIES )); do
    if db_ready; then
      log_info "✅ Database ready after $attempt attempt(s)"
      return 0
    fi
    local wait_time=$((DB_RETRY_INTERVAL * attempt))
    log_warn "⏳ Waiting ${wait_time}s for database (attempt $attempt/$DB_MAX_RETRIES)..."
    sleep "$wait_time"
    ((attempt++))
  done

  log_error "❌ Database failed to become ready after $DB_MAX_RETRIES attempts"
  exit 1
}

wait_for_backend_ready() {
  local timeout="$1"
  local elapsed=0
  local last_error=""

  while (( elapsed < timeout )); do
    if [[ -n "${BACKEND_PID:-}" ]] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      if backend_healthy || has_reelforge_backend_on_port; then
        BACKEND_PID=""
        STARTED_BACKEND=0
      else
        log_error "Backend process exited during startup"
        return 1
      fi
    fi

    if backend_healthy; then
      log_info "✅ Backend healthy on :$BACKEND_PORT"
      return 0
    fi

    last_error="Health check pending..."
    sleep "$HEALTHCHECK_INTERVAL"
    elapsed=$((elapsed + HEALTHCHECK_INTERVAL))

    if (( elapsed % 10 == 0 )); then
      log_info "⏳ Backend startup: ${elapsed}s/${timeout}s"
    fi
  done

  log_error "❌ Backend did not become healthy within ${timeout}s"
  log_error "   Last status: $last_error"
  log_error "   Check logs: tail -f \"$BACKEND_LOG_LINK\""
  return 1
}

# === Process Validation ===
is_reelforge_backend_pid() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmd" == *"$PROJECT_ROOT"* ]] && [[ "$cmd" == *"target/debug/backend"* ]]
}

is_reelforge_frontend_pid() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmd" == *"$PROJECT_ROOT/frontend"* ]] && [[ "$cmd" == *"vite"* || "$cmd" == *"npm run dev"* ]]
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
      log_error "Port $port occupied by non-$service process (pid $pid): $cmd"
      log_error "Use FORCE_RESTART=1 to reclaim, or stop that process manually"
      exit 1
    fi
  done
}

has_reelforge_backend_on_port() {
  local pids
  pids="$(port_pids "$BACKEND_PORT")"
  [[ -z "$pids" ]] && return 1
  for pid in $pids; do
    is_reelforge_backend_pid "$pid" && return 0
  done
  return 1
}

has_reelforge_frontend_on_port() {
  local pids
  pids="$(port_pids "$FRONTEND_PORT")"
  [[ -z "$pids" ]] && return 1
  for pid in $pids; do
    is_reelforge_frontend_pid "$pid" && return 0
  done
  return 1
}

cleanup_on_signal() {
  echo
  log_info "🛑 Received interrupt. Cleaning up..."

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    log_info "Stopping frontend (pid $FRONTEND_PID)..."
    kill -TERM "$FRONTEND_PID" >/dev/null 2>&1 || true
    sleep 2
    kill -9 "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$STARTED_BACKEND" == "1" ]]; then
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      log_info "Stopping backend launcher (pid $BACKEND_PID)..."
      kill -TERM "$BACKEND_PID" >/dev/null 2>&1 || true
      sleep 2
      kill -9 "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
    pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
  fi

  flock -u 9 2>/dev/null || true
  exit 130
}
trap cleanup_on_signal INT TERM

# === Main Execution ===
warn_if_running_as_root

if [[ "$FORCE_RESTART" != "1" ]] && dev_stack_healthy; then
  log_info "✅ Dev stack already running."
  print_ready_message
  exit 0
fi

acquire_start_dev_lock

log_info "🚀 Starting ReelForge development environment"
log_info "   Backend: :$BACKEND_PORT | Frontend: :$FRONTEND_PORT"

run_as_dev_user "mkdir -p \"$START_DEV_LOG_DIR\""
run_as_dev_user ": > \"$BACKEND_LOG_FILE\""
run_as_dev_user "ln -sfn \"$BACKEND_LOG_FILE\" \"$BACKEND_LOG_LINK\""
run_as_dev_user ": > \"$FRONTEND_LOG_FILE\""
run_as_dev_user "ln -sfn \"$FRONTEND_LOG_FILE\" \"$FRONTEND_LOG_LINK\""

log_info "📝 Logs:"
log_info "   Backend: tail -f \"$BACKEND_LOG_LINK\""
log_info "   Frontend: tail -f \"$FRONTEND_LOG_LINK\""

if [[ "$FORCE_RESTART" == "1" ]]; then
  log_warn "🔄 Force restart enabled"
  ensure_port_free "$BACKEND_PORT" "backend" || exit 1
  ensure_port_free "$FRONTEND_PORT" "frontend" || exit 1
  pkill -f "$PROJECT_ROOT/target/debug/backend" >/dev/null 2>&1 || true
  pkill -f "cargo run" >/dev/null 2>&1 || true
  pkill -f "$PROJECT_ROOT/frontend/node_modules/.bin/vite" >/dev/null 2>&1 || true
  pkill -f "$PROJECT_ROOT/frontend/node_modules/vite/bin/vite.js" >/dev/null 2>&1 || true
  sleep 1
fi

assert_port_usable_or_expected "$BACKEND_PORT" "backend" is_reelforge_backend_pid
assert_port_usable_or_expected "$FRONTEND_PORT" "frontend" is_reelforge_frontend_pid

ensure_database_ready

# === Start Backend ===
if port_in_use "$BACKEND_PORT"; then
  if backend_healthy; then
    log_info "✅ Backend already running and healthy on :$BACKEND_PORT"
  elif has_reelforge_backend_on_port; then
    log_warn "♻️  Backend on :$BACKEND_PORT is stale. Recycling..."
    ensure_port_free "$BACKEND_PORT" "backend" || exit 1

    log_info "🔧 Starting backend on :$BACKEND_PORT..."
    run_as_dev_user "printf '\n[start-dev] %s restarting backend on :%s\n' \"\$(date -Is)\" \"$BACKEND_PORT\" >> \"$BACKEND_LOG_FILE\""
    run_as_dev_user_bg "cd \"$BACKEND_DIR\" && cargo run >> \"$BACKEND_LOG_FILE\" 2>&1"
    BACKEND_PID=$!
    STARTED_BACKEND=1

    if ! wait_for_backend_ready "$BACKEND_START_TIMEOUT_SEC"; then
      cleanup_on_signal
    fi
  else
    log_error "❌ Port :$BACKEND_PORT occupied but health check failed"
    log_error "   Use FORCE_RESTART=1 to reclaim the port"
    exit 1
  fi
else
  log_info "🔧 Starting backend on :$BACKEND_PORT..."
  run_as_dev_user "printf '\n[start-dev] %s launching backend on :%s\n' \"\$(date -Is)\" \"$BACKEND_PORT\" >> \"$BACKEND_LOG_FILE\""
  run_as_dev_user_bg "cd \"$BACKEND_DIR\" && cargo run >> \"$BACKEND_LOG_FILE\" 2>&1"
  BACKEND_PID=$!
  STARTED_BACKEND=1

  if ! wait_for_backend_ready "$BACKEND_START_TIMEOUT_SEC"; then
    if port_in_use "$BACKEND_PORT" && has_reelforge_backend_on_port && backend_healthy; then
      log_info "✅ Backend available on :$BACKEND_PORT from concurrent process"
      STARTED_BACKEND=0
      BACKEND_PID=""
    else
      cleanup_on_signal
    fi
  fi
fi

# === Start Frontend ===
if port_in_use "$FRONTEND_PORT"; then
  if frontend_healthy; then
    log_info "✅ Frontend already running on :$FRONTEND_PORT"
    print_ready_message
    exit 0
  fi
  if has_reelforge_frontend_on_port; then
    log_warn "♻️  Frontend on :$FRONTEND_PORT is stale. Recycling..."
    ensure_port_free "$FRONTEND_PORT" "frontend" || exit 1
  else
    log_error "❌ Port :$FRONTEND_PORT occupied by a non-ReelForge process"
    for pid in $(listeners_on_port "$FRONTEND_PORT"); do
      ps -p "$pid" -o user=,pid=,args= 2>/dev/null || true
    done
    log_error "   Use FORCE_RESTART=1 to reclaim the port, or stop the process manually"
    exit 1
  fi
fi

ensure_port_free "$FRONTEND_PORT" "frontend" || exit 1

log_info "🔧 Starting frontend on :$FRONTEND_PORT..."
set +e
run_as_dev_user "printf '\n[start-dev] %s launching frontend on :%s\n' \"\$(date -Is)\" \"$FRONTEND_PORT\" >> \"$FRONTEND_LOG_FILE\""
run_as_dev_user_bg "cd \"$FRONTEND_DIR\" && npm run dev -- --port \"$FRONTEND_PORT\" --strictPort --host 127.0.0.1 >> \"$FRONTEND_LOG_FILE\" 2>&1"
FRONTEND_PID=$!
wait "$FRONTEND_PID"
FRONTEND_EXIT_CODE=$?
set -e

if [[ "$FRONTEND_EXIT_CODE" -ne 0 ]] && port_in_use "$FRONTEND_PORT"; then
  for pid in $(port_pids "$FRONTEND_PORT"); do
    if is_reelforge_frontend_pid "$pid"; then
      log_info "✅ Frontend available on :$FRONTEND_PORT (pid $pid)"
      print_ready_message
      exit 0
    fi
  done
fi

if [[ "$FRONTEND_EXIT_CODE" -ne 0 ]]; then
  log_error "❌ Frontend exited with code $FRONTEND_EXIT_CODE"
  log_error "   Check logs: tail -f \"$FRONTEND_LOG_LINK\""
fi

exit "$FRONTEND_EXIT_CODE"
