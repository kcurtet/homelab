#!/usr/bin/env bash
# generate-config.sh — seed data/conf/AdGuardHome.yaml for AdGuard Home's
# first boot.
#
# WHY THIS EXISTS (design decision):
#   AdGuard Home is configured by AdGuardHome.yaml, not by environment
#   variables. The two possible approaches, and the trade-off accepted:
#
#   a) First-run web wizard: interactive; the choices land only in the
#      running data dir, nothing reproducible in the repo, and the DHCP
#      failover option-6 line is not wizard- or UI-editable at all.
#   b) Pre-seeded config (CHOSEN): this script renders the YAML from .env
#      before the first `docker compose up`. The repo stays the source of
#      truth for the INITIAL state; every knob (pool, gateway, DNS failover
#      pair, web password hash) is a variable.
#
#   Trade-off: after first boot the LIVE yaml becomes the source of truth
#   (the web UI rewrites it on every change), so this seed runs exactly
#   once — it refuses to overwrite an existing config unless --force is
#   passed. --force resets any UI-era changes (filters, clients, rewrites,
#   query log settings): export ./data/conf first if you care.
#
#   Plain bash + heredoc on purpose: no envsubst (gettext is not installed by
#   default on Raspberry Pi OS), no python, no docker required on the host.
#
# Sources (checked 2026-11-06):
#   - Config schema: github.com/AdguardTeam/AdGuardHome/wiki/Configuration
#   - DHCP option 6 `ips` syntax + "include AdGuard Home's own address"
#     warning: github.com/AdguardTeam/AdGuardHome/wiki/DHCP
#     (up-to-date mirror: adguard-dns.io/kb/adguard-home/dhcp/)
#   - schema_version 34 = expected by v0.107.80 (verified live: without it
#     the app's config migrator silently drops the dhcpv4 section; with it
#     the file parses as-is). When bumping the image tag, let the app
#     upgrade an existing config itself (it writes the new version on save)
#     — only fresh seeds need the current number.
#   - bcrypt hash: htpasswd -B -C 10 (wiki Configuration, "Reset web
#     password"); $2a$/$2b$/$2y$ markers all accepted (verified live).
#   - Editing rule: only edit the yaml while the container is stopped
#     (official Docker KB — the running app overwrites concurrent edits).
#
# Usage:
#   cp .env.example .env && $EDITOR .env   # set ADGUARD_PASSWORD_HASH at least
#   ./generate-config.sh                   # writes data/conf/AdGuardHome.yaml
#   docker compose up -d

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$SCRIPT_DIR/.env"
CONF_DIR="$SCRIPT_DIR/data/conf"
WORK_DIR="$SCRIPT_DIR/data/work"
CONF_FILE="$CONF_DIR/AdGuardHome.yaml"

die() {
    printf 'generate-config.sh: ERROR: %s\n' "$*" >&2
    exit 1
}

info() {
    printf 'generate-config.sh: %s\n' "$*"
}

# Load KEY=VALUE lines without executing anything — same parser and
# precedence as backup/restic/backup.sh: real environment variables first,
# then .env next to this script (gitignored), if present.
load_env_file() {
    local file=$1 line key val
    while IFS= read -r line || [[ -n "$line" ]]; do
        line=${line%%#*}
        [[ -z "${line//[[:space:]]/}" ]] && continue
        [[ "$line" == *=* ]] || continue
        key=${line%%=*}
        val=${line#*=}
        key=${key#"${key%%[![:space:]]*}"}; key=${key%"${key##*[![:space:]]}"}
        val=${val#"${val%%[![:space:]]*}"}; val=${val%"${val##*[![:space:]]}"}
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        if [[ ${#val} -ge 2 && ( "$val" == \"*\" || "$val" == \'*\' ) ]]; then
            val=${val:1:${#val}-2}
        fi
        if [[ -z "${!key:-}" ]]; then
            printf -v "$key" '%s' "$val"
            export "${key?}"
        fi
    done < "$file"
}

[[ -f "$ENV_FILE" ]] && load_env_file "$ENV_FILE"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
    FORCE=1
elif [[ -n "${1:-}" ]]; then
    die "unknown argument: $1 (only --force is supported)"
fi

### Required values ###########################################################

: "${ADGUARD_USERNAME:=admin}"
: "${ADGUARD_HOST_IP:?set ADGUARD_HOST_IP in .env (see .env.example)}"
: "${ADGUARD_DNS2_ROUTER:?set ADGUARD_DNS2_ROUTER in .env (see .env.example)}"
: "${ADGUARD_PASSWORD_HASH:?set ADGUARD_PASSWORD_HASH in .env — generate with htpasswd (command in .env.example)}"
: "${ADGUARD_DHCP_ENABLED:=false}"
: "${ADGUARD_INTERFACE:=eth0}"
: "${ADGUARD_DHCP_START:=192.168.1.201}"
: "${ADGUARD_DHCP_END:=192.168.1.250}"
: "${ADGUARD_DHCP_GATEWAY:=192.168.1.1}"
: "${ADGUARD_DHCP_NETMASK:=255.255.255.0}"
: "${ADGUARD_DHCP_LEASE_DURATION:=86400}"
: "${ADGUARD_WEB_ADDR:=0.0.0.0:3000}"

IP_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
valid_ip() {
    local ip=$1 o
    [[ "$ip" =~ $IP_RE ]] || return 1
    IFS=. read -r -a o <<< "$ip"
    for part in "${o[@]}"; do
        (( 10#$part <= 255 )) || return 1
    done
}

[[ "$ADGUARD_PASSWORD_HASH" == '$2'[aby]'$'* ]] \
    || die "ADGUARD_PASSWORD_HASH does not look like a bcrypt hash (\$2a\$/\$2b\$/\$2y\$…). Generate one with the htpasswd command in .env.example"

valid_ip "$ADGUARD_HOST_IP" || die "ADGUARD_HOST_IP is not a valid IPv4: $ADGUARD_HOST_IP"
valid_ip "$ADGUARD_DNS2_ROUTER" || die "ADGUARD_DNS2_ROUTER is not a valid IPv4: $ADGUARD_DNS2_ROUTER"
[[ "$ADGUARD_HOST_IP" != "$ADGUARD_DNS2_ROUTER" ]] \
    || die "ADGUARD_HOST_IP and ADGUARD_DNS2_ROUTER are the same ($ADGUARD_HOST_IP): option 6 needs two DIFFERENT resolvers (host, router)"

[[ "$ADGUARD_DHCP_LEASE_DURATION" =~ ^[0-9]+$ ]] || die "ADGUARD_DHCP_LEASE_DURATION must be seconds (integer), got: $ADGUARD_DHCP_LEASE_DURATION"

### House rule: DHCP off unless explicitly forced #############################

if [[ "$ADGUARD_DHCP_ENABLED" == "true" ]]; then
    cat >&2 <<WARNING
generate-config.sh: WARNING
    You are seeding with the DHCP server ENABLED. House rule: the router stays
    the only DHCP server unless docs/runbooks/dhcp-migration.md is being
    followed BY HAND on the final host (Raspberry era). Two DHCP servers on
    the same LAN break connectivity for every device.
WARNING
    if [[ $FORCE -ne 1 ]]; then
        die "refusing to seed with DHCP enabled — pass --force if this is really the migration runbook"
    fi
    info "--force given: seeding with DHCP enabled (dangerous window is OPEN)"
fi

### Guard the existing live config ############################################

if [[ -f "$CONF_FILE" && $FORCE -ne 1 ]]; then
    die "$CONF_FILE already exists — the live config is the source of truth after first boot. Edit it with the container STOPPED, or re-run with --force to reset everything to the seed (UI-era changes are LOST)."
fi

### Write the seed ############################################################

mkdir -p "$CONF_DIR" "$WORK_DIR"
chmod 700 "$WORK_DIR" # quiet the app's permcheck (work dir wants 0700)

# NOTE (upstream DNS): plain-IP upstreams keep first boot dependency-free;
#   encrypted upstreams (https://dns.quad9.net/dns-query, tls://…, quic://…)
#   can be switched on later in the UI (Settings → DNS settings). Bootstrap
#   entries only matter for hostname-based upstreams.
# NOTE (filters): left empty ON PURPOSE — v0.107.80 auto-installs the default
#   "AdGuard DNS filter" (id 1) on first boot; verified live (rules_count
#   190193 fetched at startup). Add more lists via the UI (Filters → DNS
#   blocklists).
cat > "$CONF_FILE" <<EOF
schema_version: 34
# Seeded by network/adguardhome/generate-config.sh — first-boot snapshot.
# After first boot this file is the live source of truth (the web UI rewrites
# it). Edit it ONLY while the container is stopped (official Docker KB), or
# through the web UI — except dhcp.dhcpv4.options, which is not UI-editable
# (yaml + stopped container only).
http:
  address: ${ADGUARD_WEB_ADDR}
users:
  - name: ${ADGUARD_USERNAME}
    password: ${ADGUARD_PASSWORD_HASH}
auth_attempts: 5
block_auth_min: 15
theme: auto
language: en
dns:
  bind_hosts:
    - 0.0.0.0
  port: 53
  # Failover pair advertised by DHCP lives below (option 6); these upstreams
  # are where AdGuard Home itself forwards non-blocked queries.
  upstream_dns:
    - 9.9.9.9
    - 149.112.112.112
    - 1.1.1.1
    - 8.8.8.8
  bootstrap_dns:
    - 9.9.9.9
    - 149.112.112.112
dhcp:
  enabled: ${ADGUARD_DHCP_ENABLED}
  interface_name: ${ADGUARD_INTERFACE}
  dhcpv4:
    gateway_ip: ${ADGUARD_DHCP_GATEWAY}
    subnet_mask: ${ADGUARD_DHCP_NETMASK}
    range_start: ${ADGUARD_DHCP_START}
    range_end: ${ADGUARD_DHCP_END}
    lease_duration: ${ADGUARD_DHCP_LEASE_DURATION}
    icmp_timeout_msec: 300
    # DNS FAILOVER: DNS1 = this host (literal IP — AdGuard Home has no
    # 0.0.0.0 self-placeholder), DNS2 = the router. The official DHCP docs
    # warn: when setting option 6, include AdGuard Home's own address or
    # clients bypass its filtering.
    options:
      - 6 ips ${ADGUARD_HOST_IP},${ADGUARD_DNS2_ROUTER}
EOF

info "wrote $CONF_FILE"
info "  web UI/API:      ${ADGUARD_WEB_ADDR} (user: ${ADGUARD_USERNAME})"
info "  DHCP:            ${ADGUARD_DHCP_ENABLED} (pool ${ADGUARD_DHCP_START}–${ADGUARD_DHCP_END}, gateway ${ADGUARD_DHCP_GATEWAY})"
info "  DNS failover:    DNS1=${ADGUARD_HOST_IP} (this host), DNS2=${ADGUARD_DNS2_ROUTER} (router)"
info "next: docker compose up -d   (then open http://<host>:3000 and log in)"
