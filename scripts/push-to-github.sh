#!/usr/bin/env bash
# ============================================================================
# push-to-github.sh — Push nbody-fold-scala Phase 1 + Phase 2 to GitHub
# ============================================================================
#
# USAGE:
#   GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxx bash push-to-github.sh
#
# Or:
#   bash push-to-github.sh ghp_xxxxxxxxxxxxxxxxxxxxxxx
#
# IMPORTANT — SECURITY:
#   The GitHub Personal Access Token previously used in this conversation was
#   exposed in chat and MUST be considered compromised. Before running this
#   script:
#     1. Go to https://github.com/settings/tokens
#     2. Revoke any token starting with `ghp_dVxbye...`
#     3. Generate a NEW token with `repo` scope (classic) or
#        "Contents: Read and write" (fine-grained)
#     4. Use the NEW token here
#
#   After the push succeeds, you can optionally delete the token from your
#   shell history:  history -d $(history | tail -2 | head -1 | awk '{print $1}')
# ============================================================================

set -euo pipefail

REPO_URL="https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator.git"
LOCAL_REPO_DIR="/home/z/my-project/download"

# Resolve token from arg or env
TOKEN="${1:-${GH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No GitHub token provided." >&2
  echo "Usage: GH_TOKEN=ghp_xxx bash $0   (or)   bash $0 ghp_xxx" >&2
  exit 1
fi

if [[ ! "$TOKEN" =~ ^ghp_[A-Za-z0-9]{36,}$ ]]; then
  echo "WARNING: Token does not match the expected format (ghp_ + ≥36 chars)." >&2
  echo "         Proceeding anyway — if push fails with 403, check the token." >&2
fi

cd "$LOCAL_REPO_DIR"

echo "=== Local commit log (most recent first) ==="
git log --oneline -10
echo ""

echo "=== Remote state (before push) ==="
git ls-remote origin 2>&1 | head -5
echo ""

# Inject the token into the remote URL ONLY for this push (not stored)
TOKEN_URL="https://x-access-token:${TOKEN}@github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator.git"

echo "=== Pushing main → origin/main ==="
# Use a one-shot push URL so the token is NOT persisted in .git/config
git push "$TOKEN_URL" main:main
echo ""

echo "=== Remote state (after push) ==="
git ls-remote origin 2>&1 | head -5
echo ""

echo "=== SUCCESS — Phase 1 + Phase 2 + README update are now on GitHub ==="
echo "View at: https://github.com/testdemoqwenai2025-creator/testdemo2025qwenai-creator"
echo ""
echo "REMEMBER: Clear your shell history if the token was passed as an argument:"
echo "  history -d \$(history | tail -2 | head -1 | awk '{print \$1}')"
