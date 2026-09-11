#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — project scaffolding script
# Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
#
# WHAT THIS DOES
#   Creates the complete folder + file structure for the project (macOS,
#   Linux & Windows Git-Bash). Files are created EMPTY except the GitHub
#   Actions workflow, which is written with FULL content by
#   scripts/setup-actions.sh so CI works immediately.
#
#   If you downloaded the project ZIP you do NOT need this script — it is
#   for starting from scratch or verifying a copy is complete.
#
# USAGE
#   chmod +x scripts/*.sh
#   ./scripts/create-structure.sh [target-folder]
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # where THIS (real) script lives
TARGET="${1:-research-ai-assistant}"
echo "▸ Creating project structure in ./$TARGET"

# ---------------------------------------------------------------- folders
mkdir -p "$TARGET"/{electron,server,src/css,src/js/views,scripts,resources,docs,samples,.github/workflows}

# ---------------------------------------------------------------- files
touch "$TARGET"/{README.md,LICENSE,.gitignore,package.json} \
      "$TARGET"/electron/{main.js,preload.js} \
      "$TARGET"/server/{api.js,store.js,utils.js,ingest.js,chunker.js,embeddings.js,retriever.js,rag.js,llm.js,scholar.js,citations.js,workflows.js,stats.js} \
      "$TARGET"/src/index.html \
      "$TARGET"/src/css/app.css \
      "$TARGET"/src/js/{app.js,api.js,ui.js,charts.js} \
      "$TARGET"/src/js/views/{library.js,chat.js,discover.js,references.js,workflows.js,data.js,settings.js} \
      "$TARGET"/scripts/{create-structure.sh,push-to-github.sh,setup-actions.sh} \
      "$TARGET"/docs/{USER_GUIDE.md,ARCHITECTURE.md,GITHUB_ACTIONS_SETUP.md} \
      "$TARGET"/samples/sample_survey.csv \
      "$TARGET"/resources/icon.png

# copy the REAL helper scripts over the empty placeholders (if available)
for f in create-structure.sh push-to-github.sh setup-actions.sh; do
  [ -f "$SCRIPT_DIR/$f" ] && cp "$SCRIPT_DIR/$f" "$TARGET/scripts/$f"
done
chmod +x "$TARGET"/scripts/*.sh 2>/dev/null || true

# ---------------------------------------------------------------- workflow
# IMPORTANT: .github/workflows/build.yml must never be an empty placeholder.
# setup-actions.sh writes the complete workflow (build macOS + Windows).
cd "$TARGET"
if [ -s scripts/setup-actions.sh ] && bash scripts/setup-actions.sh; then
  echo "▸ GitHub Actions workflow installed with full content ✓"
else
  echo "! Could not write the workflow automatically. After this script run:"
  echo "    bash scripts/setup-actions.sh"
fi

# ---------------------------------------------------------------- report
echo ""
echo "▸ Structure created:"
find . -type d -not -path "." | sort | sed 's/^/    /'
echo ""
echo "✔ Done. Next steps:"
echo "    1. copy the project files into these paths (or clone the repo)"
echo "    2. npm install && npm start"
echo "    3. when ready to publish: bash scripts/push-to-github.sh <repo-url>"
