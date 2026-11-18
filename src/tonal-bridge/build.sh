#!/bin/bash
# Builds "Tonal Bridge.app" (Apple silicon + Intel) and zips it as TonalBridge.zip.
# Runs on macOS with the Xcode command line tools (GitHub's macOS runners have them).
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(grep -E '^let VERSION' main.swift | sed -E 's/.*"(.*)".*/\1/')
APP="Tonal Bridge.app"
rm -rf build "$APP" TonalBridge.zip
mkdir -p build

swiftc -O -target arm64-apple-macos11 main.swift -o build/TonalBridge-arm64
swiftc -O -target x86_64-apple-macos11 main.swift -o build/TonalBridge-x86_64
lipo -create build/TonalBridge-arm64 build/TonalBridge-x86_64 -output build/TonalBridge

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/TonalBridge "$APP/Contents/MacOS/TonalBridge"
sed "s/__VERSION__/$VERSION/g" Info.plist > "$APP/Contents/Info.plist"

# Ad-hoc signature so macOS will run it; it isn't notarised, so the first launch
# needs right-click → Open (or System Settings → Privacy & Security → Open Anyway).
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"

ditto -c -k --keepParent "$APP" TonalBridge.zip
echo "Built Tonal Bridge $VERSION"
