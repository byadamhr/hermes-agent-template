#!/bin/bash
set -e

# ─── PostgreSQL (Honcho backend) ────────────────────────────────────────────
# Honcho requires PostgreSQL + pgvector. Data lives on /data/honcho-db/
# so it survives container rebuilds. On first boot, we initialize the
# cluster; on subsequent boots, we just start the existing one.
HONCHO_PGDATA="/data/honcho-db"
HONCHO_DB_USER="honcho"
HONCHO_DB_PASS="honcho"
HONCHO_DB_NAME="honcho"
PG_BIN="/usr/lib/postgresql/15/bin"
export PGDATA="$HONCHO_PGDATA"

if [ ! -f "$HONCHO_PGDATA/PG_VERSION" ]; then
  echo "=== Initializing PostgreSQL for Honcho ==="
  mkdir -p "$HONCHO_PGDATA"
  chown postgres:postgres "$HONCHO_PGDATA"
  su - postgres -c "$PG_BIN/initdb -D '$HONCHO_PGDATA' --auth=trust"
  # Allow local connections without password (trust auth)
  echo "local all all trust" > "$HONCHO_PGDATA/pg_hba.conf"
  echo "host all all 127.0.0.1/32 trust" >> "$HONCHO_PGDATA/pg_hba.conf"
  echo "host all all ::1/128 trust" >> "$HONCHO_PGDATA/pg_hba.conf"
fi

# Start PostgreSQL (always, even if already running from a previous boot)
if ! su - postgres -c "$PG_BIN/pg_isready" >/dev/null 2>&1; then
  echo "=== Starting PostgreSQL ==="
  su - postgres -c "$PG_BIN/pg_ctl -D '$HONCHO_PGDATA' -l '$HONCHO_PGDATA/pg.log' start -w"
  for i in $(seq 1 30); do
    if su - postgres -c "$PG_BIN/pg_isready" >/dev/null 2>&1; then
      echo "=== PostgreSQL ready ==="
      break
    fi
    sleep 1
  done
fi

# Create Honcho database and user if they don't exist
su - postgres -c "$PG_BIN/psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$HONCHO_DB_USER'\"" | grep -q 1 || \
  su - postgres -c "$PG_BIN/psql -c \"CREATE USER $HONCHO_DB_USER WITH PASSWORD '$HONCHO_DB_PASS';\""
su - postgres -c "$PG_BIN/psql -tc \"SELECT 1 FROM pg_database WHERE datname='$HONCHO_DB_NAME'\"" | grep -q 1 || \
  su - postgres -c "$PG_BIN/psql -c \"CREATE DATABASE $HONCHO_DB_NAME OWNER $HONCHO_DB_USER;\""
# Enable pgvector extension
su - postgres -c "$PG_BIN/psql -d $HONCHO_DB_NAME -c 'CREATE EXTENSION IF NOT EXISTS vector;'" 2>/dev/null || true

# ─── Honcho configuration ──────────────────────────────────────────────────
HONCHO_CONFIG="/data/.hermes/honcho.json"
if [ ! -f "$HONCHO_CONFIG" ]; then
  echo "=== Creating default Honcho config ==="
  cat > "$HONCHO_CONFIG" <<'HONCHO_EOF'
{
  "apiKey": "",
  "baseUrl": "http://127.0.0.1:8000",
  "workspace": "hermes",
  "peerName": "user",
  "enabled": false,
  "recallMode": "hybrid",
  "contextCadence": 2,
  "dialecticCadence": 3,
  "dialecticDepth": 1,
  "dialecticReasoningLevel": "low",
  "dialecticMaxChars": 600,
  "writeFrequency": "async",
  "saveMessages": true,
  "sessionStrategy": "per-directory",
  "hosts": {
    "hermes": {
      "aiPeer": "hermes",
      "recallMode": "hybrid"
    }
  }
}
HONCHO_EOF
fi

# ─── Honcho server environment ─────────────────────────────────────────────
export HONCHO_DB_URI="postgresql+psycopg://$HONCHO_DB_USER:$HONCHO_DB_PASS@localhost:5432/$HONCHO_DB_NAME"
export HONCHO_BASE_URL="http://127.0.0.1:8000"

# LLM keys for Honcho's background processing (deriver, summary, dialectic)
# These should be set in /data/.hermes/.env or Railway environment variables
# Honcho reads from its own env vars: LLM_GEMINI_API_KEY, LLM_ANTHROPIC_API_KEY, LLM_OPENAI_API_KEY
# For OpenRouter-backed models, set the base_url in honcho.json overrides
[ -f /data/.hermes/.env ] && set -a && . /data/.hermes/.env && set +a

# Start Honcho API server in background
if [ -d /opt/honcho/.venv ] && [ -f /opt/honcho/src/main.py ]; then
  echo "=== Starting Honcho API server ==="
  /opt/honcho/.venv/bin/fastapi run --host 127.0.0.1 --port 8000 /opt/honcho/src/main.py \
    > /data/.hermes/logs/honcho-api.log 2>&1 &
  HONCHO_API_PID=$!
  echo "Honcho API PID: $HONCHO_API_PID"

  # Run database migrations
  echo "=== Running Honcho database migrations ==="
  cd /opt/honcho && /opt/honcho/.venv/bin/python scripts/provision_db.py 2>&1 || \
    echo "WARNING: Honcho migration failed (may be first boot, retrying after API starts)"

  # Start deriver worker in background
  echo "=== Starting Honcho deriver worker ==="
  /opt/honcho/.venv/bin/python -m src.deriver \
    > /data/.hermes/logs/honcho-deriver.log 2>&1 &
  HONCHO_DERIVER_PID=$!
  echo "Honcho deriver PID: $HONCHO_DERIVER_PID"
fi

# ─── Hermes startup (unchanged from here) ─────────────────────────────────

# Fix: ensure .git ownership matches the current container user.
# Railway mounts /data as a persistent volume whose ownership can lag behind
# image changes (e.g. after switching between root and hermes user). Without
# this, git operations fail with "detected dubious ownership in repository".
chown -R "$(id -u):$(id -g)" /data/hermes-agent-template/.git 2>/dev/null || true

# Mirror dashboard-ref-only's startup: create every directory hermes expects
# and seed a default config.yaml if the volume is empty. Without these,
# `hermes dashboard` endpoints that hit logs/, sessions/, cron/, etc. can fail
# with opaque errors even though no auth is actually involved.
mkdir -p /data/.hermes/cron /data/.hermes/sessions /data/.hermes/logs \
         /data/.hermes/memories /data/.hermes/skills /data/.hermes/pairing \
         /data/.hermes/hooks /data/.hermes/image_cache /data/.hermes/audio_cache \
         /data/.hermes/workspace /data/.hermes/skins /data/.hermes/plans \
         /data/.hermes/home \
         /data/media

if [ ! -f /data/.hermes/config.yaml ] && [ -f /opt/hermes-agent/cli-config.yaml.example ]; then
  cp /opt/hermes-agent/cli-config.yaml.example /data/.hermes/config.yaml
fi

[ ! -f /data/.hermes/.env ] && touch /data/.hermes/.env

# Inject SQLite mmap_size PRAGMA into hermes_state.py if not present.
# /opt/hermes-agent/ is rebuilt on every Railway deploy, so this patch
# must be re-applied each boot. 256MB mmap lets the OS manage SQLite
# pages via page cache instead of malloc — evicts cold pages under pressure.
STATE_PY="/opt/hermes-agent/hermes_state.py"
if [ -f "$STATE_PY" ] && ! grep -q "mmap_size" "$STATE_PY" 2>/dev/null; then
  sed -i '/PRAGMA foreign_keys=ON/a\                # Memory-mapped I/O: OS manages SQLite pages via page cache.\n                # Under pressure, cold DB pages evict to disk automatically.\n                self._conn.execute("PRAGMA mmap_size=268435456")' "$STATE_PY" 2>/dev/null || true
  # Clear Python bytecode cache so the patched file is imported fresh
  find /opt/hermes-agent -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
fi

# Bootstrap OAuth tokens from env var (e.g. xAI Grok SuperGrok).
# Set HERMES_AUTH_JSON_BOOTSTRAP to the contents of a locally-generated
# ~/.hermes/auth.json. Written only once — subsequent token refreshes update
# the file in place on the persistent volume.
if [ ! -f /data/.hermes/auth.json ] && [ -n "${HERMES_AUTH_JSON_BOOTSTRAP}" ]; then
  printf '%s' "${HERMES_AUTH_JSON_BOOTSTRAP}" > /data/.hermes/auth.json
  chmod 600 /data/.hermes/auth.json
fi

# Clear any stale gateway PID file left over from the previous container.
# `hermes gateway` writes /data/.hermes/gateway.pid on start but does not
# remove it on SIGTERM. Since /data is a persistent volume, the file
# survives container restarts and causes every subsequent boot to exit with
# "ERROR gateway.run: PID file race lost to another gateway instance".
# No hermes process can be running at this point (we're pre-exec in a fresh
# container), so removing the file unconditionally is safe.
rm -f /data/.hermes/gateway.pid

# Stamp install method as "docker" so the dashboard's "Update Hermes" button
# refuses with the pull-a-fresh-image message. The real upgrade path is
# bumping HERMES_REF in the Dockerfile and redeploying.
mkdir -p "$HERMES_HOME"
echo "docker" > "$HERMES_HOME/.install_method"

# Install Python dependencies for translation scripts
if [ -f /data/media/scripts/requirements.txt ]; then
  pip install -q -r /data/media/scripts/requirements.txt 2>/dev/null || true
fi

# Auto-sync dashboard plugins from the repo into hermes's plugin directory.
# The Dockerfile doesn't COPY plugins/ (it's dev-time code in the repo), but
# hermes discovers dashboard plugins from ~/.hermes/plugins/<name>/dashboard/.
# On Railway, the repo lives at /data/hermes-agent-template/ on the persistent
# volume, so we sync plugin dashboards on every boot to pick up changes
# without a full image rebuild.
REPO="/data/hermes-agent-template"
REPO_PLUGINS="$REPO/plugins"
HERMES_PLUGINS="$HERMES_HOME/plugins"

# If a backup was restored, skip git pull + plugin sync to avoid re-fetching
# broken upstream code. Remove the flag after fixing origin/main:
#   rm /data/.hermes/.skip_git_pull
if [ -f "$HERMES_HOME/.skip_git_pull" ]; then
  echo "⚠️  .skip_git_pull found — skipping git pull and plugin sync (backup restore mode)"
  echo "   Remove with: rm /data/.hermes/.skip_git_pull"
else
  # Pull latest from GitHub before syncing (ensures deploy picks up pushed changes)
  if [ -d "$REPO/.git" ]; then
    cd "$REPO" && git pull --ff-only origin main 2>/dev/null || true
  fi

  if [ -d "$REPO_PLUGINS" ]; then
    for plugin_dir in "$REPO_PLUGINS"/*/dashboard; do
      [ -d "$plugin_dir" ] || continue
      plugin_name="$(basename "$(dirname "$plugin_dir")")"
      dest="$HERMES_PLUGINS/$plugin_name/dashboard"
      mkdir -p "$dest"
      # Nuke old dist/python to avoid stale files, then copy fresh
      rm -rf "$dest"
      mkdir -p "$dest"
      cp -a "$plugin_dir/." "$dest/"
    done
  fi
fi

exec python /app/server.py
