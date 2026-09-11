#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — apply the hardened Windows/macOS CI workflow
# Replaces .github/workflows/build.yml in-place, verifies, commits and pushes.
#
# Usage:  bash fix-windows-build.sh /path/to/your/local/repo
# ============================================================================
set -euo pipefail

REPO="${1:-.}"
cd "$REPO"
[ -f package.json ] || { echo "✗ not a project folder (no package.json): $REPO"; exit 1; }

echo "▸ current workflow uses: $(grep -m1 'actions/checkout' .github/workflows/build.yml 2>/dev/null || echo '(file missing)')"

mkdir -p .github/workflows
cat > .github/workflows/build.yml <<'WORKFLOW_EOF'
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
        uses: actions/checkout@v6

      - name: Setup Node.js 22
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      # macOS: FULL install — electron-builder requires the optional dep
      # 'dmg-license' at startup on macOS; --omit=optional breaks it instantly.
      # (canvas, the other optional dep, installs fine/silently-skips on macOS)
      - name: Install dependencies (macOS)
        if: runner.os == 'macOS'
        run: npm install --no-audit --no-fund

      # Windows: skip optional native deps — 'canvas' has no prebuilt binary
      # for Node 22 and would try to compile (fails). dmg-license is not
      # needed for the Windows target.
      - name: Install dependencies (Windows)
        if: runner.os == 'Windows'
        run: npm install --no-audit --no-fund --omit=optional

      - name: Build macOS (dmg + zip, Intel & Apple Silicon)
        if: runner.os == 'macOS'
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false   # unsigned build — avoids CI keychain errors
        run: |
          npx electron-builder --mac --publish never || {
            echo "::warning::electron-builder failed once — retrying (electron/dmg downloads can flake)"
            sleep 15
            npx electron-builder --mac --publish never
          }

      - name: Build Windows (NSIS installer, auto-retry)
        if: runner.os == 'Windows'
        shell: bash
        run: |
          npx electron-builder --win --publish never || {
            echo "::warning::electron-builder failed once — retrying (NSIS/winCodeSign download flakes are common)"
            sleep 15
            npx electron-builder --win --publish never
          }

      - name: Diagnostics (only on failure)
        if: failure()
        shell: bash
        run: |
          echo "=== versions ==="
          node -v
          npx electron-builder --version || true
          echo "=== dmg-license present? (needed on macOS) ==="
          ls node_modules/dmg-license/package.json 2>/dev/null && echo "dmg-license: present" || echo "dmg-license: MISSING"
          echo "=== release dir ==="
          ls -la release 2>/dev/null || echo "(release dir not created — see the failed build step's log above)"

      - name: Upload macOS artifacts
        if: runner.os == 'macOS'
        uses: actions/upload-artifact@v7
        with:
          name: macos-distributables
          path: |
            release/*.dmg
            release/*.zip
          if-no-files-found: error

      - name: Upload Windows artifacts
        if: runner.os == 'Windows'
        uses: actions/upload-artifact@v7
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
        uses: actions/download-artifact@v7
        with:
          path: artifacts

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v3
        with:
          generate_release_notes: true
          files: |
            artifacts/macos-distributables/*
            artifacts/windows-installer/*

WORKFLOW_EOF

echo ""
echo "──────────────── verification ────────────────"
bytes=$(wc -c < .github/workflows/build.yml | tr -d ' ')
echo "  ✓ written: .github/workflows/build.yml ($bytes bytes)"
grep -q "actions/checkout@v6" .github/workflows/build.yml && echo "  ✓ checkout@v6" || { echo "  ✗ write failed"; exit 1; }
grep -q "upload-artifact@v7" .github/workflows/build.yml && echo "  ✓ upload-artifact@v7" || exit 1
grep -q "omit=optional" .github/workflows/build.yml && echo "  ✓ skips native 'canvas' build on Windows" || exit 1
grep -q "retrying" .github/workflows/build.yml && echo "  ✓ Windows auto-retry enabled" || exit 1

echo ""
echo "▸ committing and pushing…"
git add .github/workflows/build.yml
git commit -m "CI: harden Windows build — omit optional native deps, auto-retry NSIS download, Node 22, modern action versions" || echo "(nothing to commit)"
git push

echo ""
echo "✔ DONE. Watch: GitHub repo → Actions tab → the NEW run."
echo "  How you know the new workflow is active: the steps will say"
echo "  'Setup Node.js 22' and the deprecation warnings will disappear."
