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

## Verify

```bash
docker run --rm hello-world
```

Expected: the container prints "Hello from Docker!" and exits. If the daemon is not running you get `Cannot connect to the Docker daemon` — check `systemctl status docker`.
