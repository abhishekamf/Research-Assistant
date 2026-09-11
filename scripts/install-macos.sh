#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — macOS one-command installer
# Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
#
# WHY THIS EXISTS
#   Browsers add a macOS "quarantine" flag to every downloaded file, which
#   makes unsigned/un-notarized apps show "App is damaged and can't be
#   opened". Files downloaded with curl in Terminal do NOT get that flag —
#   so this installer (mount .dmg -> copy to /Applications) bypasses
#   Gatekeeper entirely. No xattr needed, no warnings.
#
# USAGE
#   curl -fsSL https://raw.githubusercontent.com/abhishekamf/Research-Assistant/main/scripts/install-macos.sh | bash
# ============================================================================
set -euo pipefail

REPO="abhishekamf/Research-Assistant"
APP_NAME="Research AI Assistant"

echo "▸ $APP_NAME — macOS installer"
[ "$(uname)" = "Darwin" ] || { echo "✗ This script is for macOS."; exit 1; }

# pick the right architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then PATTERN="arm64"; else PATTERN="x64"; fi
echo "▸ detected architecture: $ARCH"

# resolve the latest release's matching .dmg (or .zip fallback) via the GitHub API
echo "▸ resolving latest release…"
API_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") || {
  echo "✗ Could not reach GitHub. Do you have a release published? (git tag v1.0.0 && git push origin v1.0.0)"
  exit 1;
}
# dependency-free JSON parsing (no python required)
DMG_URLS=$(echo "$API_JSON" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | sed 's/.*"\(https[^"]*\)"/\1/')
ASSET_URL=$(echo "$DMG_URLS" | grep -i "$PATTERN" | head -1 || true)
[ -z "${ASSET_URL:-}" ] && ASSET_URL=$(echo "$DMG_URLS" | head -1 || true)

[ -n "${ASSET_URL:-}" ] || { echo "✗ No suitable .dmg/.zip found in the latest release. Publish one first (git tag v1.0.0 && git push origin v1.0.0)."; exit 1; }
echo "▸ downloading: $ASSET_URL"

TMP=$(mktemp -d)
ART="$TMP/$(basename "$ASSET_URL")"
curl -fL "$ASSET_URL" -o "$ART"

# install
if [[ "$ART" == *.dmg ]]; then
  echo "▸ mounting disk image…"
  hdiutil attach "$ART" -nobrowse -quiet
  MNT=$(ls /Volumes | grep -i "Research" | head -1)
  [ -n "$MNT" ] || { echo "✗ could not find mounted volume"; hdiutil detach "$MNT" 2>/dev/null || true; exit 1; }
  echo "▸ copying to /Applications (admin password may be asked)…"
  sudo cp -R "/Volumes/$MNT/$APP_NAME.app" /Applications/
  hdiutil detach "/Volumes/$MNT" -quiet || true
else
  echo "▸ unzipping…"
  sudo unzip -q -o "$ART" -d /Applications
fi

# belt & braces: strip any quarantine attributes that may exist (harmless if none)
sudo xattr -cr "/Applications/$APP_NAME.app" 2>/dev/null || true

rm -rf "$TMP"
echo ""
echo "✔ Installed to /Applications/$APP_NAME.app"
echo "▸ Launch it from Applications, Spotlight, or run:"
echo "    open \"/Applications/$APP_NAME.app\""
