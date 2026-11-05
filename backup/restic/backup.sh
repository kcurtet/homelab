#!/usr/bin/env bash
# backup.sh — restic snapshot of the fixed homelab scope.
#
# Scope (spec: lab state + /home of the host running the timer — no rootfs):
#   hosting/coolify/data  Coolify state
#   network/pihole/data   Pi-hole config
#   .                     this repo (infrastructure as code)
#   /home                 host home dirs
# The actual list comes from BACKUP_PATHS (see backup/.env.example).
#
# Configuration precedence — the same script serves manual runs and the
# systemd unit:
#   1. Real environment variables (systemd EnvironmentFile=, or exports).
#   2. backup/.env next to this script (gitignored), if present.
# The .env file is parsed as pure data: lines are KEY=VALUE only, never
# sourced, never evaluated. Environment values always win over the file.
#
# Exit codes:
#   0  snapshot created
#   1  restic backup failed
#   2  configuration problem (missing values, bad password file)
#   3  restic not installed
#   4  repository unreachable or init failed

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$REPO_ROOT/backup/.env"

die() {
    local code=$1
    shift
    printf 'backup.sh: ERROR: %s\n' "$*" >&2
    exit "$code"
}

info() {
    printf 'backup.sh: %s\n' "$*"
}

warn() {
    printf 'backup.sh: WARN: %s\n' "$*" >&2
}

# Load KEY=VALUE lines without executing anything. Quotes around values are
# stripped; malformed lines are skipped with a warning, not fatal.
load_env_file() {
    local file=$1 line key val
    while IFS= read -r line || [[ -n "$line" ]]; do
        line=${line%%#*}                       # strip comments
        [[ -z "${line//[[:space:]]/}" ]] && continue
        [[ "$line" == *=* ]] || { warn "skipping malformed .env line: $line"; continue; }
        key=${line%%=*}
        val=${line#*=}
        # trim whitespace (bash-only, no external processes)
        key=${key#"${key%%[![:space:]]*}"}; key=${key%"${key##*[![:space:]]}"}
        val=${val#"${val%%[![:space:]]*}"}; val=${val%"${val##*[![:space:]]}"}
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { warn "skipping malformed .env line: $line"; continue; }
        # strip one matching pair of surrounding quotes, if present
        if [[ ${#val} -ge 2 && ( "$val" == \"*\" || "$val" == \'*\' ) ]]; then
            val=${val:1:${#val}-2}
        fi
        # environment (systemd EnvironmentFile or manual export) wins over file.
        # Values from the file are exported so child processes (restic) see them.
        if [[ -z "${!key:-}" ]]; then
            printf -v "$key" '%s' "$val"
            export "${key?}"
        fi
    done < "$file"
}

if [[ -f "$ENV_FILE" ]]; then
    load_env_file "$ENV_FILE"
fi

### Prerequisites #############################################################

command -v restic >/dev/null 2>&1 || die 3 "restic not found in PATH (Arch: pacman -S restic / Debian: apt install restic)"

[[ -n "${RESTIC_REPOSITORY:-}" ]] || die 2 "RESTIC_REPOSITORY not set (see backup/.env.example)"
[[ -n "${RESTIC_PASSWORD_FILE:-}" ]] || die 2 "RESTIC_PASSWORD_FILE not set (see backup/.env.example)"
[[ -n "${BACKUP_PATHS:-}" ]] || die 2 "BACKUP_PATHS not set (see backup/.env.example)"

[[ -f "$RESTIC_PASSWORD_FILE" ]] || die 2 "password file not found: $RESTIC_PASSWORD_FILE (generate one, chmod 600, outside the repo)"
PASS_MODE=$(stat -c %a "$RESTIC_PASSWORD_FILE")
[[ "$PASS_MODE" == "600" ]] || die 2 "password file must be chmod 600 (is $PASS_MODE): $RESTIC_PASSWORD_FILE"

### Repository: use it, or initialize on first run ############################

if ! restic snapshots --compact >/dev/null 2>&1; then
    info "repository not initialized (or unreachable) at: $RESTIC_REPOSITORY"
    info "running: restic init"
    restic init || die 4 "restic init failed — check RESTIC_REPOSITORY (mounted? writable?) and the password file"
fi

### Resolve BACKUP_PATHS against the repo root ################################

PATHS=()
read -r -a RAW_PATHS <<< "$BACKUP_PATHS"
for entry in "${RAW_PATHS[@]}"; do
    if [[ "$entry" == /* ]]; then
        resolved=$entry
    else
        resolved="$REPO_ROOT/$entry"
    fi
    if [[ -e "$resolved" ]]; then
        PATHS+=("$resolved")
    else
        warn "skipping missing path: $resolved"
    fi
done
[[ ${#PATHS[@]} -gt 0 ]] || die 2 "no existing paths left to back up — check BACKUP_PATHS"

### Snapshot ##################################################################

info "backing up ${#PATHS[@]} path(s) to: $RESTIC_REPOSITORY"
for p in "${PATHS[@]}"; do
    info "  - $p"
done

# --exclude .cache/restic: /home includes restic's own local cache, which is
# disposable index data — snapshotting it only bloats the repo.
restic backup --exclude .cache/restic "${PATHS[@]}" || die 1 "restic backup failed (exit $?)"

info "snapshot created"
