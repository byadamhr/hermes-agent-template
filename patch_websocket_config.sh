#!/bin/bash
set -e

# Patch /app/server.py to fix WebSocket idle timeout and add ping configuration
# This ensures patches survive Docker image redeployments
# Uses Python to parse and modify the file correctly (preserves indentation)

SERVER_FILE="/app/server.py"

python3 << 'EOF'
import re

# Read the file
with open("/app/server.py", "r") as f:
    content = f.read()

# ============================================================================
# Change 1: Replace _WS_IDLE_TIMEOUT = 300 with configurable version
# ============================================================================
content = re.sub(
    r'^_WS_IDLE_TIMEOUT = 300\b',
    '_WS_IDLE_TIMEOUT = int(os.environ.get("WS_IDLE_TIMEOUT", "3600"))',
    content,
    flags=re.MULTILINE
)

# ============================================================================
# Change 2: Add _WS_PING_INTERVAL and _WS_PING_TIMEOUT after _WS_IDLE_TIMEOUT
# (only if not already present)
# ============================================================================
if '_WS_PING_INTERVAL' not in content:
    # Find the _WS_IDLE_TIMEOUT line and insert after it
    content = re.sub(
        r'(^_WS_IDLE_TIMEOUT = int\(os\.environ\.get\("WS_IDLE_TIMEOUT", "3600"\)\))',
        r'\1\n_WS_PING_INTERVAL = float(os.environ.get("WS_PING_INTERVAL", "30"))\n_WS_PING_TIMEOUT = float(os.environ.get("WS_PING_TIMEOUT", "30"))',
        content,
        flags=re.MULTILINE
    )

# ============================================================================
# Change 3: Update upstream websockets.connect() call to use ping settings
# ============================================================================
# Match: upstream = await websockets.connect(upstream_url, open_timeout=5)
# Replace with multi-line version that includes ping parameters
content = re.sub(
    r'upstream = await websockets\.connect\(upstream_url, open_timeout=5\)',
    r'''upstream = await websockets.connect(
            upstream_url,
            open_timeout=5,
            ping_interval=_WS_PING_INTERVAL,
            ping_timeout=_WS_PING_TIMEOUT,
        )''',
    content
)

# Write the patched file
with open("/app/server.py", "w") as f:
    f.write(content)

print("WebSocket configuration patched successfully")
EOF
