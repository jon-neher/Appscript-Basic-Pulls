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
  -p, --project <number>    12-digit GCP project number that owns the Chat API (passed to clasp).
  -d, --description <text>  Deployment description (annotates the created version & deployment).
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

# Step 4 – (Optional) Link to Cloud project ----------------------------------

if [[ -n "$PROJECT_NUMBER" ]]; then
  echo "🔗 Linking Apps Script project to Cloud project $PROJECT_NUMBER…" >&2
  # `clasp setting projectId` sets the cloud project ID. For numeric project
  # numbers this is equivalent and accepted by the API.
  # We continue even if the command fails because the project may already be
  # linked or the clasp version does not support the setting command.
  if ! clasp setting projectId "$PROJECT_NUMBER" >/dev/null 2>&1; then
    echo "⚠️  Unable to set projectId (clasp may not support it) – continuing." >&2
  fi
fi

# Step 5 – Create version & deploy -------------------------------------------

echo "🏷️  Creating new script version…" >&2
VERSION_OUTPUT=$(clasp version "$DESCRIPTION")
# Parse the version number (last number in the output)
VERSION_NUMBER=$(echo "$VERSION_OUTPUT" | grep -Eo '[0-9]+' | tail -1)

if [[ -z "$VERSION_NUMBER" ]]; then
  echo "❌ Failed to parse version number from clasp output:" >&2
  echo "$VERSION_OUTPUT" >&2
  exit 1
fi

echo "🚀 Deploying version $VERSION_NUMBER as head…" >&2
clasp deploy -V "$VERSION_NUMBER" -d "$DESCRIPTION"

# Post-deploy reminder --------------------------------------------------------

cat <<EOF

✅ Deployed!
Next steps:
  1. Optional: verify the new *Head* deployment in the Apps Script editor.
  2. Update the Google Chat API configuration with the new head deployment ID (if it changed).

EOF
