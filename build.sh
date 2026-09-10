#!/bin/bash
# Test, validate and package the plugin with Elgato's CLI.

set -euo pipefail

PLUGIN_NAME="com.teamvrotek.caffeinetracker"
RELEASE_DIR="Release"
PLUGIN_DIR="$PLUGIN_NAME.sdPlugin"

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Building $PLUGIN_NAME..."

echo "Installing dependencies..."
cd "$PLUGIN_DIR"
npm ci --omit=dev --ignore-scripts --silent
npm test
cd ..

mkdir -p "$RELEASE_DIR"
cp -R "$PLUGIN_DIR" "$BUILD_DIR/$PLUGIN_DIR"
cp LICENSE "$BUILD_DIR/$PLUGIN_DIR/LICENSE"
if ! npx --yes @elgato/cli@1.9.0 pack "$BUILD_DIR/$PLUGIN_DIR" --output "$BUILD_DIR" --force --no-file-list > "$BUILD_DIR/pack.log" 2>&1; then
    cat "$BUILD_DIR/pack.log"
    exit 1
fi

# The CLI pads versions to four parts. Preserve the project's release version.
node --input-type=module - "$PLUGIN_DIR/manifest.json" "$BUILD_DIR/$PLUGIN_DIR/manifest.json" <<'NODE'
import fs from 'node:fs';

const [sourcePath, stagedPath] = process.argv.slice(2);
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText);
const staged = JSON.parse(fs.readFileSync(stagedPath, 'utf8'));
if (!/^\d+\.\d+(?:\.\d+)?$/.test(source.Version)) {
    throw new Error('Use a two- or three-part release version, such as 2.0.');
}
staged.Version = source.Version;
if (JSON.stringify(staged) !== JSON.stringify(source)) {
    throw new Error('Packaging changed unexpected manifest fields.');
}
fs.writeFileSync(stagedPath, sourceText);
NODE

PACKAGE_PATH="$BUILD_DIR/$PLUGIN_NAME.streamDeckPlugin"
(
    cd "$BUILD_DIR"
    zip -q "$PACKAGE_PATH" "$PLUGIN_DIR/manifest.json"
)
unzip -p "$PACKAGE_PATH" "$PLUGIN_DIR/manifest.json" > "$BUILD_DIR/packaged-manifest.json"
cmp "$PLUGIN_DIR/manifest.json" "$BUILD_DIR/packaged-manifest.json"
zip -T "$PACKAGE_PATH"
mv "$PACKAGE_PATH" "$PROJECT_DIR/$RELEASE_DIR/$PLUGIN_NAME.streamDeckPlugin"

echo "Done: $RELEASE_DIR/$PLUGIN_NAME.streamDeckPlugin"
node -p "'Version: ' + JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/manifest.json', 'utf8')).Version"
echo "Install by double-clicking the file in Finder."
