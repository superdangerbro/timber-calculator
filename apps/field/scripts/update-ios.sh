#!/usr/bin/env bash
# Pull the latest code and rebuild the iPhone project, keeping your Xcode signing Team.
# Run from anywhere:  ~/timber-calculator/apps/field/scripts/update-ios.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PBX=apps/field/ios/App/App.xcodeproj/project.pbxproj

# Remember the signing Team Xcode saved (free Personal Team id), then drop local iOS edits
# so the pull never conflicts.
TEAM=$(grep -m1 -o 'DEVELOPMENT_TEAM = [A-Z0-9]*;' "$PBX" | sed 's/DEVELOPMENT_TEAM = //; s/;//' || true)
BRANCH=claude/project-thread-jnehgx
git fetch origin "$BRANCH"
# Match the published code exactly (local edits are only generated/signing files).
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
echo "Code version: $(git log --oneline -1)"

pnpm install
pnpm --filter @timber/field build
if ! grep -q "Press New tree" apps/field/dist/assets/*.js; then
  echo "Build check failed: the new screens are not in the bundle. Stop and send this output." >&2
  exit 1
fi
(cd apps/field && npx cap sync ios)

if [ -n "${TEAM:-}" ]; then
  # Put the Team back on the app target (before each bundle id line).
  sed -i '' "/PRODUCT_BUNDLE_IDENTIFIER = /i\\
				DEVELOPMENT_TEAM = ${TEAM};
" "$PBX"
  echo "Signing Team restored: ${TEAM}"
else
  echo "No signing Team found: pick your Personal Team in Xcode > App > Signing & Capabilities."
fi
open apps/field/ios/App/App.xcworkspace
echo "Done. In Xcode, make sure your iPhone is selected and press Run."
