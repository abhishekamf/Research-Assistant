# 🔐 GitHub Actions — Building macOS & Windows installers automatically

This project ships with a GitHub Actions workflow at
**`.github/workflows/build.yml`** that builds installers for both operating
systems on every push — you never need to run `electron-builder` locally for
Windows.

---

## ⚠️ Why you may not "see" the workflow file

`.github` is a **hidden folder** (any name starting with a dot is hidden on
macOS/Linux). Finder does not show it by default.

**To see hidden files in Finder: press `⌘ Cmd + Shift + .`**
(press again to hide). Or verify from Terminal:

```bash
ls -la .github/workflows/
# expect: build.yml  (~3 KB, NOT 0 bytes)
cat .github/workflows/build.yml | head -20
```

If your `build.yml` is **0 bytes** (this happens if you created the tree with
an older `create-structure.sh`), run the repair script:

```bash
chmod +x scripts/setup-actions.sh
./scripts/setup-actions.sh
```

It rewrites the complete workflow and verifies everything.

<details>
<summary><b>Full copy of build.yml (for manual copy-paste)</b></summary>

```yaml
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

```

</details>

---

## 🚀 How to publish (step by step with GitHub Desktop)

1. **Publish the repo**
   - GitHub Desktop → `Add` → `Add Existing Repository…` → select the
     `research-ai-assistant` folder.
   - `Publish repository` (keep the name `research-ai-assistant`, uncheck
     "Keep this code private" if you want it open source).

2. **Watch the build**
   - Go to `https://github.com/abhishekamf/research-ai-assistant/actions`
   - You'll see **"Build Desktop Apps (macOS & Windows)"** running — two jobs:
     🍎 `build (macos-latest)` and 🪟 `build (windows-latest)`. Takes ~5–10 min.

3. **Download the installers**
   - When both jobs turn green ✅, scroll to the **Artifacts** section:
     - `macos-distributables` → `.dmg` (Apple Silicon + Intel) and `.zip`
     - `windows-installer` → `Research AI Assistant Setup 1.0.0.exe`

4. **(Optional) Publish a formal Release**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   The `release` job attaches all installers to a GitHub Release with
   auto-generated notes — a permanent download page for your users.

5. **Rebuild any time** — the *Actions* tab → *Build Desktop Apps* → 
   **"Run workflow"** button triggers a manual build (`workflow_dispatch`).

---

## ❓ Troubleshooting

| Symptom | Cause & fix |
|---|---|
| No workflow in the Actions tab | `build.yml` missing/empty → run `./scripts/setup-actions.sh`, commit, push |
| Actions tab exists but no run triggered | You pushed to a branch other than `main`/`master` → the workflow also has a *Run workflow* button, or push to `main` |
| macOS job fails at code signing | Already handled: `CSC_IDENTITY_AUTO_DISCOVERY: false` (unsigned build). Users right-click → Open on first launch |
| Windows SmartScreen warning | Normal for unsigned installers → *More info* → *Run anyway* |
| macOS **"app is damaged"** after install | Unsigned app + Gatekeeper. CI builds are ad-hoc signed (see `scripts/afterSign.js`), so users get the *Open Anyway* dialog; if "damaged" still appears: `xattr -cr "/Applications/Research AI Assistant.app"`. Permanent fix: Apple Developer ID + notarization (set `CSC_LINK` / `APPLE_ID` secrets) |
| Release job did nothing | It only runs on `v*` tags → `git tag v1.0.0 && git push origin v1.0.0` |
| Artifacts section missing | Job failed → open the job log; the most common cause is an npm install error (check Node version) |

> **Signing note:** unsigned builds work fine for personal/academic use. If
> your university distributes the app widely, consider Apple Developer ID
> signing + notarization (set `CSC_LINK` / `CSC_KEYCHAIN` secrets) and an
> EV code-signing cert for Windows.
