#!/usr/bin/env bash
# Toggle the public face (jellyfin.kcurtet.com) on/off.
# The tunnel is just a container: stopped = the hostname answers 530,
# nothing is exposed. The nightly updater only touches RUNNING services,
# so "off" stays off.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOST="jellyfin.kcurtet.com"

check_public() {
  # resolve via a public resolver: local ISP caches NXDOMAIN for a while
  ip=$(dig +short +time=4 "$HOST" @1.1.1.1 | grep -E '^[0-9]+\.' | head -1)
  if [ -z "$ip" ]; then echo "público → sin DNS"; return; fi
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    --resolve "$HOST:443:$ip" "https://$HOST/" || echo 000)
  [ "$code" = "000" ] && echo "público → inalcanzable (túnel off)" \
                      || echo "público → HTTP $code"
}

case "${1:-}" in
  on)
    sudo docker compose start cloudflared
    echo "tunnel: ON → https://$HOST"
    ;;
  off)
    sudo docker compose stop cloudflared
    echo "tunnel: OFF — hostname público muerto"
    ;;
  status)
    st=$(sudo docker compose ps cloudflared --format '{{.Status}}' || true)
    echo "cloudflared: ${st:-parado}"
    check_public
    ;;
  *)
    echo "uso: tunnel.sh on|off|status" >&2; exit 1 ;;
esac
