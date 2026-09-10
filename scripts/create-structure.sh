#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — project scaffolding script
# Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
#
# WHAT THIS DOES
#   Creates the complete folder + file structure for the project on your
#   MacBook (works on Linux & Windows Git-Bash too). If you cloned/downloa-
#   ded the full repo you don't need this — it's for starting from scratch
#   or verifying your copy is complete.
#
# USAGE
#   chmod +x scripts/create-structure.sh
#   ./scripts/create-structure.sh [target-folder]
# ============================================================================

set -euo pipefail

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
      "$TARGET"/scripts/{create-structure.sh,push-to-github.sh} \
      "$TARGET"/docs/{USER_GUIDE.md,ARCHITECTURE.md} \
      "$TARGET"/samples/sample_survey.csv \
      "$TARGET"/resources/icon.png \
      "$TARGET"/.github/workflows/build.yml

chmod +x "$TARGET"/scripts/*.sh

# ---------------------------------------------------------------- report
echo ""
echo "▸ Structure created:"
find "$TARGET" -type d | sort | sed 's/^/    /'
echo ""
echo "✔ Done. Next steps:"
echo "    1. copy the project files into these paths (or clone the repo)"
echo "    2. cd $TARGET && npm install"
echo "    3. npm start"
echo "    4. when ready to publish: bash scripts/push-to-github.sh"
