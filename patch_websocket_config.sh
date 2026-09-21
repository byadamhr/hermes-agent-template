#!/bin/bash
set -e

# Patch /app/server.py to fix WebSocket idle timeout and add ping configuration
# This ensures patches survive Docker image redeployments

SERVER_FILE="/app/server.py"

# Change 1: Idle timeout 300s → 3600s (1 hour)
# Match the hardcoded _WS_IDLE_TIMEOUT = 300 line and replace it
sed -i 's/^_WS_IDLE_TIMEOUT = 300\b/_WS_IDLE_TIMEOUT = int(os.environ.get("WS_IDLE_TIMEOUT", "3600"))/' "$SERVER_FILE"

# Change 2: Add configurable ping settings (insert after the _WS_IDLE_TIMEOUT line)
if ! grep -q "_WS_PING_INTERVAL" "$SERVER_FILE"; then
    sed -i '/^_WS_IDLE_TIMEOUT/a _WS_PING_INTERVAL = float(os.environ.get("WS_PING_INTERVAL", "30"))\n_WS_PING_TIMEOUT = float(os.environ.get("WS_PING_TIMEOUT", "30"))' "$SERVER_FILE"
fi

# Change 3: Update upstream websockets.connect() call to use ping settings
# Replace the line with just open_timeout parameter with the full ping config
sed -i 's/upstream = await websockets\.connect(upstream_url, open_timeout=5)/upstream = await websockets.connect(\n            upstream_url,\n            open_timeout=5,\n            ping_interval=_WS_PING_INTERVAL,\n            ping_timeout=_WS_PING_TIMEOUT,\n        )/' "$SERVER_FILE"

echo "WebSocket configuration patched successfully"
