# Runbook: prepare a Docker host

Every phase of this lab targets a Linux host with Docker. Two targets exist today:

- **Staging**: `panther` — CachyOS (Arch-based) laptop, always on. Docker status when this runbook was written: **not installed**.
- **Final**: Raspberry Pi 5 (8 GB, SSD boot) running Raspberry Pi OS 64-bit.

## Install — Arch / CachyOS (panther)

```bash
sudo pacman -S --needed docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # re-login afterwards
```

## Install — Debian 13 / Raspberry Pi OS 64-bit (staging + final server)

Debian path (staging host, see `staging-host.md` for the full install runbook):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

Add the Docker apt repo (bookworm/trixie as appropriate), then:

```bash
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # re-login afterwards
```

Docker Compose v2 ships as a plugin (`docker compose`) in both paths.

## Security note

Membership in the `docker` group is root-equivalent on that host: anyone in it can mount the host filesystem into a container. Only add users you fully trust, and never enable remote access to the Docker socket without TLS.

### ufw vs containers (learned the hard way, 2026-11-07)

Two different paths, two different rules:

- **Bridge containers with published ports** (traefik `:80`, dnsmasq on the
  tailscale IP): traffic is DNAT-ed and walks the FORWARD/DOCKER chains —
  ufw's INPUT policy never sees it. Works regardless of ufw.
- **Host-networked containers** (AdGuard Home, `network_mode: host`): their
  ports land on the host stack → INPUT chain → **dropped by ufw's default
  deny**. This silently blocks LAN clients AND other containers trying to
  reach the host IP (e.g. an Uptime Kuma DNS probe to the AdGuard resolver —
  `ETIMEOUT`). Tests from the host itself pass via `lo`, so the trap is
  invisible until you test from another device or container.

Fix: explicit allows for host-networked services (see
  `network/adguardhome`):

```bash
sudo ufw allow from 192.168.1.0/24 to any port 53 proto tcp comment 'AdGuard DNS LAN'
sudo ufw allow from 192.168.1.0/24 to any port 53 proto udp comment 'AdGuard DNS LAN'
sudo ufw allow from 172.16.0.0/12 to any port 53 comment 'DNS host services from docker'
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp comment 'AdGuard UI LAN'
```

## Verify

```bash
docker run --rm hello-world
```

Expected: the container prints "Hello from Docker!" and exits. If the daemon is not running you get `Cannot connect to the Docker daemon` — check `systemctl status docker`.
