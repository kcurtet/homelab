#!/bin/bash
# Entry point of the manual-backup container (dashboard/backup.Dockerfile).
#
# Loads /etc/homelab/backup.env — the same file the host's systemd timer
# reads via EnvironmentFile — and execs CMD. The file is parsed as PURE DATA
# (KEY=VALUE lines, never sourced, never evaluated): the rules mirror
# backup.sh's own loader, and values already present in the environment win.
#
# The default CMD is /repo/backup/restic/backup.sh, which therefore sees the
# same configuration it sees under the timer. Read-only modes (the status
# card's `restic snapshots --json`) reuse this entrypoint by overriding CMD.
set -eu

env_file="${BACKUP_ENV_FILE:-/etc/homelab/backup.env}"

if [[ -f "$env_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%%#*}                       # strip comments
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" == *=* ]] || continue       # skip malformed lines
    key=${line%%=*}
    val=${line#*=}
    # trim whitespace (bash-only, no external processes)
    key=${key#"${key%%[![:space:]]*}"}; key=${key%"${key##*[![:space:]]}"}
    val=${val#"${val%%[![:space:]]*}"}; val=${val%"${val##*[![:space:]]}"}
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # strip one matching pair of surrounding quotes, if present
    if [[ ${#val} -ge 2 && ( "$val" == \"*\" || "$val" == \'*\' ) ]]; then
      val=${val:1:${#val}-2}
    fi
    # environment wins over the file (same precedence as backup.sh)
    if [[ -z "${!key:-}" ]]; then
      export "$key=$val"
    fi
  done < "$env_file"
fi

exec "$@"
