# Runbook: Cloudflare Tunnel (publishing without opening ports)

> **STATUS: PENDING ACCOUNT** — no Cloudflare account or domain exists yet. This
> runbook is reference documentation: the compose file in
> [`hosting/cloudflare/`](../../hosting/cloudflare/) is inert until step 2 is done
> and a real `TUNNEL_TOKEN` sits in `hosting/cloudflare/.env` (gitignored).
> The "When the account exists" checklist at the end is the activation gate.

## Why a tunnel instead of opening router ports

The lab rule is: **opening ports is the last resort.** A port forward puts the
home IP on the map (scanners find exposed services within minutes), moves trust
to whatever software listens on that port, and generally means the router —
which this repo deliberately does not manage — becomes part of the attack
surface. A Cloudflare Tunnel inverts the direction: `cloudflared` runs on the
lab host and **dials out** to Cloudflare's edge. Public traffic enters at
Cloudflare and travels back down that already-established connection:

- the home IP is never published (DNS points at Cloudflare, not at home);
- the router forwards nothing — its config stays untouched;
- TLS terminates at Cloudflare's edge; no certificates to babysit here;
- revoke access by stopping one container (see Rollback).

This is the same publishing path the [original article] used; here it is a
pinned, documented compose file instead of a manual install. Note this tunnel
publishes *selected* hostnames — private access to the whole machine stays on
Tailscale (see [`../../remote-access/tailscale.md`](../../remote-access/tailscale.md)
once written); the two mechanisms are complements, not alternatives.

## 1. Create the account and add the domain

1. Sign up at <https://dash.cloudflare.com> (free tier is enough).
2. Add the domain you intend to publish under (Register or Transfer, or add an
   existing domain and switch its nameservers to Cloudflare's).
3. Enable the free Zero Trust plan when prompted (tunnels live under Zero Trust).

## 2. Create a tunnel and get the token

Either way ends with the same token:

- **Dashboard (recommended):** Zero Trust dashboard → **Networks → Tunnels →
  Create a tunnel** → type *Cloudflared* → name it (e.g. `homelab`). The next
  screen shows an install command; the token is the long base64 string after
  `--token`. Do not run that command — the compose file replaces it.
- **CLI:** on any machine,
  ```bash
  cloudflared tunnel login                      # opens a browser to pick the domain
  cloudflared tunnel create homelab             # writes a cert + tunnel credentials
  cloudflared tunnel token homelab              # prints the token
  ```

Paste the token into `hosting/cloudflare/.env` (copy from `.env.example` first —
see step 3). The token is the only secret this phase needs and it is gitignored.

## 3. Activate the connector

```bash
cd hosting/cloudflare
cp .env.example .env
$EDITOR .env          # paste the token after TUNNEL_TOKEN=
docker compose up -d
docker compose logs -f    # expect: "Registered tunnel connection" x4 (one per edge)
```

The tunnel now shows as **HEALTHY** in Zero Trust → Networks → Tunnels.

## 4. Point public hostnames at internal services

Ingress rules live in Cloudflare (that is the point of token mode — see the
compose header). Zero Trust → Networks → Tunnels → `homelab` → **Public
hostname → Add**. Example: publish the sample static site deployed in
[`hosting.md`](hosting.md):

| Field | Value |
|---|---|
| Subdomain / Domain | `app.` *your domain* |
| Service type | `HTTP` |
| URL | `host.docker.internal:<app-port>` |

Two gotchas:

- **Not `localhost`.** Ingress URLs are dialed from *inside the cloudflared
  container*. `localhost:<port>` there is the container itself. The compose maps
  `host.docker.internal` to the host gateway, so `host.docker.internal:<port>`
  reaches ports Coolify published on the host. (The LAN IP of the host works
  too, but is less portable across the staging → Raspberry retarget.)
- **The app must have a port on the host.** Coolify apps whose domain is empty
  get a high published port (see `hosting.md` step 3) — use that number. Later,
  you can instead set the app's domain in Coolify and have its Traefik listen on
  80/443 locally, then point the tunnel at `host.docker.internal:80`.

DNS for the hostname is created automatically by the tunnel's ingress (an
AAAA/CNAME record pointing to the tunnel — never to the home IP).

## 5. Rollback

Nothing outside this directory was ever touched, so undo is one command:

```bash
cd hosting/cloudflare
docker compose down
```

The connector disappears from Cloudflare's edge within seconds; the hostnames
stop resolving through the tunnel and return Cloudflare error 10xx pages. The
router was never involved, so there is nothing to un-forward. To also delete the
tunnel itself: Zero Trust → Networks → Tunnels → delete `homelab` (or
`cloudflared tunnel delete homelab`), and remove the DNS records Cloudflare
created for it. `rm -f .env` removes the token from disk.

## When the account exists — activation checklist

- [ ] Account + domain active in the Cloudflare dashboard.
- [ ] Tunnel `homelab` created; token pasted into `hosting/cloudflare/.env`.
- [ ] `docker compose up -d` in `hosting/cloudflare/`; logs show
      `Registered tunnel connection`.
- [ ] Tunnel listed as **HEALTHY** in Zero Trust → Networks → Tunnels.
- [ ] At least one public hostname → `host.docker.internal:<port>` ingress rule.
- [ ] `curl -I https://<public-hostname>` answers with the expected status
      (e.g. `200` or a redirect from the Coolify app) — from **outside** the LAN
      (phone on mobile data) as a second check.
- [ ] Router admin page confirms: no port forwards added, none needed.
- [ ] `hosting/cloudflare/.env` is **not** tracked: `git status --short` clean
      of it (gitignored via `.env`).

[original article]: https://kcurtet.com/proyectos/homelab/
