#!/usr/bin/env bash
# ReelForge DGEL — INTERNAL implementation detail.
# Do NOT invoke standalone in CI. Use: ./scripts/ci-architecture-integrity.sh
# This script is called only by the authoritative CI entrypoint (stage 1: DGEL).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=ci-toolchain-lib.sh
source "${ROOT}/scripts/ci-toolchain-lib.sh"

export DEPGRAPH_POLICY_PATH="${DEPGRAPH_POLICY_PATH:-$ROOT/architecture/dependency_policy.toml}"

ci_print_toolchain_diagnostics
echo ""

if ! ci_ensure_working_cargo; then
  echo "==> depgraph-check: TOOLCHAIN_FAILURE (cargo cannot load workspace)"
  exit 10
fi

echo "==> depgraph-check (policy: $DEPGRAPH_POLICY_PATH)"

set +e
depgraph_output="$(cargo run -p depgraph-check --release --quiet 2>&1)"
depgraph_status=$?
set -e

if [[ "$depgraph_status" -ne 0 ]]; then
  if ci_output_is_toolchain_failure "$depgraph_output"; then
    echo "$depgraph_output" >&2
    echo "==> depgraph-check: TOOLCHAIN_FAILURE"
    exit 10
  fi
  echo "$depgraph_output" >&2
  echo "==> depgraph-check: DGEL_POLICY_FAILURE"
  exit 11
fi

if [[ -n "$depgraph_output" ]]; then
  echo "$depgraph_output"
fi

echo "==> depgraph-check OK"
exit 0
