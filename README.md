# Homelab

A reproducible rebuild of my home lab: self-hosted services, network-wide ad blocking,
remote access, and backups — driven entirely by Docker Compose files, scripts, and
runbooks that explain **why** each piece exists, not just how to install it.

This repo doubles as portfolio material for an IT support role: every phase documents
real decisions, trade-offs, failure modes, and rollback paths — the same way I would
handle them for a customer.

## Origin story

The lab was first built and documented by hand in
[Reconstruyendo mi homelab: autohospedaje de cero](https://kcurtet.com/proyectos/homelab/)
(Spanish). That article is the origin story: Pi-hole as house-wide DNS+DHCP, Tailscale +
Wake-on-LAN for remote access, Coolify hosting published through a Cloudflare Tunnel,
and restic backups to an old USB disk.

This repo turns that setup into something anyone (including future me) can clone,
understand, and re-run on any Linux box with Docker — with a couple of design
improvements over the original (see [docs/topology.md](docs/topology.md)).

## Topology

The target topology — internet ↔ router ↔ Raspberry Pi ↔ household devices, plus the
current staging host — is diagrammed and explained in **[docs/topology.md](docs/topology.md)**.

Key design point: **automatic DNS failover**. The router is advertised as secondary DNS,
so if Pi-hole goes down, clients keep internet (ads return) with zero manual switching.

## Phases

The build order is by blast radius: phases that only touch disposable hosts come first,
the shared home network comes last. Follow them in order.

| Order | Phase | Directory | What it teaches |
|-------|-------|-----------|-----------------|
| 1 | [Hosting](hosting/) — Coolify + Cloudflare Tunnel | `hosting/` | Running a PaaS with Compose, publishing services without opening router ports, Let's Encrypt certificates |
| 2 | [Remote access](remote-access/) — Tailscale + Wake-on-LAN | `remote-access/` | Zero-trust remote access, subnet routing, the limits of WoL over Wi-Fi (educational) |
| 3 | [Network](network/) — Pi-hole DNS/DHCP + failover | `network/` | Taking over house DNS+DHCP safely, DHCP migration with rollback, DNS failover trade-offs |
| 4 | [Backups](backup/) — restic to USB | `backup/` | Snapshot backups, retention policy, and the golden rule: a backup without a tested restore is decoration |

Each phase is self-contained in its directory and independently verifiable. Nothing
touches the shared home network until Phase 3, and Phase 3 is only ever applied on the
final Raspberry Pi host.

## Repository layout

```
hosting/        # Coolify + Cloudflare Tunnel (Phase 1)
remote-access/  # Tailscale docs + Wake-on-LAN script (Phase 2)
network/        # Pi-hole compose + DHCP migration runbook (Phase 3)
backup/         # restic scripts + systemd units + restore runbook (Phase 4)
docs/           # Topology, specs, and per-phase runbooks
```

## License

[MIT](LICENSE) © Kevin Curtet
