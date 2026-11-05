# Runbook: DHCP migration to Pi-hole (house DNS/DHCP era)

> **STATUS: BUILT, NOT APPLIED.** This runbook is the activation path for
> `network/pihole/` and may only be executed when the **Raspberry Pi 5 is on the
> LAN and stable**. **NEVER on staging (panther or any laptop):** a second DHCP
> server on the house network can break connectivity for every device
> (spec anti-objective; family helpdesk rule — if resolution dies, "the internet
> is down" for three people). Nothing here is automated: router-side steps are
> manual by design.

> Note: this stack runs under compose project `network` (see its `docker-compose.yml`).

## What this implements (and why)

Spec, "Improvements over the article" #1: the original setup had no fallback —
Pi-hole was the only DNS, so "Pi-hole is down" meant "no internet" for the whole
house. This design adds **automatic DNS failover**:

- Pi-hole's DHCP hands out leases with **DNS1 = the Pi-hole host** and
  **DNS2 = the router** (`FTLCONF_misc_dnsmasq_lines` in the compose injects
  `dhcp-option=option:dns-server,0.0.0.0,<router>` — `0.0.0.0` is dnsmasq's
  "this machine" placeholder).
- Pi-hole dies → clients fall back to the router on their own → the household
  keeps internet. Nobody switches networks; ads return until Pi-hole is fixed.

### MANDATORY: ad-leak trade-off (this is by design, not a bug)

Some clients (notably Android/Chrome devices, and anything using Happy
Eyeballs-style racing) query the **secondary** resolver occasionally even in
normal operation. Those queries bypass Pi-hole, so **some ads will slip through
even while everything is healthy**. This is the accepted cost of the failover
design — the alternative (advertising Pi-hole as the only resolver) restores
100 % blocking but turns "Pi-hole down" into "internet down".

Expected symptom, expected answer:

| Symptom | Cause | Action |
| --- | --- | --- |
| One device shows ads, everything else blocked | That device used DNS2 (router) | None — accepted trade-off. Optionally re-check the device's DNS settings. |
| **All** devices show ads, internet works | Clients failed over to the router (Pi-hole down) | Fix Pi-hole; clients drift back to DNS1 automatically. |
| Internet dead for everyone | Not failover — check the router/ISP | Router-side troubleshooting. |

If the ad-leak trade-off ever becomes unacceptable, revisit the design
(e.g. DHCP advertising only Pi-hole) — do **not** paper over it client by client.

## Prerequisites

1. **Raspberry Pi 5 running the stack** (`network/pihole/` up, healthy —
   `docker compose ps` shows healthy; web UI reachable). Staging hosts need not
   apply (see header).
2. **Static IP for the server** (DHCP reservation on the router or static
   config). DNS1 in every lease points at this address; if it changes, the
   whole house silently loses its primary DNS.
3. **The router resolves DNS on its own** — it must be a usable secondary:

   ```console
   $ dig @192.168.1.1 example.com +short   # adjust to your router's LAN IP
   93.184.216.34
   ```

   Must return an answer **without Pi-hole running**. If the router only
   forwards to Pi-hole (common if it was configured that way in the past),
   failover would be circular: fix that first (router DNS = ISP or public).
4. Router's DHCP pool and the Pi-hole pool (`PIHOLE_DHCP_START/END` in `.env`)
   do not overlap, and neither contains the router's or the server's IP.

## Migration order (the two-DHCP window is the dangerous one)

Two DHCP servers answering on the same LAN = clients get random leases from
either one. The order below keeps that window to minutes and ends with a
verified client before the router's server is switched off.

### 1. Enable Pi-hole's DHCP (start of the dangerous window)

```console
$ cd network/pihole
$ cp .env.example .env        # if not already
$ $EDITOR .env                # PIHOLE_DHCP_ACTIVE=true, pool range, PIHOLE_DNS2_ROUTER=<router IP>
$ docker compose config | grep -i dhcp   # sanity: dhcp_active true, pool sane
$ docker compose up -d
```

Verify Pi-hole is listening on UDP 67 (host networking):

```console
$ ss -lnup | grep :67
```

### 2. Verify on ONE client BEFORE touching the router

Force a renew on a single device (toggle Wi-Fi off/on, or replug Ethernet) and
check it received **both DNS servers from Pi-hole's pool**:

- Linux: `resolvectl status` or `nmcli dev show <iface> | grep DNS` (also check
  the lease address is inside `PIHOLE_DHCP_START/END`)
- Windows: `ipconfig /all` → DNS Servers must list Pi-hole **and** the router
- macOS/iOS/Android: connection details

Also confirm the lease in the Pi-hole web UI (**Local DNS → DHCP** or the
long-term data page). **Do not proceed until DNS1=Pi-hole and DNS2=router are
both visible on that client**, and resolution works from it
(`dig example.com` / browse a site).

### 3. Switch OFF the router's DHCP server (end of the window)

Router admin UI → LAN/DHCP → disable the DHCP server. This is a manual,
router-specific step — no code in this repo touches the router, by design.

### 4. Per-device verification

Walk the household devices (phones, laptops, TV, consoles). For each: renew the
lease (toggle Wi-Fi / reconnect) and confirm working internet. It is normal for
already-leased devices to keep their old lease until it expires — a
disconnect/reconnect forces it immediately. Expect stragglers (printers, IoT)
for up to one old lease time (commonly 24 h).

## Rollback (at any point)

1. Router admin UI → **re-enable the router's DHCP server**.
2. Kill the duplicate on the Pi-hole side:

   ```console
   $ cd network/pihole && $EDITOR .env   # PIHOLE_DHCP_ACTIVE=false
   $ docker compose up -d
   ```

3. Renew leases on affected devices (toggle Wi-Fi / replug). They go back to
   the router for IP+DNS; Pi-hole keeps serving DNS to whatever still points at
   it until the next lease.

Rollback is safe because it is the mirror image of the migration: exactly one
DHCP server ends up authoritative (the router), the same one that had it before.

## Post-maintenance notes

- Stopping Pi-hole on purpose (upgrades etc.): expected behavior is exactly the
  failover path — clients use the router, ads return, internet stays. Announce
  it if the family is watching something ad-supported.
- The DHCP settings are pinned read-only by the `FTLCONF_` environment
  variables (v6 behavior: env-set values cannot be changed from the web UI).
  Change them via `.env` + `docker compose up -d`, not the UI.
