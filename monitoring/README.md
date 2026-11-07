# Monitoring & reverse proxy (staging on panther)

Traefik v3 as the lab's reverse proxy, Uptime Kuma behind it, and watchtower
for daily image updates. Docker Compose only, state inside this directory.
Runs rootful on the staging host (panther) — this replaced a rootless podman
quadlet setup that could never bind ports 80/53.

## Components

| Service | Image | Exposed | Purpose |
|---|---|---|---|
| `traefik` | `traefik:v3` | `:80` | Reverse proxy; vhosts by container labels |
| `uptime-kuma` | `louislam/uptime-kuma:2` | via traefik only | Uptime monitoring |
| `watchtower` | `containrrr/watchtower` | — | Daily 04:00 image updates, host-wide |

No `.env` — nothing secret here. Static config: `traefik/traefik.yml`.

## Adding a service / vhost

Traefik discovers containers with labels (`exposedByDefault: false`), so a
vhost is two lines on the service, zero proxy config files:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.<name>.rule=Host(`<name>.int.ntux.link`)
  - traefik.http.services.<name>.loadbalancer.server.port=<port>
```

Attach the service to the `web` network. Names resolve via
`remote-access/splitdns/` (`*.int.ntux.link` → this host's tailnet IP).

## Run

```bash
cd monitoring
docker compose up -d
curl -H 'Host: kuma.int.ntux.link' localhost   # -> kuma setup page
```

State: `data/kuma/` (gitignored). First boot: create the admin user once
through the vhost.

## Traefik dashboard (optional, off by default)

1. `traefik/traefik.yml`: set `api.dashboard: true`
2. Add to the traefik service in compose:

```yaml
labels:
  - traefik.http.routers.dashboard.rule=Host(`proxy.int.ntux.link`)
  - traefik.http.routers.dashboard.service=api@internal
  - traefik.http.routers.dashboard.middlewares=dashboard-auth
  # generate: htpasswd -nb admin 'password' | sed 's/$$/\$\$/g'
  - traefik.http.middlewares.dashboard-auth.basicauth.users=<hash>
```

3. `docker compose up -d` — dashboard at `http://proxy.int.ntux.link`.
