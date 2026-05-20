#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Create group/user with the requested IDs if they don't already exist
if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup -g "$PGID" -S app
fi
if ! getent passwd "$PUID" > /dev/null 2>&1; then
    adduser -u "$PUID" -S app -G "$(getent group "$PGID" | cut -d: -f1)"
fi

chown -R "$PUID:$PGID" /data

exec su-exec "$PUID" /wallhaven-proxy "$@"
