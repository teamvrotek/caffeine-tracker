#!/bin/bash
# Packages the plugin into a .streamDeckPlugin file.

set -e

PLUGIN_NAME="com.teamvrotek.caffeinetracker"
RELEASE_DIR="Release"
PLUGIN_DIR="$PLUGIN_NAME.sdPlugin"

cd "$(dirname "$0")"

echo "Building $PLUGIN_NAME..."

echo "Installing dependencies..."
cd "$PLUGIN_DIR"
npm install --production --silent
cd ..

mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR/$PLUGIN_NAME.streamDeckPlugin"

zip -r -q "$RELEASE_DIR/$PLUGIN_NAME.streamDeckPlugin" "$PLUGIN_DIR" \
    -x "*.DS_Store" \
    -x "*__MACOSX*" \
    -x "*/caffeine.test.js" \
    -x "*/render_smoke.js"

echo "Done: $RELEASE_DIR/$PLUGIN_NAME.streamDeckPlugin"
echo "Install by double-clicking the file in Finder."
