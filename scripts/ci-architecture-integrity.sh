#!/usr/bin/env bash
# ReelForge — authoritative CI entrypoint (Architecture Operationalization v1.0)
# Immutable pipeline: DGEL → SYSTEM HARDENING → FUSION VALIDATION
# Internal only: scripts/ci-depgraph-check.sh (do not invoke standalone in CI)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=ci-toolchain-lib.sh
source "${ROOT}/scripts/ci-toolchain-lib.sh"

CLASSIFICATION=""
DGEL_OK=0
HARDENING_OK=0
FUSION_OK=0

emit_classification() {
  local class="$1"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ARCHITECTURE INTEGRITY: BLOCKED                             ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  printf "║  Classification: %-43s ║\n" "$class"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  Pipeline stages:                                            ║"
  printf "║    [1] DGEL:                 %s\n" "$( [[ $DGEL_OK -eq 1 ]] && echo PASS || echo FAIL )"
  printf "║    [2] SYSTEM HARDENING:     %s\n" "$( [[ $HARDENING_OK -eq 1 ]] && echo PASS || echo FAIL )"
  printf "║    [3] FUSION VALIDATION:    %s\n" "$( [[ $FUSION_OK -eq 1 ]] && echo PASS || echo FAIL )"
  echo "╠══════════════════════════════════════════════════════════════╣"
  if [[ "$class" == "TOOLCHAIN_FAILURE" ]]; then
    echo "║  Cargo/Rust cannot load workspace (lockfile/toolchain).      ║"
    echo "║  Not a DGEL policy violation — fix rustup / Cargo version.   ║"
  elif [[ "$class" == "DGEL_POLICY_FAILURE" ]]; then
    echo "║  DGEL policy violation — fix dependency_policy / imports.    ║"
  elif [[ "$class" == "STRUCTURAL_BLOCK" ]]; then
    echo "║  DGEL stage failed (unclassified — see logs above).          ║"
  elif [[ "$class" == "SEMANTIC_BLOCK" ]]; then
    echo "║  System hardening violation — restore semantic parity.       ║"
  elif [[ "$class" == "CROSS_LAYER_DRIFT_BLOCK" ]]; then
    echo "║  DGEL and semantic layers disagree — reconcile policy.       ║"
  fi
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
}

fail_with_class() {
  emit_classification "$CLASSIFICATION"
  exit 1
}

classify_hardening_failure() {
  local output="$1"
  if ci_output_is_toolchain_failure "$output"; then
    CLASSIFICATION="TOOLCHAIN_FAILURE"
  else
    CLASSIFICATION="SEMANTIC_BLOCK"
  fi
}

echo "==> Architecture Integrity CI (single entrypoint)"
echo "==> Repository: $ROOT"
echo "==> Pipeline: DGEL → SYSTEM HARDENING → FUSION VALIDATION"
ci_print_toolchain_diagnostics
echo ""

# --- [1/3] DGEL (structural) — internal: ci-depgraph-check.sh ---
echo "==> [1/3] DGEL"
set +e
./scripts/ci-depgraph-check.sh
dgel_status=$?
set -e
if [[ "$dgel_status" -eq 0 ]]; then
  DGEL_OK=1
else
  case "$dgel_status" in
    10) CLASSIFICATION="TOOLCHAIN_FAILURE" ;;
    11) CLASSIFICATION="DGEL_POLICY_FAILURE" ;;
    *) CLASSIFICATION="STRUCTURAL_BLOCK" ;;
  esac
  fail_with_class
fi
echo ""

# Ensure rustup cargo for remaining stages (same lockfile requirement).
if ! ci_ensure_working_cargo; then
  CLASSIFICATION="TOOLCHAIN_FAILURE"
  fail_with_class
fi

# --- [2/3] SYSTEM HARDENING (semantic) ---
echo "==> [2/3] SYSTEM HARDENING"
echo "    [2a] default features"
set +e
hardening_out="$(cargo test -p backend --lib system_hardening --quiet -- --skip test_ci_fusion_consistency 2>&1)"
hardening_status=$?
set -e
if [[ "$hardening_status" -ne 0 ]]; then
  echo "$hardening_out" >&2
  classify_hardening_failure "$hardening_out"
  fail_with_class
fi
echo "    [2b] runtime_asset_mode parity"
set +e
hardening_rt_out="$(cargo test -p backend --lib system_hardening --features runtime_asset_mode --quiet -- --skip test_ci_fusion_consistency 2>&1)"
hardening_rt_status=$?
set -e
if [[ "$hardening_rt_status" -ne 0 ]]; then
  echo "$hardening_rt_out" >&2
  classify_hardening_failure "$hardening_rt_out"
  fail_with_class
fi
HARDENING_OK=1
echo ""

# --- [3/3] FUSION VALIDATION (cross-layer consistency) ---
echo "==> [3/3] FUSION VALIDATION"
set +e
fusion_out="$(cargo test -p backend --lib test_ci_fusion_consistency --quiet 2>&1)"
fusion_status=$?
set -e
if [[ "$fusion_status" -eq 0 ]]; then
  FUSION_OK=1
else
  echo "$fusion_out" >&2
  if ci_output_is_toolchain_failure "$fusion_out"; then
    CLASSIFICATION="TOOLCHAIN_FAILURE"
  else
    CLASSIFICATION="CROSS_LAYER_DRIFT_BLOCK"
  fi
  fail_with_class
fi
echo ""

echo "==> Architecture Integrity CI: PASS"
echo "    Classification: NONE (all stages passed)"
echo "    [1] DGEL: PASS"
echo "    [2] SYSTEM HARDENING: PASS"
echo "    [3] FUSION VALIDATION: PASS"

exit 0
