#!/usr/bin/env bash

# ----------------------------------------------------------------------------
# Simple deployment helper for the AppScript-Chat-Knowledge bot.
# Mirrors the manual steps in docs/deployment.md.
# ----------------------------------------------------------------------------

set -euo pipefail

# Defaults -------------------------------------------------------------------

PROJECT_NUMBER="${CHAT_GCP_PROJECT_NUMBER:-}"
DESCRIPTION="Deploy $(git rev-parse --short HEAD) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
ROOT_DIR="dist"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -p, --project <number>    12-digit GCP project number that owns the Chat API.
  -d, --description <text>  Deployment description. Defaults to short git SHA.
  -r, --root <dir>          Directory to push with clasp. Defaults to "dist".
  -h, --help                Show this message and exit.

The script assumes:
  • you already ran "npm run login" _or_ exported GOOGLE_APPLICATION_CREDENTIALS.
  • the Apps Script project is linked to the provided GCP project number.
EOF
}

# Parse CLI arguments --------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project)
      PROJECT_NUMBER="$2"; shift 2 ;;
    -d|--description)
      DESCRIPTION="$2"; shift 2 ;;
    -r|--root)
      ROOT_DIR="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown flag: $1" >&2; usage; exit 1 ;;
  esac
done

# Sanity checks --------------------------------------------------------------

command -v node >/dev/null || { echo "❌ Node.js is not installed" >&2; exit 1; }
command -v npm  >/dev/null || { echo "❌ npm is not installed"  >&2; exit 1; }
command -v clasp >/dev/null || { echo "❌ clasp CLI is not installed (npm i -g @google/clasp)" >&2; exit 1; }

if [[ ! -f package.json ]]; then
  echo "❌ Run the script from the repository root" >&2; exit 1;
fi

# Verify login – `clasp status` fails with code 1 when not authenticated.
if ! clasp status >/dev/null 2>&1; then
  echo "❌ clasp is not authenticated. Run 'npm run login' first." >&2
  exit 1
fi

# Step 1 – Install deps (skipped when node_modules exists) --------------------

if [[ ! -d node_modules ]]; then
  echo "📦 Installing npm dependencies…" >&2
  npm install
fi

# Step 2 – Build --------------------------------------------------------------

echo "🔨 Building Apps Script bundle…" >&2
npm run build

# Step 3 – Push to Apps Script ------------------------------------------------

echo "🚀 Pushing $ROOT_DIR to Apps Script…" >&2
clasp push --rootDir "$ROOT_DIR"

# Post-deploy reminder --------------------------------------------------------

cat <<EOF

✅ Deployed!
Next steps:
  1. Open the Apps Script editor → Deploy → Test deployments.
  2. Deploy the head version if prompted.
  3. Update the Google Chat API config with the new head deployment ID.

EOF
