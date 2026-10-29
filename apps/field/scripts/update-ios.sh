#!/usr/bin/env bash
# Pull the latest code and rebuild the iPhone project, keeping your Xcode signing Team.
# Run from anywhere:  ~/timber-calculator/apps/field/scripts/update-ios.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PBX=apps/field/ios/App/App.xcodeproj/project.pbxproj

# Remember the signing Team Xcode saved (free Personal Team id), then drop local iOS edits
# so the pull never conflicts.
TEAM=$(grep -m1 -o 'DEVELOPMENT_TEAM = [A-Z0-9]*;' "$PBX" | sed 's/DEVELOPMENT_TEAM = //; s/;//' || true)
git checkout HEAD -- apps/field/ios
git pull --ff-only

pnpm install
pnpm --filter @timber/field build
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
