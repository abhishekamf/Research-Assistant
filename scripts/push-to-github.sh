#!/usr/bin/env bash
# ============================================================================
# Research AI Assistant — one-copy GitHub publish script
# Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
#
# WHAT THIS DOES
#   1. checks git + GitHub Desktop prerequisites
#   2. git init (main branch) + first commit
#   3. connects to YOUR empty GitHub repo (created in GitHub Desktop or web)
#   4. pushes everything -> GitHub Actions then builds mac/win installers
#
# USAGE (edit REPO_URL below first, then run:)
#   chmod +x scripts/push-to-github.sh
#   ./scripts/push-to-github.sh https://github.com/abhishekamf/research-ai-assistant.git
# ============================================================================

set -euo pipefail

# ---- EDIT THIS if not passing the URL as an argument ------------------------
DEFAULT_REPO="https://github.com/abhishekamf/research-ai-assistant.git"
REPO_URL="${1:-$DEFAULT_REPO}"
# -----------------------------------------------------------------------------

echo "▸ Research AI Assistant → GitHub publisher"
echo "  target repo: $REPO_URL"
echo ""

# sanity checks
command -v git >/dev/null 2>&1 || { echo "✗ git not found. Install: xcode-select --install"; exit 1; }
[ -f package.json ] || { echo "✗ run this from inside the research-ai-assistant folder"; exit 1; }

# never commit junk or secrets
grep -q "node_modules" .gitignore 2>/dev/null || { echo "✗ .gitignore missing"; exit 1; }
[ ! -e .env ] || echo "! NOTE: .env exists — it is git-ignored, good."

BRANCH="main"

if [ -d .git ]; then
  echo "▸ git repo already initialised — adding files & committing"
else
  echo "▸ initialising git repository (branch: $BRANCH)"
  git init -b "$BRANCH"
fi

git add .
if git diff --cached --quiet; then
  echo "▸ nothing new to commit"
else
  git commit -m "Research AI Assistant v1.0.0 — initial release

- Literature mapping (k-means + PCA theme clusters)
- Research gap analysis (structured, prioritized)
- Citation-aware RAG chat over local papers (BM25 + embeddings)
- Academic search: arXiv / OpenAlex / Semantic Scholar / Crossref
- Reference manager: BibTeX/RIS, APA/MLA/Chicago/IEEE/Harvard/Vancouver
- Methodology suggestions & manuscript assistance workflows
- Data Lab: descriptives, correlations, t-test/ANOVA, chi-square,
  OLS regression, Cronbach's alpha, AI interpretation
- Electron app, local-first storage, Ollama & cloud LLM support"
fi

if git remote | grep -q "^origin"; then
  echo "▸ updating existing origin remote"
  git remote set-url origin "$REPO_URL"
else
  echo "▸ adding remote origin"
  git remote add origin "$REPO_URL"
fi

echo "▸ pushing to GitHub ($BRANCH)…"
git push -u origin "$BRANCH"

echo ""
echo "✔ PUSHED. What happens next:"
echo "    • GitHub Actions now builds macOS + Windows installers automatically"
echo "      (see the 'Actions' tab of your repo, takes ~5-10 min)"
echo "    • download them from Actions → Build → Artifacts"
echo "    • to publish a release:  git tag v1.0.0 && git push origin v1.0.0"
echo ""
echo "  Prefer GitHub Desktop? Just: Repository → Push (it uses the same remote)."
