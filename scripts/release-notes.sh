#!/usr/bin/env bash
#
# release-notes.sh — extract release notes for a version from CHANGELOG.md.
# Used by .github/workflows/release.yml to build the GitHub Release body.
# Falls back to a commit list if no CHANGELOG section exists yet.
#
# Usage: bash scripts/release-notes.sh <version> [changelog-file]
#   version: e.g. 0.1.0 or v0.1.0
#
set -euo pipefail

VERSION="${1:-}"
CHANGELOG="${2:-CHANGELOG.md}"

if [ -z "$VERSION" ]; then
  echo "usage: release-notes.sh <version> [changelog-file]" >&2
  exit 1
fi

# Normalize: strip a leading "v".
VERSION="${VERSION#v}"

if [ -f "$CHANGELOG" ] && grep -q "^## \[${VERSION}\]" "$CHANGELOG"; then
  # Print from the section header until the next "## [" header.
  awk -v ver="$VERSION" '
    $0 ~ "^## \\[" ver "\\]" { found = 1; print; next }
    found && $0 ~ "^## \\[" { exit }
    found { print }
  ' "$CHANGELOG"
else
  # Fallback: list commits since the previous tag (or all commits).
  PREV_TAG="$(git tag --sort=-v:refname | head -n 1 || true)"
  echo "## ${VERSION}"
  echo ""
  echo "No CHANGELOG entry found for ${VERSION}. Commits since last release:"
  echo ""
  if [ -n "$PREV_TAG" ]; then
    git log --oneline "${PREV_TAG}..HEAD" | sed 's/^/- /'
  else
    git log --oneline | sed 's/^/- /'
  fi
fi
