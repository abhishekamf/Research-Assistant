#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — GitHub Actions setup / repair
# Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
#
# WHAT THIS DOES
#   Writes (or repairs) .github/workflows/build.yml — the workflow that
#   automatically builds macOS (.dmg/.zip) and Windows (.exe) installers on
#   every push — then verifies everything GitHub needs is in place.
#
#   Run this if:
#   • you built the folder with create-structure.sh and the workflow is empty
#   • Finder hid your .github folder and you're unsure it exists
#   • the Actions tab shows no workflow after pushing
#
# USAGE (from inside the research-ai-assistant folder)
#   chmod +x scripts/setup-actions.sh
#   ./scripts/setup-actions.sh
# ============================================================================

set -euo pipefail

[ -f package.json ] || { echo "✗ run this from inside the research-ai-assistant folder"; exit 1; }

echo "▸ writing .github/workflows/build.yml"
mkdir -p .github/workflows
cat > .github/workflows/build.yml <<'WORKFLOW'
name: Build Desktop Apps (macOS & Windows)

on:
  push:
    branches: [main, master]
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm install

      - name: Build macOS (dmg + zip, Intel & Apple Silicon)
        if: runner.os == 'macOS'
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false   # unsigned build — avoids CI keychain errors
        run: npx electron-builder --mac --publish never

      - name: Build Windows (NSIS installer)
        if: runner.os == 'Windows'
        run: npx electron-builder --win --publish never

      - name: Upload macOS artifacts
        if: runner.os == 'macOS'
        uses: actions/upload-artifact@v4
        with:
          name: macos-distributables
          path: |
            release/*.dmg
            release/*.zip
          if-no-files-found: error

      - name: Upload Windows artifacts
        if: runner.os == 'Windows'
        uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: release/*.exe
          if-no-files-found: error

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            artifacts/macos-distributables/*
            artifacts/windows-installer/*
WORKFLOW

echo "▸ making scripts executable"
chmod +x scripts/*.sh 2>/dev/null || true

echo ""
echo "──────────────── verification ────────────────"
ok=1
for f in .github/workflows/build.yml package.json .gitignore; do
  if [ -s "$f" ]; then
    printf "  ✓ %-32s %s bytes\n" "$f" "$(wc -c < "$f" | tr -d ' ')"
  elif [ "$f" = ".github/workflows/build.yml" ]; then
    printf "  ✗ %-32s STILL MISSING — this script failed to write it\n" "$f"; ok=0
  else
    printf "  ⚠ %-32s empty placeholder — copy the real file from the project ZIP\n" "$f"
  fi
done
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml')); print('  ✓ build.yml is valid YAML')" 2>/dev/null \
  || node -e "console.log('  ℹ (skip YAML lint — optional tools not installed)')"

echo ""
if [ $ok -eq 1 ]; then
  echo "✔ All good. Next steps:"
else
  echo "✗ Fix the missing files above (re-download the project ZIP) and re-run."
  exit 1
fi
echo "    1. commit & push:            git add .github && git commit -m 'CI: build mac+win installers' && git push"
echo "       (or GitHub Desktop → Commit to main → Push origin)"
echo "    2. open your repo → 'Actions' tab → 'Build Desktop Apps (macOS & Windows)'"
echo "    3. after ~5-10 min: download 'macos-distributables' / 'windows-installer' artifacts"
echo "    4. to publish a Release:     git tag v1.0.0 && git push origin v1.0.0"
echo ""
echo "  ℹ Can't see .github in Finder? It's hidden: press Cmd+Shift+. in Finder to show dot-folders."
