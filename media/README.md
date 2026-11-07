# Media — *arr automation + Jellyfin (behind traefik, downloads in VPN)

The request-to-library pipeline: ask for a film or show (Jellyseerr), the
*arrs find it (Prowlarr → Sonarr/Radarr), qBittorrent fetches it sealed
inside a Proton VPN tunnel (gluetun), Unpackerr extracts, and Jellyfin plays
it on any tailnet device.

## Topology

```
peticiones.int.ntux.link → jellyseerr ─┐
sonarr.int.ntux.link    → sonarr ──────┼─ prowlarr (indexers)
radarr.int.ntux.link    → radarr ──────┘        │
prowlarr.int.ntux.link  → prowlarr              ▼
jellyfin.int.ntux.link  → jellyfin ← library   gluetun (Proton VPN)
                                        └── qbittorrent (:8080 host port)
                                            + port-forwarder + unpackerr
```

qBittorrent has **no vhost by design**: it shares gluetun's network
namespace, so its WebUI is published by gluetun as `http://<host>:8080`
(LAN + tailnet IP). If the tunnel drops, downloads stop — that is the point.

## Storage (on /data, NOT in restic scope)

| Path | Role |
|---|---|
| `/data/media/downloads` | qBittorrent download dir |
| `/data/media/movies` | Radarr library |
| `/data/media/tv` | Sonarr library |
| `media/data/*` | Container state (gitignored) |

Media is big and re-fetchable; the lab backup covers the repo, monitoring
state and `/home` — not media files.

## First boot

```bash
cd media
cp .env.example .env    # fill PROTON_USER/PASS (Proton dashboard, OpenVPN creds)
docker compose up -d
docker logs gluetun 2>&1 | tail -5      # wait for "unblocked" / healthy
```

Then, in order:

1. **qBittorrent**: temporary password in `docker logs qbittorrent | grep -i
   password` → log in at `http://<host>:8080` → set permanent password →
   put it in `.env` (`QBT_PASSWORD`) → `docker compose up -d
   qbittorrent-port-forwarder`.
2. **Prowlarr** (`prowlarr.int.ntux.link`): add your indexers, then *Apps →
   Add Sonarr/Radarr* so they sync automatically.
3. **Sonarr/Radarr**: download client = qBittorrent at
   `http://192.168.1.100:8080` (host-published — they are not inside the
   VPN netns); root folders `/tv`, `/movies`.
4. **API keys** → `.env` (`SONARR_API_KEY`, `RADARR_API_KEY`) → `docker
   compose up -d unpackerr`.
5. **Jellyfin**: first-run wizard, add libraries `/media/movies`,
   `/media/tv`. Hardware transcode: Intel QSV is passed via `/dev/dri`.
6. **Jellyseerr** (`peticiones.int.ntux.link`): point it at Jellyfin +
   Sonarr/Radarr.

## Indexer tags (the part everyone trips on)

Prowlarr applies **indexer proxies by TAG** — a proxy with no matching tag
applies to nothing. Two lanes are wired:

| Tag | Proxy | For |
|---|---|---|
| `cf` | FlareSolverr (21hsmw fork — the official image can't solve modern CF) | indexers behind Cloudflare (EZTV) |
| `vpn` | gluetun built-in HTTP proxy (:8888 via Proton) | ISP-blocked domains (0dayfiles.net, TLS reset by SNI filtering) |

Add the tag when creating the indexer (or edit it after). ISP context:
Spanish resolvers sinkhole blocked domains (127.0.0.1) and some domains
also fail TLS from home IPs — container DNS goes through AdGuard (see
docker-host.md), VPN-tagged indexers escape entirely.

## Notes

- **Port forwarding** (better peering) needs a **paid** Proton plan; on
  free plans gluetun logs a warning and everything still works, just with
  fewer peers.
- NVENC instead of QSV: add `runtime: nvidia` + `deploy.resources` to
  jellyfin (driver already on the host).
- The nightly updater (`monitoring/update.sh`) picks this stack up
  automatically — nothing pinned.
