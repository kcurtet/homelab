# Runbook: dashboard (build, serve over Tailscale, verify)

The dashboard is the lab's single pane: status cards per compose project (hosting,
network, dashboard), hub links to the existing UIs, and whitelisted actions (restart,
phase start/stop, container logs, manual backup). It talks **only** to the Docker API
through a socket-proxy — no SSH, no systemd, no exec endpoints — and it is reachable
**only inside the tailnet**.

## How it works

- `dashboard/` — Astro SSR (node adapter) served from one container.
- `socket-proxy` — `tecnativa/docker-socket-proxy` with minimal grants
  (CONTAINERS/LOGS/NETWORKS/VOLUMES/IMAGES/INFO/PING + POST for lifecycle). Exec and
  build endpoints are not granted. The raw docker socket is never mounted into the
  dashboard.
- Phases = compose projects: `hosting` (coolify + cloudflared), `network` (adguardhome),
  `dashboard`. Start/stop works on running containers' labels; it does not create.
- Manual backup runs `backup/restic/backup.sh` **as-is** inside an ephemeral container
  (same env file and mounts as the host timer — identical scope by construction).
  Requires `/etc/homelab/backup.env`, the password file, and the backup disk mounted
  on the host; otherwise the button is disabled with the reason.

## Build & run

On the lab host (Docker path in `docker-host.md`):

```bash
cd dashboard
cp .env.example .env        # port + hub URLs (+ AdGuard Home API creds if wanted)

# The backup button needs the runner image (podman tags it localhost/…, the
# dashboard's default; on Docker, tag without localhost/ and set
# BACKUP_IMAGE=homelab-backup:latest in .env):
podman build -f backup.Dockerfile -t homelab-backup .   # or: docker build -f backup.Dockerfile -t homelab-backup .

docker compose up -d --build
curl -s http://127.0.0.1:4321/api/status | head -c 200   # expect JSON
```

The compose publishes **only** `127.0.0.1:4321` — nothing listens on the LAN.

> **dockerd note:** the dashboard network is `internal: true` (verified under
> podman). If `127.0.0.1:4321` does not answer on a Docker host, remove
> `internal: true` from the compose network and re-check — published ports on
> internal networks behave differently across daemons.
>
> **Ops notes:** if the Docker/podman daemon restarts, the socket-proxy holds a
> dead socket inode and does not recover on its own — `docker compose restart
> socket-proxy`. The auth model is tailnet-only **plus** Astro's same-origin
> check (`security.checkOrigin`, on by default) — do not disable it.

## Serve inside the tailnet

From the host (Tailscale already installed):

```bash
tailscale serve --bg 4321
```

Now `https://<host>.<tailnet>.ts.net:443` serves the dashboard with the tailnet's
own certificate — from any device in the tailnet, nowhere else.

## Verify

1. **Status**: open the dashboard — cards should reflect `docker ps` on the host.
2. **Hub links** resolve to Coolify/AdGuard Home/Tailscale admin.
3. **Action**: restart a container from its row; `StartedAt` should change.
4. **Guardrail**: stop `hosting` → a confirm dialog warns "this takes down public
   publishing"; the API requires `confirm:true` (400 otherwise).
5. **Tailnet-only**: from a device outside the tailnet the URL must not connect.
   That is the whole auth model.

## Teardown

```bash
cd dashboard && docker compose down -v
tailscale serve --off
```

## Notes

- With podman instead of Docker, point the socket-proxy volume at the podman socket
  (see the comment in `docker-compose.yml`).
- The backup button reads `/etc/homelab/backup.env` and `/mnt/backup` through the
  container; on staging hosts without them it stays disabled with the exact reason.
