#!/usr/bin/env bash
# Daily image updates for the homelab: every compose stack + every dokku app.
# Replaces watchtower (containrrr image is dead: API client 1.25 vs Docker 29).
# Run manually: monitoring/update.sh   |   systemd: homelab-update.timer 04:00
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_TAG=homelab-update

log() { logger -t "$LOG_TAG" -s "$*"; }

# Compose stacks (every phase dir with a docker-compose.yml)
while IFS= read -r compose_file; do
  dir="$(dirname "$compose_file")"
  log "compose: $dir"
  (cd "$dir" && docker compose pull --quiet && docker compose up -d --remove-orphans)
done < <(find "$REPO" -name docker-compose.yml -not -path "*/data/*" -not -path "*/node_modules/*")

# Dokku apps: re-pull base images and redeploy
if command -v dokku >/dev/null 2>&1; then
  DOKKU="dokku"
  [ "$(id -u)" -ne 0 ] && DOKKU="sudo -n dokku"
  if "$DOKKU" apps:list 2>/dev/null | grep -qE '^  +[a-zA-Z0-9]'; then
    log "dokku: ps:rebuild --all"
    "$DOKKU" ps:rebuild --all >/dev/null
  fi
fi

docker image prune --force >/dev/null
log "done"
