# Runbook: Coolify hosting (bring-up, sample deploy, teardown)

Coolify is the lab's application platform: a self-hosted PaaS that builds and runs
anything with a Dockerfile or static output, plus databases and one-click services.
The compose file in [`hosting/coolify/`](../../hosting/coolify/) is extracted from the
official installer (provenance and deviations documented in its header).

**Live validation status:** deferred until the Debian staging host is back — this
runbook is meant to be executed as-is on `panther` (Debian 13, see
[`staging-host.md`](staging-host.md)) once it is reinstalled, with Docker installed per
[`docker-host.md`](docker-host.md). Only `docker compose config` syntax has been
verified so far (on the dev machine).

## Prerequisites

- A Docker host (see [`docker-host.md`](docker-host.md)) — user in the `docker` group.
- `openssh-server` running on that host. Coolify does **not** mount the Docker socket:
  it drives the local Docker daemon over SSH to `host.docker.internal` using a key we
  generate below (same mechanism the official installer sets up).

## 1. Bring Coolify up

```bash
cd hosting/coolify
cp .env.example .env
$EDITOR .env   # or paste the openssl one-liners from the comments in .env.example
```

Generate the values the same way the official installer does (hex/base64 via openssl).
Back the finished `.env` up somewhere off-host (password manager): it holds the
database password and the app encryption key — losing it means losing the install.

Prepare the SSH key + data directories with the permissions the installer would set
(container runs as uid 9999):

```bash
mkdir -p data/{ssh/{keys,mux},applications,databases,services,backups,images,postgres,redis}

sudo ssh-keygen -t ed25519 -a 100 \
  -f "$(pwd)/data/ssh/keys/id.$USER@host.docker.internal" -q -N "" -C coolify
sudo sh -c "cat '$(pwd)/data/ssh/keys/id.$USER@host.docker.internal.pub' >> /root/.ssh/authorized_keys"

sudo chown -R 9999:root data/ssh data/images
sudo chmod -R 700 data/ssh data/images
```

The key is appended to **root's** authorized_keys (the installer does exactly this and
runs as root): when Coolify asks how to reach the local server, the answer is
`root@host.docker.internal` with the private key path above.

Start and wait for health:

```bash
docker compose up -d
docker compose ps        # wait until coolify shows (healthy)
```

## 2. First-run wizard

Open `http://<host>:8000` (staging: `http://192.168.1.100:8000`).

1. Create the root account **within 10 minutes** of the first start, or restart the
   container (`docker restart coolify`) to get a new window.
2. Register the local server when prompted: user `root`, the SSH key from step 1.
   Coolify then deploys its own Traefik proxy (a separate container it manages —
   that is why no proxy service exists in our compose file).

## 3. Deploy a sample static site (public repo, Coolify git integration)

This proves the full path: git clone → build → serve, with no GitHub credentials
(public repositories need no git integration setup).

1. In the Coolify UI: **+ Add resource → Application → Public repository**.
2. Use MDN's starter site: `https://github.com/mdn/beginner-html-site-styled`
   (plain HTML/CSS — ideal as a static sample).
3. Build pack: **Static** (Coolify detects it; a Dockerfile is not needed).
4. Leave the domain empty for now — see "Let's Encrypt and domains" below
   phase. Coolify assigns a high port instead.
5. Deploy, then open `http://<host>:<assigned-port>` — you should see the MDN starter
   page. Pushing a commit to a fork of that repo and redeploying is left as an
   exercise; for this validation a one-shot deploy is enough.

## Compose project

This stack declares `name: hosting` (shared with `hosting/cloudflare/`): both stacks
run under one compose project, which is what the dashboard treats as the "hosting"
phase.

## Let's Encrypt and domains

The article's hosting path used Let's Encrypt certificates that renew themselves, and
that is exactly what Coolify does once a real domain points at the server. Two
publication paths exist, and they differ in **where TLS terminates**:

- **Cloudflare Tunnel** (the default here, `hosting/cloudflare/`): TLS terminates at
  Cloudflare's edge; Cloudflare issues the public certificate. No Let's Encrypt
  certificate is needed on the server and no port is opened. Activate with the
  checklist in `cloudflare-tunnel.md` when the account/domain exist.
- **Direct Let's Encrypt**: when a domain's DNS points straight at the server (later,
  Raspberry era), create the app in Coolify with a FQDN placeholder like
  `app.example.com` and enable **Let's Encrypt** — Coolify requests and auto-renews
  the certificate via its Traefik proxy. Requires ports 80/443 reachable from the
  internet on that host.

Until a domain exists, both paths are intentionally inert: deploy with an empty
domain and browse the app via the server's LAN address.

## 4. Teardown

Apps deployed *through* Coolify are separate compose projects outside this one, so
remove the sample application in the Coolify UI first (it deletes its container and
network). Then remove Coolify itself:

```bash
cd hosting/coolify
docker compose down -v
sudo rm -rf data/
```

`down -v` removes containers and the `coolify` network; the `rm -rf data/` removes the
bind-mounted state (it is owned by uid 9999, hence sudo). Result: zero traces of the
hosting phase on the host except the Docker install itself and the one line in root's
`authorized_keys` (comment `coolify`) — remove it if you want the host pristine.
