# Build status

| Piece | Status |
|-------|--------|
| Phase 1 — Dokku hosting (push-to-deploy) | **Live on panther** (AUR overlay 0.38.34 + Traefik edge; sample app verified) |
| Phase 1 — Cloudflare Tunnel | Documented and inert — **pending account/domain** |
| Phase 1 — Let's Encrypt | Documented (two TLS paths); activates with a domain |
| Phase 2 — Tailscale | Doc verified against a live tailnet |
| Phase 2 — Wake-on-LAN | Educational script + docs (no wakeable target today) |
| Phase 3 — AdGuard Home DNS/DHCP | **Live (staging test)** on panther — DNS bound to LAN 192.168.1.100 only, DHCP **off**, opt-in (point devices by hand); adblock + internal-zone rewrite verified. Raspberry era: house-wide + DHCP per runbook (**pending hardware**) |
| Phase 4 — restic backups | **Live (staging)** on panther — repo provisional en `/data` (el titular lo limpiará pronto: directorio regenerable, password fuera en `/etc/homelab`); real snapshot 29.6 GiB + restore spot-check OK; timer 03:00. Target final: disco USB en la Raspberry (**pendiente hardware**) |
| Dashboard — status + actions UI | **Live on panther** (traefik vhost `dashboard.int.ntux.link`; EXPECTED_PROJECTS → monitoring/splitdns/dashboard) |
| Monitoring — traefik + uptime-kuma + update timer | Live on panther (rootful docker); migrated from podman quadlets |
| Split-DNS — tailnet `*.int.ntux.link` | Live on panther (dnsmasq, tailscale IP only); migrated from podman |

Design and build artifacts (spec, plan, rulings ledger) live under `specs/` in
Spanish — the working log of how this was designed and built.
