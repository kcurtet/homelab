#!/usr/bin/env bash
# Daily image updates for the homelab: every compose stack + every dokku app.
# Replaces watchtower (containrrr image is dead: API client 1.25 vs Docker 29).
# Run manually: monitoring/update.sh   |   systemd: homelab-update.timer 04:00
#
# EDGE GATE: a stack dir may carry an `update.skip` file — one compose service
# name per line. Skipped services are neither pulled nor recreated: a breaking
# release of the reverse proxy must not take the lab down at 04:00 unattended.
# Manual update of a skipped service:
#   cd <stack> && docker compose pull <service> && docker compose up -d <service>
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_TAG=homelab-update

log() { logger -t "$LOG_TAG" -s "$*"; }

# Compose stacks (every phase dir with a docker-compose.yml)
while IFS= read -r compose_file; do
  dir="$(dirname "$compose_file")"
  skip_file="$dir/update.skip"
  mapfile -t services < <( (cd "$dir" && docker compose config --services) )

  # filter out services listed in update.skip AND services not deployed
  # (no running container): inert phases (e.g. cloudflared without a token)
  # must not be `up`-ed into crash-loops by the nightly run.
  to_update=()
  for s in "${services[@]}"; do
    if [[ -f "$skip_file" ]] && grep -qx "$s" "$skip_file"; then
      log "skip (update.skip): $dir/$s"
      continue
    fi
    if [[ -z "$(cd "$dir" && docker compose ps -q --status running "$s" 2>/dev/null)" ]]; then
      log "skip (not deployed): $dir/$s"
      continue
    fi
    to_update+=("$s")
  done
  [[ ${#to_update[@]} -eq 0 ]] && continue

  log "compose: $dir [${to_update[*]}]"
  (cd "$dir" && docker compose pull --quiet --ignore-buildable "${to_update[@]}" \
    && docker compose up -d --remove-orphans "${to_update[@]}")
done < <(find "$REPO" -name docker-compose.yml -not -path "*/data/*" -not -path "*/node_modules/*")

# Dokku apps: re-pull base images and redeploy
if command -v dokku >/dev/null 2>&1; then
  DOKKU="dokku"
  [ "$(id -u)" -ne 0 ] && DOKKU="sudo -n dokku"
  if "$DOKKU" apps:list 2>/dev/null | grep -qE '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'; then
    log "dokku: ps:rebuild --all"
    "$DOKKU" ps:rebuild --all >/dev/null
  fi
fi

docker image prune --force >/dev/null
log "done"
