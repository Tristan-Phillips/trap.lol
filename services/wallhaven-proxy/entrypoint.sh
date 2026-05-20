#!/bin/sh
set -e

# Fix ownership of the data directory regardless of how the volume was mounted.
# This runs as root; we immediately drop to uid 65532 (app) via exec su-exec.
chown -R 65532:65532 /data

exec su-exec app /wallhaven-proxy "$@"
