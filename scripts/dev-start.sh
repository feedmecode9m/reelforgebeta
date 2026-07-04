#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
TARGET_DIR="$BACKEND_DIR/target"
PORT_START=8080
PORT_END=8090

resolve_target_owner_ids() {
    if [[ -n "${SUDO_USER:-}" ]]; then
        echo "$(id -u "$SUDO_USER"):$(id -g "$SUDO_USER")"
        return
    fi

    if [[ "$EUID" -eq 0 ]]; then
        echo "$(stat -c '%u:%g' "$BACKEND_DIR")"
        return
    fi

    echo "$(id -u):$(id -g)"
}

fix_target_ownership() {
    if [[ ! -e "$TARGET_DIR" ]]; then
        return 0
    fi

    local owner_ids current_uid target_uid
    owner_ids="$(resolve_target_owner_ids)"
    current_uid="${owner_ids%%:*}"
    target_uid="$(stat -c '%u' "$TARGET_DIR")"

    if [[ "$target_uid" == "$current_uid" ]]; then
        return 0
    fi

    echo "⚠️  $TARGET_DIR is owned by uid $target_uid (expected $current_uid); fixing ownership..."

    if [[ "$EUID" -eq 0 ]]; then
        chown -R "$owner_ids" "$TARGET_DIR"
    elif command -v sudo >/dev/null 2>&1; then
        sudo chown -R "$owner_ids" "$TARGET_DIR"
    else
        echo "❌ Cannot fix ownership without sudo."
        echo "   Run: sudo chown -R \"\$(id -u):\$(id -g)\" \"$TARGET_DIR\""
        exit 1
    fi

    echo "✅ Fixed ownership of $TARGET_DIR"
}

port_in_use() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"
        return $?
    fi

    (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null
}

find_free_port() {
    local port
    for port in $(seq "$PORT_START" "$PORT_END"); do
        if ! port_in_use "$port"; then
            echo "$port"
            return 0
        fi
    done

    echo "❌ No free port found in range ${PORT_START}-${PORT_END}" >&2
    exit 1
}

ensure_cargo() {
    if command -v cargo >/dev/null 2>&1; then
        return 0
    fi

    if [[ -f "$HOME/.cargo/env" ]]; then
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env"
    fi

    if ! command -v cargo >/dev/null 2>&1; then
        echo "❌ cargo not found. Install Rust from https://rustup.rs/" >&2
        exit 1
    fi
}

ensure_postgres() {
    if command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 5432 -U user -d reelforge 2>/dev/null; then
        echo "✅ Postgres already running"
        return 0
    fi

    if command -v docker >/dev/null 2>&1; then
        echo "📦 Starting Postgres (docker compose)..."
        (cd "$ROOT_DIR" && docker compose up -d db)
        for _ in $(seq 1 30); do
            if pg_isready -h localhost -p 5432 2>/dev/null; then
                echo "✅ Postgres ready on :5432"
                return 0
            fi
            sleep 1
        done
    fi

    echo "❌ Postgres is not running on localhost:5432"
    echo "   Run: ~/projects/reelforge/backend/scripts/start-db.sh"
    echo "   Or:  cd ~/projects/reelforge && docker compose up -d db"
    exit 1
}

main() {
    ensure_cargo
    fix_target_ownership
    ensure_postgres

    local port
    port="$(find_free_port)"

    export RUST_LOG="${RUST_LOG:-debug}"
    export PORT="$port"

    echo "🚀 Starting ReelForge backend on http://127.0.0.1:${PORT}"
    echo "   RUST_LOG=${RUST_LOG}"

    cd "$BACKEND_DIR"
    exec cargo run
}

main "$@"
