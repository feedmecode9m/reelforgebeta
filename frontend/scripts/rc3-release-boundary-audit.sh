#!/usr/bin/env bash

set -euo pipefail

echo "=============================================="
echo " RC3 Release Boundary Audit"
echo " ReelForge pre-Netlify verification"
echo "=============================================="

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo
echo "== Git branch =="
git branch --show-current

echo
echo "== Working tree summary =="
git status --short

echo
echo "== Modified file statistics =="
git diff --stat

echo
echo "=============================================="
echo " TRACKED MODIFICATIONS"
echo "=============================================="

git diff --name-only

echo
echo "=============================================="
echo " FRONTEND HERO / VAULT DIFF SUMMARY"
echo "=============================================="

git diff -- \
frontend/src/components/experiences/VaultExperience.svelte \
frontend/src/components/experiences/HeroExperience.svelte \
frontend/src/components/experiences/StudioExperience.svelte \
frontend/src/viewer/viewerContext.js \
frontend/src/lib/diagnostics/pipelineDiag.js \
frontend/src/lib/diagnostics/pipelineSnapshot.js

echo
echo "=============================================="
echo " BACKEND UPLOAD CONTRACT DIFF"
echo "=============================================="

git diff -- \
backend/src/handlers.rs \
backend/src/health_state.rs \
backend/src/ingestion/upload.rs \
backend/src/main.rs \
backend/src/reel_contract.rs

echo
echo "=============================================="
echo " GENERATED / ARTIFACT CHECK"
echo "=============================================="

git status --short | grep -E \
"artifacts|thumbs|\\.json$|\\.har$|\\.png$|\\.jpg$|\\.jpeg$|\\.md$|\\.mjs$" \
|| echo "No obvious artifact files detected"

echo
echo "=============================================="
echo " RELEASE AUDIT COMPLETE"
echo "=============================================="

echo
echo "Next Cursor action:"
echo "Classify changes into:"
echo "1. RELEASE COMMIT"
echo "2. BACKEND DEPENDENCY"
echo "3. INVESTIGATION ARTIFACT"
echo "4. DO NOT SHIP"
