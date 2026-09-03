#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROPS="$SCRIPT_DIR/../sentry.properties"

if [ ! -f "$PROPS" ]; then
  echo "Error: sentry.properties not found at $PROPS"
  exit 1
fi

# Parse sentry.properties into individual env vars sentry-cli recognises natively
export SENTRY_AUTH_TOKEN=$(grep '^auth.token=' "$PROPS" | cut -d= -f2-)
export SENTRY_ORG=$(grep '^defaults.org=' "$PROPS" | cut -d= -f2-)
export SENTRY_PROJECT=$(grep '^defaults.project=' "$PROPS" | cut -d= -f2-)

# Read version from manifest.json
VERSION=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/../manifest.json'))['version'])")
RELEASE="antons-seo-inspector@$VERSION"

echo "Creating Sentry release: $RELEASE"

sentry-cli releases new "$RELEASE"

upload_sourcemaps() {
  local output
  output=$(sentry-cli sourcemaps upload "$@" 2>&1)
  echo "$output"
  if echo "$output" | grep -q "warning:"; then
    echo "Error: sourcemap upload completed with warnings (see above)" >&2
    exit 1
  fi
}

# Vendor bundle: minified, has a source map — fail loudly if map is missing
upload_sourcemaps "$SCRIPT_DIR/../vendor/" \
  --release "$RELEASE" \
  --url-prefix "~/vendor/"

# Our own JS: unminified, no source maps needed — just associate with the release
sentry-cli sourcemaps upload "$SCRIPT_DIR/../popup/" \
  --release "$RELEASE" \
  --url-prefix "~/popup/" \
  --ext js \
  --no-sourcemap-reference

sentry-cli sourcemaps upload "$SCRIPT_DIR/../background/" \
  --release "$RELEASE" \
  --url-prefix "~/background/" \
  --ext js \
  --no-sourcemap-reference

sentry-cli releases finalize "$RELEASE"

echo "Done. Release $RELEASE finalized in Sentry."
