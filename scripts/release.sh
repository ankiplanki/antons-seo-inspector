#!/bin/bash
set -e

# Read version from manifest.json
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
RELEASE="link-status-scanner@$VERSION"

echo "Creating Sentry release: $RELEASE"

# Create and finalize the release
sentry-cli releases new "$RELEASE"

# Upload source maps for the Sentry SDK bundle
sentry-cli sourcemaps upload vendor/ \
  --release "$RELEASE" \
  --url-prefix "~/vendor/"

# Upload our own JS files (unminified — associates them with the release)
sentry-cli sourcemaps upload popup/ \
  --release "$RELEASE" \
  --url-prefix "~/popup/" \
  --ext js

sentry-cli sourcemaps upload background/ \
  --release "$RELEASE" \
  --url-prefix "~/background/" \
  --ext js

# Finalize the release
sentry-cli releases finalize "$RELEASE"

echo "Done. Release $RELEASE finalized in Sentry."
