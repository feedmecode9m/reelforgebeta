#!/usr/bin/env bash
# Shared CI toolchain diagnostics and lockfile compatibility checks.
# Sourced by ci-depgraph-check.sh and ci-architecture-integrity.sh

# Cargo.lock format v4 requires approximately Cargo 1.78+ (rustup stable).
# System packages (e.g. Ubuntu rustc/cargo 1.75) cannot parse v4.
readonly CI_LOCKFILE_V4_MIN_CARGO_MAJOR=1
readonly CI_LOCKFILE_V4_MIN_CARGO_MINOR=78

ci_print_toolchain_diagnostics() {
  echo "==> Toolchain diagnostics"
  echo "    pwd: $(pwd)"
  echo "    which cargo: $(command -v cargo 2>/dev/null || echo 'not found')"
  if command -v cargo >/dev/null 2>&1; then
    cargo --version 2>&1 | sed 's/^/    /'
  else
    echo "    cargo: not available"
  fi
  echo "    which rustc: $(command -v rustc 2>/dev/null || echo 'not found')"
  if command -v rustc >/dev/null 2>&1; then
    rustc --version 2>&1 | sed 's/^/    /'
  else
    echo "    rustc: not available"
  fi
  if [[ -f "${HOME}/.cargo/env" ]]; then
    echo "    rustup env: ${HOME}/.cargo/env (present)"
  else
    echo "    rustup env: not found"
  fi
  if [[ -f "rust-toolchain.toml" ]]; then
    echo "    rust-toolchain.toml: present (honored only by rustup cargo)"
  fi
  if [[ -f "Cargo.lock" ]]; then
    local lock_ver
    lock_ver="$(grep -m1 '^version = ' Cargo.lock 2>/dev/null || true)"
    echo "    Cargo.lock: ${lock_ver:-unknown}"
  fi
}

ci_activate_rustup_if_present() {
  if [[ -f "${HOME}/.cargo/env" ]]; then
    # shellcheck source=/dev/null
    source "${HOME}/.cargo/env"
  fi
}

ci_cargo_version_tuple() {
  local ver
  ver="$(cargo --version 2>/dev/null | awk '{print $2}' | tr -d '\r')"
  if [[ -z "$ver" ]]; then
    echo "0.0.0"
    return 1
  fi
  echo "$ver"
}

ci_cargo_meets_minimum() {
  local ver major minor rest
  ver="$(ci_cargo_version_tuple)" || return 1
  major="${ver%%.*}"
  rest="${ver#*.}"
  minor="${rest%%.*}"
  if [[ "$major" -gt "$CI_LOCKFILE_V4_MIN_CARGO_MAJOR" ]]; then
    return 0
  fi
  if [[ "$major" -eq "$CI_LOCKFILE_V4_MIN_CARGO_MAJOR" && "$minor" -ge "$CI_LOCKFILE_V4_MIN_CARGO_MINOR" ]]; then
    return 0
  fi
  return 1
}

ci_lockfile_is_v4() {
  [[ -f Cargo.lock ]] && grep -q '^version = 4$' Cargo.lock
}

ci_output_is_toolchain_failure() {
  local output="$1"
  grep -qE 'failed to parse lock file|lock file version 4 requires|requires -Znext-lockfile-bump|error: package .+ requires Rust|edition2024' <<<"$output"
}

ci_try_cargo_metadata() {
  cargo metadata --format-version=1 --quiet 2>&1
}

ci_ensure_working_cargo() {
  local meta_err tried_rustup=0

  try_metadata() {
    meta_err="$(ci_try_cargo_metadata)"
    local status=$?
    if [[ "$status" -eq 0 ]]; then
      return 0
    fi
    if ci_output_is_toolchain_failure "$meta_err"; then
      return 2
    fi
    echo "$meta_err" >&2
    return 1
  }

  if command -v cargo >/dev/null 2>&1; then
    if try_metadata; then
      return 0
    fi
    local meta_code=$?
    if [[ "$meta_code" -eq 2 ]]; then
      tried_rustup=1
    else
      return 1
    fi
  fi

  if [[ "$tried_rustup" -eq 0 ]] && ! command -v cargo >/dev/null 2>&1; then
    tried_rustup=1
  fi

  if [[ "$tried_rustup" -eq 1 ]]; then
    ci_activate_rustup_if_present
    if ! command -v cargo >/dev/null 2>&1; then
      echo "error: cargo not found in PATH (install rustup: https://rustup.rs)" >&2
      return 2
    fi
    if try_metadata; then
      echo "==> Using rustup cargo: $(command -v cargo) ($(ci_cargo_version_tuple))"
      return 0
    fi
    meta_code=$?
    if [[ "$meta_code" -eq 2 ]]; then
      echo "error: Cargo $(ci_cargo_version_tuple) at $(command -v cargo) cannot read Cargo.lock v4 (need >= ${CI_LOCKFILE_V4_MIN_CARGO_MAJOR}.${CI_LOCKFILE_V4_MIN_CARGO_MINOR})" >&2
      echo "hint: rustup update stable && source \"\$HOME/.cargo/env\"" >&2
      echo "hint: see backend/docs/RUST_BUILD.md" >&2
      return 2
    fi
    return 1
  fi

  return 2
}
