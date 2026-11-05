#!/usr/bin/env bash
# forget.sh — apply the retention policy to the homelab restic repository.
#
# Policy (same as documented in backup/README.md):
#   keep 7 daily, 4 weekly, 6 monthly snapshots; prune everything else.
# Run after (or alongside) backup.sh — the systemd unit chains it via
# ExecStartPost=.
#
# Configuration: same rules as backup.sh — environment variables (systemd
# EnvironmentFile=, exports) win over backup/.env, which is parsed as pure
# data (KEY=VALUE lines only, never sourced, never evaluated).
#
# Exit codes:
#   0  policy applied
#   1  restic forget failed
#   2  configuration problem (missing values, bad password file)
#   3  restic not installed
#   4  repository unreachable / not initialized

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$REPO_ROOT/backup/.env"

die() {
    local code=$1
    shift
    printf 'forget.sh: ERROR: %s\n' "$*" >&2
    exit "$code"
}

info() {
    printf 'forget.sh: %s\n' "$*"
}

warn() {
    printf 'forget.sh: WARN: %s\n' "$*" >&2
}

# Load KEY=VALUE lines without executing anything (identical to backup.sh).
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

[[ -f "$RESTIC_PASSWORD_FILE" ]] || die 2 "password file not found: $RESTIC_PASSWORD_FILE"
PASS_MODE=$(stat -c %a "$RESTIC_PASSWORD_FILE")
[[ "$PASS_MODE" == "600" ]] || die 2 "password file must be chmod 600 (is $PASS_MODE): $RESTIC_PASSWORD_FILE"

### Repository must already exist (backup.sh initializes on first run) ########

restic snapshots --compact >/dev/null 2>&1 || die 4 "repository unreachable or not initialized: $RESTIC_REPOSITORY (run backup.sh first)"

### Apply the policy ##########################################################

info "applying retention policy to: $RESTIC_REPOSITORY"
info "keep: 7 daily, 4 weekly, 6 monthly — prune the rest"

# --prune reclaims disk space on the USB drive right away instead of leaving
# it to some future manual run.
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
    || die 1 "restic forget failed (exit $?)"

info "retention policy applied"
