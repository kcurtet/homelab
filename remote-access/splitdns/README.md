# Tailnet split-DNS (dnsmasq)

Minimal authoritative DNS for `*.int.ntux.link`, bound to the host's Tailscale
IP only. systemd-resolved keeps loopback `:53`; nothing on the LAN is affected.

Distinct from the AdGuard Home phase (`network/adguardhome/`): that is house
DNS/DHCP for the Raspberry era. This answers exactly one zone, for tailnet
clients, on the staging host.

## Setup

```bash
cd remote-access/splitdns
cp .env.example .env    # verify TS_IP with: tailscale ip -4
docker compose up -d
```

## Verify

```bash
dig +short kuma.int.ntux.link @100.120.247.5   # -> the TS_IP from .env
```

Zone mapping lives in `dnsmasq.conf` (wildcard → this host). Add services as
vhosts in `monitoring/nginx/conf.d/` and they are reachable at
`<name>.int.ntux.link` from any tailnet device.
