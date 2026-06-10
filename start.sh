#!/bin/bash
set -e

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

# Auto-sync dashboard plugins from the repo into hermes's plugin directory.
# The Dockerfile doesn't COPY plugins/ (it's dev-time code in the repo), but
# hermes discovers dashboard plugins from ~/.hermes/plugins/<name>/dashboard/.
# On Railway, the repo lives at /data/hermes-agent-template/ on the persistent
# volume, so we sync plugin dashboards on every boot to pick up changes
# without a full image rebuild.
REPO_PLUGINS="/data/hermes-agent-template/plugins"
HERMES_PLUGINS="$HERMES_HOME/plugins"
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

exec python /app/server.py
