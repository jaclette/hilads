#!/usr/bin/env bash
# Fast "after" build for the design pass: the store pipeline's native iOS release app
# (scripts/store-screenshots/.cache/app/Hilads.app) with today's JS bundle swapped in.
# JS-only changes need no native rebuild; this takes ~2 minutes instead of ~20.
#
#   scripts/design-pass/bundle-ios.sh            → scripts/design-pass/.cache/Hilads.app
#
# The bundle is made in a copy of apps/mobile with its own .env.local pointing at the local
# stack: apps/mobile/.env.local points at PRODUCTION and Expo compiles .env values in.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$REPO/scripts/design-pass"
CACHE="$HERE/.cache"
NATIVE="$REPO/scripts/store-screenshots/.cache/app/Hilads.app"
WORK="$CACHE/bundle-src"
APP="$CACHE/Hilads.app"
[ -d "$NATIVE" ] || { echo "✖ no native build at $NATIVE (run scripts/store-screenshots/run.sh once)" >&2; exit 1; }

mkdir -p "$CACHE"
rsync -a --delete --exclude node_modules --exclude ios --exclude android --exclude .expo --exclude 'build-*' \
  --exclude credentials --exclude credentials.json --exclude '.env*.local' "$REPO/apps/mobile/" "$WORK/"
ln -sfn "$REPO/apps/mobile/node_modules" "$WORK/node_modules"
{ grep -E '^(EXPO_PUBLIC_MAPBOX_TOKEN|EXPO_PUBLIC_META_APP_ID|EXPO_PUBLIC_BASE_URL)=' "$REPO/apps/mobile/.env.local" || true
  echo "EXPO_PUBLIC_API_URL=http://localhost:8080"; echo "EXPO_PUBLIC_WS_URL=ws://localhost:8091"; } > "$WORK/.env.local"

OUT="$CACHE/bundle-out"
rm -rf "$OUT"; mkdir -p "$OUT/assets"
(cd "$WORK" && EXPO_PUBLIC_API_URL=http://localhost:8080 EXPO_PUBLIC_WS_URL=ws://localhost:8091 EXPO_PUBLIC_SENTRY_DSN= \
  NODE_ENV=production npx expo export:embed --platform ios --dev false --minify true --entry-file index.js \
  --bundle-output "$OUT/main.js" --assets-dest "$OUT/assets" >/dev/null)
grep -q "api.hilads.live" "$OUT/main.js" && { echo "✖ bundle points at production" >&2; exit 1; }

HERMESC="$REPO/apps/mobile/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
"$HERMESC" -emit-binary -O -out "$OUT/main.jsbundle" "$OUT/main.js" >/dev/null 2>&1

rm -rf "$APP"; cp -R "$NATIVE" "$APP"
cp "$OUT/main.jsbundle" "$APP/main.jsbundle"
cp -R "$OUT/assets/." "$APP/"
# Re-sign ad hoc WITH the original entitlements: without them the simulator keychain (the session) is lost.
codesign -d --entitlements :- "$NATIVE" > "$CACHE/entitlements.plist" 2>/dev/null
codesign --force --sign - --timestamp=none --entitlements "$CACHE/entitlements.plist" "$APP" >/dev/null 2>&1
echo "$APP"
