# Homelab

Reproducible home lab: Pi-hole as house DNS/DHCP with automatic failover, Coolify
self-hosted PaaS published through a Cloudflare Tunnel, Tailscale remote access, and
restic backups to USB. Every phase is plain Docker Compose + runbooks.

Background and design rationale: [docs/topology.md](docs/topology.md).

## Requirements

- A Linux host, always on, with Docker + compose plugin —
  install guide: [docs/runbooks/docker-host.md](docs/runbooks/docker-host.md)
- Each phase lists extra requirements (Tailscale account, Cloudflare domain, USB disk)

## Install

Install in order. Phases are independent, but the order minimizes blast radius.
From a fresh clone, per phase:

### 1. Hosting — Coolify

```bash
cd hosting/coolify
cp .env.example .env        # then fill APP_KEY, DB_PASSWORD (commands inside)
docker compose up -d        # wizard at http://<host>:8000
```

Deploy a sample site and teardown instructions:
[docs/runbooks/hosting.md](docs/runbooks/hosting.md).
Publishing without open ports (Cloudflare Tunnel) and Let's Encrypt are documented
in the same runbook plus [docs/runbooks/cloudflare-tunnel.md](docs/runbooks/cloudflare-tunnel.md)
(requires a Cloudflare account/domain).

### 2. Remote access — Tailscale (+ optional WoL)

Join the tailnet, SSH over the mesh, optionally advertise the LAN as a subnet
route: [remote-access/tailscale.md](remote-access/tailscale.md).
Wake-on-LAN sender (educational): [remote-access/wol/wol.md](remote-access/wol/wol.md).

### 3. DNS/DHCP — Pi-hole

> **Final always-on hardware only.** Never on a laptop or temporary host: taking
> over DHCP affects every device on the network. DHCP ships **disabled by default**.

```bash
cd network/pihole
cp .env.example .env        # ranges, router IP, then follow the migration runbook
```

Full migration order (verify router DNS → Pi-hole DHCP on → router DHCP off →
per-device checks) and rollback: [docs/runbooks/dhcp-migration.md](docs/runbooks/dhcp-migration.md).

### 4. Backups — restic

```bash
cd backup
cp .env.example /etc/homelab/backup.env     # repo path (USB mount), password file
# install units + timer, first run, restore drill:
```

Guide: [backup/README.md](backup/README.md).

### 5. Dashboard — one pane for the lab

Status cards per phase, hub links, whitelisted actions (restart, phase start/stop,
logs, manual backup). Tailscale-only by design:
[docs/runbooks/dashboard.md](docs/runbooks/dashboard.md).

## Verify

Quick checks after install (details in each runbook):

```bash
docker compose config -q                       # in every compose dir: exit 0
dig @<host> example.com                        # Pi-hole answers (phase 3)
tailscale ping <node>                          # mesh reachable (phase 2)
sudo systemctl list-timers homelab-backup.*    # timer scheduled (phase 4)
curl -s http://127.0.0.1:4321/api/status        # dashboard answers (phase 5)
```

## Repository layout

```
hosting/        # coolify/ and cloudflare/ compose (Phase 1)
remote-access/  # tailscale.md + wol/ script (Phase 2)
network/        # pihole/ compose + .env.example (Phase 3)
backup/         # restic scripts + systemd units (Phase 4)
dashboard/      # astro status+actions UI, tailscale-only (Phase 5)
docs/           # topology, runbooks, status
```

Build status of each piece: [docs/status.md](docs/status.md).

## License

[MIT](LICENSE) © Kevin Curtet
